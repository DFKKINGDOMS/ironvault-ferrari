import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { AzureBlobImageJobStore } from '../image-studio/azure-blob-store.js';
import { ConservativeBackgroundEngine } from '../image-studio/local-background-engine.js';
import { OpenAiImageEngine } from '../image-studio/openai-engine.js';
import type { ImageJobStore } from '../image-studio/file-store.js';
import { AstraMediaPolicy } from './astra-policy.js';
import { exactCanaryCandidates } from './canary-source.js';
import {
  scanShopifyExport,
  shopifyCandidateKey,
  streamShopifyCandidates,
  type ShopifyMediaCandidate as MediaCandidate,
  type ShopifyMediaQueuePass
} from './export-stream.js';
import { decodedPixelSha256, normalizeFerrariDerivative, validateFerrariDerivative } from './ferrari-quality.js';
import { isTextQuarantined } from './policy.js';
import {
  SHOPIFY_MEDIA_JOB_ID,
  SHOPIFY_MEDIA_PROFILE,
  SHOPIFY_MEDIA_SOURCE_DOMAIN,
  SHOPIFY_MEDIA_SOURCE_STORE,
  type ShopifyMediaAssetRecord,
  type ShopifyMediaPipelineStatus,
  type ShopifyPartMediaIndex
} from './types.js';

type JsonObject = Record<string, unknown>;

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';
const CANARY_PART_NUMBER = (process.env.SHOPIFY_MEDIA_CANARY_PART_NUMBER || '10110989').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const MIN_INTERVAL_MS = Math.max(1_000, Number(process.env.SHOPIFY_MEDIA_MIN_INTERVAL_MS || 6_000));
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_EXPORT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ATTEMPTS = 5;
const EXPORT_TEMP_ROOT = join(tmpdir(), 'partquill-shopify-media');

const SHOP_IDENTITY = `query PartQuillShopIdentity {
  shop { name myshopifyDomain }
  currentAppInstallation { accessScopes { handle } }
}`;

const EXACT_CANARY_MEDIA = `query PartQuillExactCanary($query: String!) {
  productVariants(first: 10, query: $query) {
    nodes {
      sku
      product {
        id
        media(first: 100) {
          nodes {
            __typename
            ... on MediaImage {
              id alt mimeType
              image { url width height altText }
            }
          }
        }
      }
    }
  }
}`;

const RECENT_BULK = `query PartQuillRecentBulkExports($first: Int!) {
  bulkOperations(first: $first, reverse: true, sortKey: CREATED_AT, query: "operation_type:query") {
    nodes { id status type createdAt completedAt objectCount rootObjectCount fileSize errorCode url partialDataUrl query }
  }
}`;

const GET_BULK = `query PartQuillBulkExport($id: ID!) {
  bulkOperation(id: $id) { id status type createdAt completedAt objectCount rootObjectCount fileSize errorCode url partialDataUrl query }
}`;

const START_BULK = `mutation StartPartQuillMediaExport($query: String!, $groupObjects: Boolean!) {
  bulkOperationRunQuery(query: $query, groupObjects: $groupObjects) {
    bulkOperation { id status type createdAt objectCount rootObjectCount }
    userErrors { field message }
  }
}`;

const BULK_DOCUMENT = `{
  partquillFiles: files {
    edges {
      node {
        __typename id alt
        ... on MediaImage { mimeType image { url width height altText } }
      }
    }
  }
  partquillProducts: products {
    edges {
      node {
        id
        variants { edges { node { id sku } } }
        media {
          edges {
            node {
              __typename id alt
              ... on MediaImage { mimeType image { url width height altText } }
            }
          }
        }
      }
    }
  }
}`;

interface WorkerState extends ShopifyMediaPipelineStatus {
  releaseSha?: string;
  exportPath?: string;
  assetCursor: number;
  queuePass?: ShopifyMediaQueuePass;
  canaryCandidateKey?: string;
  requestFreshExport?: boolean;
  retryAssetId?: string;
  retryAttempts: number;
  completedAt?: string;
}

interface ProcessResult {
  outcome: 'PASSED' | 'DUPLICATE' | 'QUARANTINED_LOGO' | 'QUARANTINED_NON_PRODUCT';
  mapped: boolean;
  deduplicated?: boolean;
  remoteAiUsed: boolean;
  record?: ShopifyMediaAssetRecord;
}

interface CachedClassification {
  pixelSha256: string;
  classification: 'PRODUCT_PHOTO' | 'LOGO_OR_BRANDING' | 'PLACEHOLDER_OR_MARKETING' | 'DIAGRAM_OR_DOCUMENT' | 'NOT_PRODUCT_PHOTO';
  confidence: number;
  reason: string;
  model: string;
  checkedAt: string;
}

function now(): string {
  return new Date().toISOString();
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function required(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`CONFIGURATION: ${name} is required`);
  return value;
}

function safeDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error('CONFIGURATION: SHOPIFY_STORE_DOMAIN must be the canonical myshopify.com domain');
  }
  return domain;
}

function userErrors(payload: JsonObject | undefined): string[] {
  const rows = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
  return rows.map((row) => row && typeof row === 'object' ? String((row as JsonObject).message || 'Shopify user error') : 'Shopify user error');
}

class ShopifyAdmin {
  private constructor(readonly domain: string, private readonly token: string) {}

  static async create(): Promise<ShopifyAdmin> {
    const domain = safeDomain(required('SHOPIFY_STORE_DOMAIN'));
    if (domain !== SHOPIFY_MEDIA_SOURCE_DOMAIN) {
      throw new Error(`CONFIGURATION: Shopify source must be ${SHOPIFY_MEDIA_SOURCE_DOMAIN}`);
    }
    let token = String(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ACCESS_TOKEN || '').trim();
    if (!token) {
      const clientId = required('SHOPIFY_CLIENT_ID');
      const clientSecret = required('SHOPIFY_CLIENT_SECRET');
      const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(60_000)
      });
      const payload = await response.json().catch(() => ({})) as JsonObject;
      if (!response.ok || typeof payload.access_token !== 'string') {
        throw new Error(`CONFIGURATION: Shopify client-credential exchange failed with ${response.status}`);
      }
      token = payload.access_token;
    }
    return new ShopifyAdmin(domain, token);
  }

  async gql<T extends JsonObject>(query: string, variables: JsonObject = {}): Promise<T> {
    const response = await fetch(`https://${this.domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-shopify-access-token': this.token
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(90_000)
    });
    const payload = await response.json().catch(() => ({})) as JsonObject;
    if (!response.ok) throw new Error(`Shopify Admin API failed with ${response.status}`);
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw new Error(`Shopify GraphQL failed: ${JSON.stringify(payload.errors).slice(0, 1_500)}`);
    }
    if (!payload.data || typeof payload.data !== 'object') throw new Error('Shopify GraphQL returned no data');
    return payload.data as T;
  }

  async verify(): Promise<{ name: string; domain: string }> {
    const data = await this.gql<{ shop: JsonObject; currentAppInstallation: JsonObject }>(SHOP_IDENTITY);
    const name = String(data.shop?.name || '');
    const domain = String(data.shop?.myshopifyDomain || '');
    const scopes = Array.isArray(data.currentAppInstallation?.accessScopes)
      ? data.currentAppInstallation.accessScopes.map((row) => String((row as JsonObject).handle || ''))
      : [];
    if (name !== SHOPIFY_MEDIA_SOURCE_STORE) throw new Error('CONFIGURATION: Shopify credential failed the locked source-store identity check');
    if (domain.toLowerCase() !== this.domain) throw new Error('CONFIGURATION: Shopify credential domain does not match the configured store');
    for (const scope of ['read_files', 'read_products']) {
      if (!scopes.includes(scope)) throw new Error(`CONFIGURATION: Shopify credential lacks ${scope}`);
    }
    return { name, domain };
  }
}

function initialState(sourceStore = SHOPIFY_MEDIA_SOURCE_STORE): WorkerState {
  return {
    id: SHOPIFY_MEDIA_JOB_ID,
    schemaVersion: 1,
    sourceStore,
    phase: 'AWAITING_EXPORT',
    canaryPartNumber: CANARY_PART_NUMBER,
    canaryPassed: false,
    assetCursor: 0,
    queuePass: 'MAPPED',
    retryAttempts: 0,
    discovered: 0,
    processed: 0,
    passed: 0,
    duplicates: 0,
    quarantinedLogos: 0,
    quarantinedNonProduct: 0,
    unmapped: 0,
    retrying: 0,
    held: 0,
    updatedAt: now()
  };
}

function statusOf(data: JsonObject): JsonObject | null {
  const direct = data.bulkOperation;
  if (direct && typeof direct === 'object') return direct as JsonObject;
  return null;
}

function matchingBulk(row: JsonObject): boolean {
  const query = String(row.query || '');
  return query.includes('partquillFiles: files')
    && query.includes('partquillProducts: products')
    && query.includes('media');
}

function exportPath(store: ImageJobStore, id: string): string {
  return store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'exports', `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`);
}

function acceptedExportHost(hostname: string): boolean {
  return hostname === 'storage.googleapis.com' || hostname.endsWith('.storage.googleapis.com');
}

async function fetchWithAllowedRedirects(
  value: string | URL,
  accepted: (hostname: string) => boolean,
  signal: AbortSignal,
  headers?: Record<string, string>
): Promise<Response> {
  let current = new URL(value);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (current.protocol !== 'https:' || !accepted(current.hostname)) {
      throw new Error('SOURCE: download URL host was rejected');
    }
    const response = await fetch(current, { headers, signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('SOURCE: download redirect did not include a location');
    current = new URL(location, current);
  }
  throw new Error('SOURCE: download exceeded the redirect limit');
}

async function downloadBoundedToFile(url: string, limit: number, destinationPath: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !acceptedExportHost(parsed.hostname)) {
    throw new Error('SOURCE: Shopify bulk export URL host was rejected');
  }
  const response = await fetchWithAllowedRedirects(parsed, acceptedExportHost, AbortSignal.timeout(15 * 60_000));
  if (!response.ok) throw new Error(`source download failed with ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > limit) throw new Error(`SOURCE: download exceeds ${limit} bytes`);
  if (!response.body) throw new Error('SOURCE: Shopify bulk export returned no body');
  await mkdir(EXPORT_TEMP_ROOT, { recursive: true });
  await unlink(destinationPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > limit ? new Error(`SOURCE: download exceeds ${limit} bytes`) : null, chunk);
    }
  });
  await pipeline(response.body, limiter, createWriteStream(destinationPath, { flags: 'wx' }));
  if (received < 1) throw new Error('SOURCE: Shopify bulk export was empty');
}

async function saveState(store: ImageJobStore, state: WorkerState): Promise<void> {
  state.updatedAt = now();
  await store.saveJob(state);
}

function localExportPath(operationId: string): string {
  return join(EXPORT_TEMP_ROOT, `${operationId.replace(/[^A-Za-z0-9_-]/g, '_')}.jsonl`);
}

async function ensureExport(shop: ShopifyAdmin, store: ImageJobStore, state: WorkerState): Promise<string | null> {
  if (state.exportPath) {
    const localPath = localExportPath(state.exportOperationId || sha256(state.exportPath));
    try {
      await store.readToFile(state.exportPath, localPath);
      const details = await stat(localPath);
      if (details.size < 1 || details.size > MAX_EXPORT_BYTES) throw new Error('SOURCE: archived Shopify export has an invalid size');
      return localPath;
    } catch (error) {
      if ((error as { statusCode?: number; code?: string }).statusCode !== 404 && (error as { code?: string }).code !== 'ENOENT') throw error;
      state.exportPath = undefined;
    }
  }

  let operation: JsonObject | null = null;
  if (state.exportOperationId) {
    operation = statusOf(await shop.gql<JsonObject>(GET_BULK, { id: state.exportOperationId }));
  }
  if (!operation) {
    const recent = await shop.gql<{ bulkOperations: JsonObject }>(RECENT_BULK, { first: 20 });
    const nodes = Array.isArray(recent.bulkOperations?.nodes) ? recent.bulkOperations.nodes as JsonObject[] : [];
    operation = nodes.find((row) => matchingBulk(row) && (
      !state.requestFreshExport || ['CREATED', 'RUNNING', 'CANCELING'].includes(String(row.status))
    )) || null;
  }
  if (!operation || ['FAILED', 'CANCELED', 'EXPIRED'].includes(String(operation.status))) {
    const started = await shop.gql<{ bulkOperationRunQuery: JsonObject }>(START_BULK, { query: BULK_DOCUMENT, groupObjects: false });
    const errors = userErrors(started.bulkOperationRunQuery);
    if (errors.length) throw new Error(`Shopify bulk export was rejected: ${errors.join('; ')}`);
    operation = started.bulkOperationRunQuery.bulkOperation as JsonObject;
  }
  if (!operation?.id) throw new Error('Shopify bulk export returned no operation ID');
  state.requestFreshExport = false;
  state.exportOperationId = String(operation.id);
  state.exportObjectCount = Number(operation.objectCount || 0);
  await saveState(store, state);

  if (String(operation.status) !== 'COMPLETED') return null;
  const url = String(operation.url || '');
  if (!url) throw new Error('Shopify bulk export completed without a result URL');
  const localPath = localExportPath(String(operation.id));
  await downloadBoundedToFile(url, MAX_EXPORT_BYTES, localPath);
  const path = exportPath(store, String(operation.id));
  try {
    await store.writeFile(path, localPath);
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    const code = String((error as { code?: string }).code || '');
    if (![409, 412].includes(status) && code !== 'EEXIST') throw error;
  }
  state.exportPath = path;
  state.exportObjectCount = Number(operation.objectCount || 0);
  await saveState(store, state);
  return localPath;
}

async function readJson<T>(store: ImageJobStore, path: string): Promise<T | null> {
  try {
    return JSON.parse(Buffer.from(await store.readBytes(path)).toString('utf8')) as T;
  } catch (error) {
    const value = error as { statusCode?: number; code?: string };
    if (value.statusCode === 404 || value.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(store: ImageJobStore, path: string, value: unknown): Promise<void> {
  await store.replaceBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

async function writeOnce(store: ImageJobStore, path: string, bytes: Uint8Array): Promise<void> {
  try {
    await store.writeBytes(path, bytes);
  } catch (error) {
    const status = Number((error as { statusCode?: number }).statusCode);
    const code = String((error as { code?: string }).code || '');
    if (![409, 412].includes(status) && code !== 'EEXIST') throw error;
  }
}

function recordPath(store: ImageJobStore, candidate: MediaCandidate): string {
  return store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'records', `${shopifyCandidateKey(candidate).slice(0, 32)}.json`);
}

async function appendIndexes(store: ImageJobStore, record: ShopifyMediaAssetRecord): Promise<void> {
  for (const partNumber of record.partNumbers) {
    const path = store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'indexes', `${partNumber}.json`);
    const existing = await readJson<ShopifyPartMediaIndex>(store, path);
    const assets = [...(existing?.assets || []).filter((asset) => asset.derivativeSha256 !== record.derivativeSha256), record]
      .sort((left, right) => Number(right.source === 'SHOPIFY_PRODUCT_MEDIA') - Number(left.source === 'SHOPIFY_PRODUCT_MEDIA') || left.createdAt.localeCompare(right.createdAt))
      .slice(0, 24);
    await writeJson(store, path, {
      id: `shopify-media-${partNumber}`,
      schemaVersion: 1,
      partNumber,
      sourceStore: record.sourceStore,
      profile: SHOPIFY_MEDIA_PROFILE,
      assets,
      updatedAt: now()
    } satisfies ShopifyPartMediaIndex);
  }
}

async function quarantine(store: ImageJobStore, candidate: MediaCandidate, reason: string, classification: string): Promise<void> {
  await writeJson(store, store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'quarantine', `${shopifyCandidateKey(candidate).slice(0, 32)}.json`), {
    id: candidate.id,
    filename: candidate.filename,
    alt: candidate.alt,
    sourceUrl: candidate.canonicalUrl,
    partNumbers: candidate.partNumbers,
    classification,
    reason: reason.slice(0, 1_000),
    transferred: false,
    updatedAt: now()
  });
}

function acceptedMediaType(contentType: string, fallback: string): string {
  const value = contentType.split(';', 1)[0]!.trim().toLowerCase();
  const candidate = value.startsWith('image/') ? value : fallback.toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(candidate)) {
    throw new Error(`SOURCE: unsupported image media type ${candidate || 'unknown'}`);
  }
  return candidate;
}

function validCachedClassification(value: CachedClassification | null, pixelSha: string): value is CachedClassification {
  return Boolean(
    value
    && value.pixelSha256 === pixelSha
    && ['PRODUCT_PHOTO', 'LOGO_OR_BRANDING', 'PLACEHOLDER_OR_MARKETING', 'DIAGRAM_OR_DOCUMENT', 'NOT_PRODUCT_PHOTO'].includes(value.classification)
    && Number.isFinite(value.confidence)
    && value.confidence >= 0
    && value.confidence <= 1
    && value.reason
    && value.model
  );
}

async function processCandidate(
  store: ImageJobStore,
  candidate: MediaCandidate,
  sourceStore: string,
  policy: AstraMediaPolicy,
  engine: ConservativeBackgroundEngine
): Promise<ProcessResult> {
  if (isTextQuarantined(candidate.filename, candidate.alt)) {
    await quarantine(store, candidate, 'Filename or alt text identifies a logo, store-brand asset, placeholder, banner, badge, or other non-product graphic.', 'TEXT_POLICY_LOGO_OR_PLACEHOLDER');
    return { outcome: 'QUARANTINED_LOGO', mapped: Boolean(candidate.partNumbers.length), remoteAiUsed: false };
  }

  const response = await fetchWithAllowedRedirects(
    candidate.url,
    (hostname) => hostname === 'cdn.shopify.com',
    AbortSignal.timeout(120_000),
    { accept: 'image/avif,image/webp,image/png,image/jpeg' }
  );
  if (!response.ok) throw new Error(`Shopify CDN image failed with ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_SOURCE_BYTES) throw new Error('SOURCE: Shopify image exceeds the 25 MB limit');
  const sourceBytes = new Uint8Array(await response.arrayBuffer());
  if (!sourceBytes.length || sourceBytes.length > MAX_SOURCE_BYTES) throw new Error('SOURCE: Shopify image byte length is invalid');
  const mediaType = acceptedMediaType(response.headers.get('content-type') || '', candidate.mimeType);
  const sourceSha = sha256(sourceBytes);
  const pixelSha = await decodedPixelSha256(sourceBytes);
  const dedupePath = store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'dedupe', `${pixelSha}.json`);
  const duplicate = await readJson<{ recordPath: string }>(store, dedupePath);
  if (duplicate?.recordPath) {
    const canonical = await readJson<ShopifyMediaAssetRecord>(store, duplicate.recordPath);
    if (canonical?.qa?.status === 'PASSED') {
      const alias = {
        ...canonical,
        source: candidate.source,
        shopifyFileId: candidate.id,
        shopifyProductId: [...candidate.productIds][0],
        shopifyMediaId: candidate.id,
        filename: candidate.filename,
        alt: candidate.alt,
        partNumbers: candidate.partNumbers,
        sourceUrl: candidate.canonicalUrl,
        updatedAt: now()
      } satisfies ShopifyMediaAssetRecord;
      if (alias.partNumbers.length) await appendIndexes(store, alias);
      await writeJson(store, recordPath(store, candidate), { ...alias, duplicateOf: canonical.id });
      return { outcome: 'DUPLICATE', mapped: Boolean(alias.partNumbers.length), remoteAiUsed: false, record: alias };
    }
  }

  let aiBytes = sourceBytes;
  let aiMediaType = mediaType;
  if (mediaType === 'image/avif') {
    aiBytes = await sharp(sourceBytes).rotate().jpeg({ quality: 98, chromaSubsampling: '4:4:4' }).toBuffer();
    aiMediaType = 'image/jpeg';
  }
  const classificationPath = store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'classifications', `${pixelSha}.json`);
  const cachedClassification = await readJson<CachedClassification>(store, classificationPath);
  const classificationWasCached = validCachedClassification(cachedClassification, pixelSha);
  const classification = classificationWasCached
    ? cachedClassification
    : await policy.classify(aiBytes, aiMediaType, candidate.filename, candidate.alt);
  if (!classificationWasCached) {
    await writeJson(store, classificationPath, {
      pixelSha256: pixelSha,
      classification: classification.classification,
      confidence: classification.confidence,
      reason: classification.reason,
      model: classification.model,
      checkedAt: now()
    } satisfies CachedClassification);
  }
  if (classification.classification !== 'PRODUCT_PHOTO' || classification.confidence < 0.75) {
    await quarantine(store, candidate, classification.reason, classification.classification);
    return {
      outcome: classification.classification === 'LOGO_OR_BRANDING' ? 'QUARANTINED_LOGO' : 'QUARANTINED_NON_PRODUCT',
      mapped: Boolean(candidate.partNumbers.length),
      deduplicated: classificationWasCached,
      remoteAiUsed: !classificationWasCached
    };
  }

  const extension = mediaType === 'image/png' ? 'png' : mediaType === 'image/webp' ? 'webp' : mediaType === 'image/avif' ? 'avif' : 'jpg';
  const originalPath = store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'originals', `${sourceSha}.${extension}`);
  await writeOnce(store, originalPath, sourceBytes);
  const edited = await engine.edit({
    source: aiBytes,
    mediaType: aiMediaType,
    filename: candidate.filename,
    route: 'HERO_PREMIUM',
    background: 'PURE_WHITE',
    watermarkStatus: 'OWNED_OR_AUTHORIZED'
  });
  const finalBytes = await normalizeFerrariDerivative(edited.bytes);
  const deterministicQa = await validateFerrariDerivative(finalBytes);
  const compared = await engine.compare(aiBytes, aiMediaType, {
    bytes: finalBytes,
    mediaType: 'image/jpeg',
    model: edited.model,
    quality: edited.quality
  });
  if (!compared.passed) throw new Error(`QA: Astra source comparison failed: ${compared.reason}`);

  const derivativeSha = sha256(finalBytes);
  const derivativePath = store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'derivatives', `${sourceSha}-${SHOPIFY_MEDIA_PROFILE}.jpg`);
  await writeOnce(store, derivativePath, finalBytes);
  const id = sha256(`${shopifyCandidateKey(candidate)}:${sourceSha}`).slice(0, 32);
  const createdAt = now();
  const record: ShopifyMediaAssetRecord = {
    id,
    source: candidate.source,
    sourceStore,
    shopifyFileId: candidate.id,
    shopifyProductId: [...candidate.productIds][0],
    shopifyMediaId: candidate.id,
    filename: candidate.filename,
    alt: candidate.alt,
    partNumbers: candidate.partNumbers,
    sourceUrl: candidate.canonicalUrl,
    sourceSha256: sourceSha,
    originalPath,
    derivativePath,
    derivativeSha256: derivativeSha,
    width: candidate.width,
    height: candidate.height,
    qa: {
      status: 'PASSED',
      profile: SHOPIFY_MEDIA_PROFILE,
      classifierModel: classification.model,
      comparisonModel: compared.model,
      editModel: edited.model,
      reason: `${classification.reason}; ${compared.reason}; foreground ratio ${deterministicQa.nonWhiteRatio.toFixed(4)}`,
      checkedAt: now(),
      output: {
        width: 2000,
        height: 2000,
        mediaType: 'image/jpeg',
        colorSpace: 'srgb',
        metadataStripped: true,
        background: '#FFFFFF'
      }
    },
    createdAt,
    updatedAt: createdAt
  };
  const path = recordPath(store, candidate);
  await writeJson(store, path, record);
  await writeJson(store, dedupePath, { pixelSha256: pixelSha, sourceSha256: sourceSha, recordPath: path, updatedAt: now() });
  if (record.partNumbers.length) await appendIndexes(store, record);
  return { outcome: 'PASSED', mapped: Boolean(record.partNumbers.length), remoteAiUsed: true, record };
}

function isConfigurationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /CONFIGURATION:|authentication|unauthorized|forbidden|permission|deployment.+not found|invalid_api_key/i.test(message);
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:408|409|425|429|500|502|503|504)\b|rate.?limit|temporar|timeout|timed out|fetch failed|socket|connection|ECONN|ETIMEDOUT|throttl|service unavailable/i.test(message);
}

function applyResult(state: WorkerState, result: ProcessResult): void {
  state.processed += 1;
  state.passed += result.outcome === 'PASSED' ? 1 : 0;
  state.duplicates += result.outcome === 'DUPLICATE' || result.deduplicated ? 1 : 0;
  state.quarantinedLogos += result.outcome === 'QUARANTINED_LOGO' ? 1 : 0;
  state.quarantinedNonProduct += result.outcome === 'QUARANTINED_NON_PRODUCT' ? 1 : 0;
  state.unmapped += result.mapped ? 0 : 1;
}

async function processWithRecovery(
  store: ImageJobStore,
  state: WorkerState,
  candidate: MediaCandidate,
  sourceStore: string,
  policy: AstraMediaPolicy,
  engine: ConservativeBackgroundEngine
): Promise<ProcessResult | null> {
  const key = shopifyCandidateKey(candidate);
  for (;;) {
    try {
      const result = await processCandidate(store, candidate, sourceStore, policy, engine);
      state.retryAssetId = undefined;
      state.retryAttempts = 0;
      state.retrying = 0;
      state.lastError = undefined;
      return result;
    } catch (error) {
      if (isConfigurationError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const retryingSameAsset = state.retryAssetId === key;
      state.retryAssetId = key;
      state.retryAttempts = retryingSameAsset ? Math.min(MAX_ATTEMPTS, state.retryAttempts + 1) : 1;
      state.retrying = 1;
      state.lastError = message.slice(0, 1_500);
      if (state.retryAttempts >= MAX_ATTEMPTS && !isTransientError(error)) {
        await quarantine(store, candidate, message, 'FAILED_HELD_AFTER_RETRIES');
        state.retryAssetId = undefined;
        state.retryAttempts = 0;
        state.retrying = 0;
        await saveState(store, state);
        return null;
      }
      await saveState(store, state);
      await delay(Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, state.retryAttempts - 1)));
    }
  }
}

async function processDirectCanary(
  shop: ShopifyAdmin,
  store: ImageJobStore,
  state: WorkerState,
  sourceStore: string,
  policy: AstraMediaPolicy,
  engine: ConservativeBackgroundEngine
): Promise<void> {
  state.phase = 'CANARY';
  await saveState(store, state);
  const data = await shop.gql<JsonObject>(EXACT_CANARY_MEDIA, { query: `sku:${CANARY_PART_NUMBER}` });
  const candidates = exactCanaryCandidates(data, CANARY_PART_NUMBER);
  if (!candidates.length) {
    throw new Error(`CONFIGURATION: exact Shopify product-media canary ${CANARY_PART_NUMBER} was not found`);
  }
  for (const candidate of candidates) {
    const result = await processWithRecovery(store, state, candidate, sourceStore, policy, engine);
    if (result?.remoteAiUsed) await delay(MIN_INTERVAL_MS);
    if (!result || !['PASSED', 'DUPLICATE'].includes(result.outcome) || !result.mapped) continue;
    state.canaryPassed = true;
    state.canaryCandidateKey = shopifyCandidateKey(candidate);
    applyResult(state, result);
    state.retrying = 0;
    state.lastError = undefined;
    await saveState(store, state);
    return;
  }
  throw new Error(`CONFIGURATION: no actual ${CANARY_PART_NUMBER} product photo passed the locked Ferrari and Astra gates`);
}

async function worker(): Promise<void> {
  if (process.env.SHOPIFY_MEDIA_RIGHTS_CONFIRMED !== 'true') {
    throw new Error('CONFIGURATION: SHOPIFY_MEDIA_RIGHTS_CONFIRMED=true is required; originals cannot be processed without merchant authorization');
  }
  const store = new AzureBlobImageJobStore(
    required('IMAGE_STUDIO_STORAGE_ACCOUNT_URL'),
    required('IMAGE_STUDIO_STORAGE_CONTAINER'),
    required('IMAGE_STUDIO_STORAGE_SAS'),
    process.env.IMAGE_STUDIO_STORAGE_PREFIX || 'image-studio'
  );
  await store.initialize();
  const state = await store.getJob<WorkerState>(SHOPIFY_MEDIA_JOB_ID) || initialState();
  const releaseSha = String(process.env.SHOPIFY_MEDIA_RELEASE_SHA || '').trim().toLowerCase();
  if (releaseSha && !/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new Error('CONFIGURATION: SHOPIFY_MEDIA_RELEASE_SHA must be an exact 40-character Git commit SHA');
  }
  state.releaseSha = releaseSha || state.releaseSha;
  if (!state.queuePass) {
    state.queuePass = 'MAPPED';
    state.assetCursor = 0;
  }
  const shop = await ShopifyAdmin.create();
  const identity = await shop.verify();
  state.sourceStore = identity.name;
  const foundryKey = required('AZURE_FOUNDRY_API_KEY');
  const baseUrl = `${required('AZURE_FOUNDRY_ENDPOINT').replace(/\/$/, '')}/openai/v1`;
  const reviewModel = process.env.AZURE_FOUNDRY_REVIEW_DEPLOYMENT || 'gpt-6-astra-1';
  const imageModel = required('AZURE_FOUNDRY_IMAGE_DEPLOYMENT');
  const ai = new OpenAiImageEngine(foundryKey, fetch, {
    baseUrl,
    authMode: 'api-key',
    reviewModel,
    premiumImageModel: imageModel,
    economyImageModel: imageModel,
    supportsBackgroundControl: true
  });
  const policy = new AstraMediaPolicy(foundryKey, baseUrl, reviewModel);
  const engine = new ConservativeBackgroundEngine(ai, ai);
  const continuous = process.env.SHOPIFY_MEDIA_CONTINUOUS !== 'false';

  for (;;) {
    try {
      if (!state.canaryPassed) {
        await processDirectCanary(shop, store, state, identity.name, policy, engine);
      }
      const exportFile = await ensureExport(shop, store, state);
      if (!exportFile) {
        state.phase = 'AWAITING_EXPORT';
        await saveState(store, state);
        await delay(30_000);
        continue;
      }
      const scan = await scanShopifyExport(exportFile);
      state.discovered = scan.mediaRows;
      if (!state.canaryPassed) {
        state.phase = 'CANARY';
        await saveState(store, state);
        let canaryFound = false;
        for await (const candidate of streamShopifyCandidates(exportFile, scan.productSkus, 'MAPPED')) {
          if (candidate.source !== 'SHOPIFY_PRODUCT_MEDIA' || !candidate.partNumbers.includes(CANARY_PART_NUMBER)) continue;
          canaryFound = true;
          const result = await processWithRecovery(store, state, candidate, identity.name, policy, engine);
          if (result?.remoteAiUsed) await delay(MIN_INTERVAL_MS);
          if (!result || !['PASSED', 'DUPLICATE'].includes(result.outcome) || !result.mapped) continue;
          state.canaryPassed = true;
          state.canaryCandidateKey = shopifyCandidateKey(candidate);
          applyResult(state, result);
          state.retrying = 0;
          state.lastError = undefined;
          await saveState(store, state);
          break;
        }
        if (!canaryFound) throw new Error(`CONFIGURATION: exact Shopify product-media canary ${CANARY_PART_NUMBER} was not found`);
        if (!state.canaryPassed) throw new Error(`CONFIGURATION: no actual ${CANARY_PART_NUMBER} product photo passed the locked Ferrari and Astra gates`);
      }

      state.phase = 'PROCESSING';
      const passes: ShopifyMediaQueuePass[] = state.queuePass === 'UNMAPPED' ? ['UNMAPPED'] : ['MAPPED', 'UNMAPPED'];
      for (const pass of passes) {
        state.queuePass = pass;
        let ordinal = 0;
        for await (const candidate of streamShopifyCandidates(exportFile, scan.productSkus, pass)) {
          if (ordinal < state.assetCursor) {
            ordinal += 1;
            continue;
          }
          if (shopifyCandidateKey(candidate) === state.canaryCandidateKey) {
            state.assetCursor += 1;
            ordinal += 1;
            await saveState(store, state);
            continue;
          }
          const result = await processWithRecovery(store, state, candidate, identity.name, policy, engine);
          if (result) applyResult(state, result);
          else {
            state.held += 1;
            state.processed += 1;
            state.unmapped += candidate.partNumbers.length ? 0 : 1;
          }
          state.assetCursor += 1;
          ordinal += 1;
          await saveState(store, state);
          if (result?.remoteAiUsed) await delay(MIN_INTERVAL_MS);
        }
        if (pass === 'MAPPED') {
          state.queuePass = 'UNMAPPED';
          state.assetCursor = 0;
          await saveState(store, state);
        }
      }
      state.phase = 'COMPLETE';
      state.completedAt = now();
      state.retrying = 0;
      await saveState(store, state);
      await unlink(exportFile).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      if (!continuous) return;
      await delay(6 * 60 * 60_000);
      state.phase = 'AWAITING_EXPORT';
      state.exportOperationId = undefined;
      state.exportPath = undefined;
      state.exportObjectCount = undefined;
      state.assetCursor = 0;
      state.queuePass = 'MAPPED';
      state.canaryPassed = false;
      state.canaryCandidateKey = undefined;
      state.requestFreshExport = true;
      state.discovered = 0;
      state.processed = 0;
      state.passed = 0;
      state.duplicates = 0;
      state.quarantinedLogos = 0;
      state.quarantinedNonProduct = 0;
      state.unmapped = 0;
      state.retrying = 0;
      state.held = 0;
      await saveState(store, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message.slice(0, 1_500);
      if (isConfigurationError(error)) state.phase = 'CONFIGURATION_HOLD';
      await saveState(store, state);
      console.error(`SHOPIFY MEDIA WORKER ${state.phase}: ${message}`);
      if (!continuous || isConfigurationError(error)) throw error;
      await delay(60_000);
    }
  }
}

worker().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
