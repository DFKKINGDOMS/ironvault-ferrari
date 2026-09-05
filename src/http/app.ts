import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z, ZodError } from 'zod';
import type { AppConfig } from '../config.js';
import { now } from '../domain/canonical.js';
import { DomainError } from '../domain/errors.js';
import { approvalSchema, createItemSchema, listingPayloadSchema, reviseSchema } from '../domain/schemas.js';
import type { EvidenceState } from '../domain/types.js';
import { EbayOAuthClient, REQUIRED_EBAY_SCOPES } from '../ebay/oauth-client.js';
import { signOAuthState, verifyOAuthState } from '../security/oauth-state.js';
import type { TokenVault } from '../security/token-vault.js';
import type { PartQuillService } from '../services/partquill-service.js';
import type { Store } from '../store/store.js';
import { quoteStudioBatch } from '../image-studio/cost-model.js';
import type { ImageStudioService } from '../image-studio/service.js';
import type { ImageJobStore } from '../image-studio/file-store.js';
import type { StudioJobRecord, StudioSourceUpload } from '../image-studio/types.js';
import { buildPartQuillMcpServer } from '../mcp/server.js';
import { buildPartQuillWidgetHtml } from '../mcp/widget.js';
import { resolveCatalogImage } from '../catalog/image-proxy.js';
import { buildSellerCommandPreview, buildSellerUiBootstrap, findPartNumber, listingCommandRequestSchema, parseListingCommand } from '../seller/command-preview.js';
import {
  buildSellerAssistantEvidence,
  deterministicSellerAssistantAnswer,
  isExplicitListingRequest,
  type SellerAssistant
} from '../seller/astra-assistant.js';
import { assessGmCatalogMapping, normalizeGmCatalogPart } from '../catalog/gm-catalog-quality.js';
import { RequestGuard, RequestLimitError } from '../security/request-guard.js';
import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import { applyEbayCategorySuggestion, buildCatalogListingIntelligence } from '../catalog/listing-intelligence.js';
import { EbayTaxonomyClient } from '../ebay/taxonomy-client.js';
import type { EbayReferenceService } from '../ebay/reference-service.js';
import { isBlockedReferenceImageBytes } from '../ebay/reference-image-policy.js';
import type { CommunityImageService } from '../community/service.js';
import { EbayVeroProfileService } from '../ebay/vero-profile-service.js';
import { MIGRATION_TABLE_NAMES } from '../store/migration-transfer.js';
import {
  verifyGithubDeereWorkerOidcToken,
  verifyGithubMediaMigrationOidcToken,
  verifyGithubMigrationOidcToken
} from '../security/github-migration-oidc.js';
import { loadAzureCatalogScan } from '../catalog/azure-blob-media.js';
import {
  loadGmCatalogPage,
  renderGmCalloutImage,
  resolveGmCatalogCallout
} from '../catalog/gm-callout.js';
import {
  buildVintageGmShortlist,
  isVintageGmShortlistCommand,
  vintageGmShortlistRequestedCount
} from '../vintage-gm/shortlist.js';
import {
  buildVintageGmInventoryAnswer,
  parseVintageGmInventoryQuestion
} from '../vintage-gm/inventory-question.js';
import { VINTAGE_GM_BRANDS, type VintageGmInventoryRecord } from '../vintage-gm/types.js';
import type { EpcImageService } from '../epc-image/service.js';
import type { EpcArtifactKind, EpcJobRecord } from '../epc-image/types.js';
import type { DeereCollectionPilotStore } from '../deere-collection-pilot/store.js';
import type { ShopifyMediaCatalog } from '../shopify-media/catalog.js';

const itemParams = z.object({ itemId: z.string().uuid() });
const sellerParams = z.object({ sellerId: z.string().min(1) });
const gmPageParams = z.object({ pageId: z.coerce.number().int().min(1).max(9_999_999) });
const ebayReferenceParams = z.object({
  partNumber: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/)
});
const ebayReferenceImageParams = ebayReferenceParams.extend({
  index: z.coerce.number().int().min(0).max(2)
});
const shopifyMediaImageParams = z.object({
  partNumber: z.string().trim().min(5).max(64).regex(/^[A-Za-z0-9]+$/),
  assetId: z.string().regex(/^[a-f0-9]{16,64}$/)
});
const referenceAssetParams = z.object({
  fileName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]*(?:_[0-9]+)?\.png$/)
});
const ebayCategoryParams = z.object({ categoryId: z.string().regex(/^\d+$/) });
const ebayCategoryQuery = z.object({
  query: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(2_500).default(2_000)
});
const evidenceSchema = z.object({
  field: z.string().min(1),
  value: z.unknown(),
  state: z.enum([
    'EBAY_CATALOG_MATCH',
    'EBAY_COMPATIBILITY',
    'SELLER_CONFIRMED',
    'MEASURED',
    'IMAGE_CANDIDATE',
    'FITMENT_NOT_VERIFIED',
    'CONFLICTING_EVIDENCE',
    'BLOCKED',
    'AUTHORIZATION_REQUIRED',
    'REMOTE_CHANGE_DETECTED',
    'COMPATIBILITY_REOPENED'
  ] satisfies EvidenceState[]),
  source: z.string().min(1),
  sourceReference: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  createdBy: z.string().min(1),
  supersedesId: z.string().uuid().optional()
});

const imageSchema = z.object({
  sellerId: z.string().min(1),
  kind: z.enum(['ORIGINAL', 'DETERMINISTIC_DERIVATIVE', 'GENERATIVE_DERIVATIVE']),
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  base64: z.string().min(1),
  originalImageId: z.string().uuid().optional(),
  rightsBasis: z.enum(['SELLER_PHOTOGRAPH', 'BUSINESS_OWNED', 'WRITTEN_PERMISSION']),
  watermarkStatus: z.enum(['NONE', 'SELLER_OWNED', 'AUTHORIZED_SUPPLIER', 'SUSPECTED_THIRD_PARTY']),
  itemPixelsPreserved: z.boolean().optional()
});

const gmCatalogImportSchema = z.object({
  datasetId: z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).optional(),
  records: z.array(z.object({
    partNumber: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9\s./-]*$/),
    verificationState: z.string().min(1)
  }).passthrough()).min(1).max(1000),
  complete: z.boolean().default(false)
});
const vintageDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/);
const vintageGmInventoryRecordSchema = z.object({
  sourceRow: z.number().int().min(2).max(5_000_000),
  productName: z.string().max(240),
  sku: z.string().max(96),
  partNumber: z.string().regex(/^[A-Z0-9]+$/).max(64).nullable(),
  brand: z.enum(VINTAGE_GM_BRANDS),
  description: z.string().max(1_000),
  quantity: z.number().int().min(0).max(100_000_000),
  sourcePrice: vintageDecimalSchema,
  sourceWeight: vintageDecimalSchema,
  normalizationState: z.enum([
    'NORMALIZED_EXACT_KEY',
    'REJECTED_SCIENTIFIC_NOTATION',
    'REJECTED_EMPTY_SKU',
    'REJECTED_NO_DIGIT'
  ]),
  normalizationIssue: z.string().max(240).nullable()
}).superRefine((record, context) => {
  if (record.normalizationState === 'NORMALIZED_EXACT_KEY' && !record.partNumber) {
    context.addIssue({ code: 'custom', path: ['partNumber'], message: 'normalized rows require a part number' });
  }
  if (record.normalizationState !== 'NORMALIZED_EXACT_KEY' && record.partNumber) {
    context.addIssue({ code: 'custom', path: ['partNumber'], message: 'rejected rows cannot carry a normalized part number' });
  }
});
const vintageGmImportSchema = z.object({
  datasetId: z.string().trim().min(3).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceFileName: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*\.csv$/i),
  sourceTotalRows: z.number().int().min(0).max(5_000_000),
  expectedGmRows: z.number().int().min(1).max(1_000_000),
  records: z.array(vintageGmInventoryRecordSchema).min(1).max(1000),
  complete: z.boolean().default(false)
});
const migrationTableParams = z.object({ table: z.enum(MIGRATION_TABLE_NAMES) });
const migrationExportQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(250)
});
const migrationImportSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).max(1000)
});

function secureTokenMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const actual = Buffer.from(provided);
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export interface AppDependencies {
  config: AppConfig;
  store: Store;
  service: PartQuillService;
  tokenVault?: TokenVault;
  imageStudio?: ImageStudioService;
  epcImage?: EpcImageService;
  deereCollectionPilot?: DeereCollectionPilotStore;
  imageJobStore?: ImageJobStore;
  ebayReference?: EbayReferenceService;
  communityImages?: CommunityImageService;
  shopifyMedia?: ShopifyMediaCatalog;
  sellerAssistant?: SellerAssistant;
}

function publicStudioJob(job: StudioJobRecord) {
  return {
    ...job,
    images: job.images.map(({ originalPath: _originalPath, resultPath: _resultPath, ...image }) => ({
      ...image,
      originalUrl: `/v1/image-studio/jobs/${job.id}/images/${image.id}/original`,
      ...(image.resultSha256 ? { resultUrl: `/v1/image-studio/jobs/${job.id}/images/${image.id}/result` } : {})
    }))
  };
}

function publicEpcJob(job: EpcJobRecord) {
  const {
    sourceImagePath: _sourceImagePath,
    cleanBaseImagePath: _cleanBaseImagePath,
    interactiveImagePath: _interactiveImagePath,
    thumbnailImagePath: _thumbnailImagePath,
    calloutMapPath: _calloutMapPath,
    ...publicJob
  } = job;
  const artifact = (kind: EpcArtifactKind) => `/v1/epc-image/jobs/${job.id}/artifacts/${kind}`;
  return {
    ...publicJob,
    artifacts: {
      source: artifact('source'),
      ...(job.cleanBaseImagePath ? { cleanBase: artifact('clean-base') } : {}),
      ...(job.interactiveImagePath ? { interactive: artifact('interactive') } : {}),
      ...(job.thumbnailImagePath ? { thumbnail: artifact('thumbnail') } : {}),
      ...(job.calloutMapPath ? { calloutMap: artifact('callout-map') } : {})
    }
  };
}

const DEERE_WORKER_STATE_ID = 'deere-collection-production-v3';
const DEERE_WORKER_LOCK_VERSION = 'ironvault-deere-exact-model-monochrome-v3';
const deereWorkerStateSchema = z.object({
  id: z.string().optional(),
  version: z.number().int().positive(),
  lockVersion: z.literal(DEERE_WORKER_LOCK_VERSION),
  collections: z.record(z.string(), z.unknown()),
  runs: z.array(z.unknown()).max(120),
  updatedAt: z.string().optional(),
  totalEligibleCollections: z.number().int().nonnegative().optional()
}).passthrough();

function deereWorkerBearer(authorization: string | undefined): string | undefined {
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
}

function deereWorkerAzureUrl(config: AppConfig, operation: 'responses' | 'images/generations'): string {
  if (!config.AZURE_FOUNDRY_ENDPOINT) throw new Error('Azure Foundry endpoint is not configured');
  const root = config.AZURE_FOUNDRY_ENDPOINT.replace(/\/$/, '');
  return `${root}/openai/v1/${operation}`;
}

function validatedDeereWorkerAiPayload(
  config: AppConfig,
  operation: 'responses' | 'images/generations',
  body: unknown
): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object body required');
  const payload = { ...(body as Record<string, unknown>) };
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > 25 * 1024 * 1024) throw new Error('request exceeds Deere worker limit');
  if (payload.stream === true || payload.background === true || payload.tools !== undefined) {
    throw new Error('streaming, background mode, and tools are disabled for the Deere worker');
  }

  if (operation === 'responses') {
    const model = config.AZURE_FOUNDRY_REVIEW_DEPLOYMENT;
    if (!model || payload.model !== model) throw new Error('unapproved Deere review deployment');
    if (!Array.isArray(payload.input) || payload.input.length < 1) throw new Error('review input is required');
    const maxOutput = Number(payload.max_output_tokens ?? 0);
    if (!Number.isInteger(maxOutput) || maxOutput < 1 || maxOutput > 5_000) {
      throw new Error('max_output_tokens must be between 1 and 5000');
    }
  } else {
    const model = config.AZURE_FOUNDRY_IMAGE_DEPLOYMENT;
    if (!model || payload.model !== model) throw new Error('unapproved Deere image deployment');
    if (typeof payload.prompt !== 'string' || payload.prompt.length < 40 || payload.prompt.length > 16_000) {
      throw new Error('image prompt length is outside the Deere worker contract');
    }
    if (payload.n !== 1 || payload.size !== '1024x1024' || !['low', 'medium', 'high'].includes(String(payload.quality))) {
      throw new Error('image request must use one 1024x1024 approved-quality image');
    }
  }
  return payload;
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, store, service, tokenVault, imageStudio, imageJobStore, epcImage, deereCollectionPilot, ebayReference, communityImages, shopifyMedia, sellerAssistant } = dependencies;
  const veroProfiles = new EbayVeroProfileService();
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 128 * 1024 * 1024 });
  const webRoot = resolve(process.cwd(), 'dist/web');
  const referenceAssetRoot = resolve(process.cwd(), 'data/reference-assets');
  const sellerIndexPath = join(webRoot, 'index.html');
  const sellerIndex = existsSync(sellerIndexPath)
    ? await readFile(sellerIndexPath, 'utf8')
    : '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PartQuill seller workspace</title></head><body><main><h1>PartQuill seller workspace</h1><p>The production seller bundle is created by npm run build.</p></main></body></html>';
  const assetRoot = join(webRoot, 'assets');
  if (existsSync(assetRoot)) {
    await app.register(staticFiles, {
      root: assetRoot,
      prefix: '/assets/',
      decorateReply: false,
      cacheControl: true,
      maxAge: '1y',
      immutable: true
    });
  }
  const mcpGuard = new RequestGuard(
    config.MCP_RATE_LIMIT_MAX,
    config.MCP_RATE_LIMIT_WINDOW_MS,
    config.MCP_MAX_CONCURRENCY
  );
  const sellerPreviewGuard = new RequestGuard(
    config.SELLER_PREVIEW_RATE_LIMIT_MAX,
    config.SELLER_PREVIEW_RATE_LIMIT_WINDOW_MS,
    config.SELLER_PREVIEW_MAX_CONCURRENCY
  );
  const sellerAssistantGuard = new RequestGuard(
    config.SELLER_ASSISTANT_RATE_LIMIT_MAX,
    config.SELLER_ASSISTANT_RATE_LIMIT_WINDOW_MS,
    config.SELLER_ASSISTANT_MAX_CONCURRENCY
  );
  const communityUploadGuard = new RequestGuard(
    config.COMMUNITY_UPLOAD_RATE_LIMIT_MAX,
    config.COMMUNITY_UPLOAD_RATE_LIMIT_WINDOW_MS,
    1
  );
  const ebayTaxonomy = config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET
    ? new EbayTaxonomyClient(config)
    : undefined;
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  });
  await app.register(multipart, {
    limits: { files: Math.max(config.IMAGE_STUDIO_MAX_IMAGES, config.COMMUNITY_IMAGE_MAX_IMAGES), fileSize: 12 * 1024 * 1024, parts: config.COMMUNITY_IMAGE_MAX_IMAGES + 12 }
  });

  app.addHook('onRequest', async (request, reply) => {
    const publicPaths = ['/health', '/ready', '/mcp', '/v1/oauth/ebay/callback'];
    if (['GET', 'HEAD'].includes(request.method) && (
      request.url === '/'
      || request.url.startsWith('/?')
      || request.url === '/image-studio'
      || request.url.startsWith('/image-studio?')
      || request.url === '/community-images'
      || request.url.startsWith('/community-images?')
      || request.url.startsWith('/assets/')
      || request.url.startsWith('/connected')
    )) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/seller-ui/bootstrap')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/seller-ui/ebay-categories')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/seller-ui/ebay-category-policy/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/seller-ui/ebay-reference/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/seller-ui/vero-profiles')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/reference-assets/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/community-assets/')) return;
    if (['GET', 'HEAD'].includes(request.method) && request.url.startsWith('/v1/deere-model-pilot/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/community/submissions/')) return;
    if (request.method === 'POST' && request.url === '/v1/community/submissions') return;
    if (request.method === 'POST' && request.url.startsWith('/v1/seller-ui/command-preview')) return;
    if (request.method === 'POST' && request.url === '/internal/gm-catalog/import') return;
    if (request.method === 'POST' && request.url === '/internal/vintage-gm/import') return;
    if (request.url.startsWith('/internal/migration/')) return;
    if (request.url.startsWith('/v1/internal/deere-worker/')) return;
    if (publicPaths.some((path) => request.url.startsWith(path))) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/catalog/images/')) return;
    if (['GET', 'HEAD'].includes(request.method) && request.url.startsWith('/v1/shopify-media/parts/')) return;
    if (['GET', 'HEAD'].includes(request.method) && request.url.startsWith('/v1/gm-catalog/pages/')) return;
    if (['GET', 'HEAD'].includes(request.method) && request.url.startsWith('/v1/gm-catalog/parts/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/image-studio/quote')) return;
    if (
      (request.url.startsWith('/v1/image-studio/') || request.url.startsWith('/v1/epc-image/')) &&
      config.IMAGE_STUDIO_ACCESS_TOKEN &&
      request.headers['x-partquill-studio-token'] === config.IMAGE_STUDIO_ACCESS_TOKEN
    ) {
      return;
    }
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${config.PARTQUILL_API_KEY}`) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'valid PartQuill API key required' } });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof RequestLimitError) {
      return reply
        .header('retry-after', String(error.retryAfterSeconds))
        .code(429)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'request validation failed', issues: error.issues } });
    }
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' } });
  });

  const authenticateDeereWorker = async (authorization: string | undefined): Promise<boolean> =>
    verifyGithubDeereWorkerOidcToken(deereWorkerBearer(authorization));

  app.get('/v1/internal/deere-worker/state', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!await authenticateDeereWorker(request.headers.authorization)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'trusted Deere worker OIDC token required' } });
    }
    if (!imageJobStore) {
      return reply.code(503).send({ error: { code: 'STATE_STORE_UNAVAILABLE', message: 'Deere worker state store is unavailable' } });
    }
    const state = await imageJobStore.getJob<Record<string, unknown> & { id: string }>(DEERE_WORKER_STATE_ID);
    return reply.header('cache-control', 'no-store').send(state ?? {
      id: DEERE_WORKER_STATE_ID,
      version: 1,
      lockVersion: DEERE_WORKER_LOCK_VERSION,
      collections: {},
      runs: []
    });
  });

  app.put('/v1/internal/deere-worker/state', { bodyLimit: 12 * 1024 * 1024 }, async (request, reply) => {
    if (!await authenticateDeereWorker(request.headers.authorization)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'trusted Deere worker OIDC token required' } });
    }
    if (!imageJobStore) {
      return reply.code(503).send({ error: { code: 'STATE_STORE_UNAVAILABLE', message: 'Deere worker state store is unavailable' } });
    }
    const state = deereWorkerStateSchema.parse(request.body);
    const stored = { ...state, id: DEERE_WORKER_STATE_ID };
    await imageJobStore.saveJob(stored);
    return reply.header('cache-control', 'no-store').send({ saved: true, id: DEERE_WORKER_STATE_ID, updatedAt: stored.updatedAt ?? null });
  });

  const proxyDeereWorkerAi = async (
    operation: 'responses' | 'images/generations',
    request: { headers: { authorization?: string }; body: unknown },
    reply: FastifyReply
  ) => {
    if (!await authenticateDeereWorker(request.headers.authorization)) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'trusted Deere worker OIDC token required' } });
    }
    if (!config.AZURE_FOUNDRY_API_KEY) {
      return reply.code(503).send({ error: { code: 'AZURE_UNAVAILABLE', message: 'Azure Foundry credential is unavailable' } });
    }
    let payload: Record<string, unknown>;
    try {
      payload = validatedDeereWorkerAiPayload(config, operation, request.body);
    } catch (error) {
      return reply.code(400).send({ error: { code: 'INVALID_DEERE_WORKER_REQUEST', message: (error as Error).message } });
    }
    const upstream = await fetch(deereWorkerAzureUrl(config, operation), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-key': config.AZURE_FOUNDRY_API_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(operation === 'responses' ? 300_000 : 600_000)
    });
    const upstreamText = await upstream.text();
    let upstreamBody: unknown;
    try {
      upstreamBody = JSON.parse(upstreamText);
    } catch {
      upstreamBody = { error: { code: 'AZURE_INVALID_RESPONSE', message: upstreamText.slice(0, 1_000) } };
    }
    return reply
      .code(upstream.status)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(upstreamBody);
  };

  app.post('/v1/internal/deere-worker/ai/responses', { bodyLimit: 25 * 1024 * 1024 }, async (request, reply) =>
    proxyDeereWorkerAi('responses', request, reply));
  app.post('/v1/internal/deere-worker/ai/images/generations', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) =>
    proxyDeereWorkerAi('images/generations', request, reply));

  app.get('/health', async () => ({ status: 'ok', service: 'partquill-api', version: '0.24.0' }));
  app.get('/', async (_request, reply) => reply
    .header(
      'content-security-policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    )
    .header('referrer-policy', 'strict-origin-when-cross-origin')
    .header('x-content-type-options', 'nosniff')
    .header('x-frame-options', 'DENY')
    .header('cache-control', 'no-cache')
    .type('text/html; charset=utf-8')
    .send(sellerIndex));
  app.get('/image-studio', async (_request, reply) => reply
    .header('cache-control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(buildPartQuillWidgetHtml()));
  app.get('/community-images', async (_request, reply) => reply
    .header(
      'content-security-policy',
      "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    )
    .header('referrer-policy', 'strict-origin-when-cross-origin')
    .header('cache-control', 'no-cache')
    .header('x-content-type-options', 'nosniff')
    .header('x-frame-options', 'DENY')
    .type('text/html; charset=utf-8')
    .send(sellerIndex));
  app.get('/connected', async (_request, reply) => reply.redirect('/?connected=ebay'));
  app.get('/v1/seller-ui/bootstrap', async (_request, reply) => reply
    .header('cache-control', 'no-store')
    .send({
      ...buildSellerUiBootstrap(config),
      imageStudio: {
        mode: config.IMAGE_STUDIO_MODE,
        path: '/image-studio',
        activated: Boolean(imageStudio && config.IMAGE_STUDIO_MODE === 'live' && config.PARTQUILL_AI_PROVIDER !== 'disabled')
      },
      communityImages: {
        enabled: Boolean(communityImages),
        maxImages: config.COMMUNITY_IMAGE_MAX_IMAGES,
        automatedReviewActive: communityImages?.automatedReviewActive ?? false,
        editMode: communityImages?.editMode ?? config.COMMUNITY_EDIT_MODE,
        chatGptManualActive: communityImages?.chatGptManualActive ?? false,
        gitArchiveConnected: communityImages?.archiveActivated ?? false
      },
      shopifyMedia: {
        enabled: Boolean(shopifyMedia),
        profile: 'ferrari-product-photo-v1',
        actualItemConfirmationRequired: true
      },
      assistant: {
        enabled: sellerAssistant?.available ?? false,
        provider: sellerAssistant?.provider ?? 'DETERMINISTIC_FALLBACK',
        model: sellerAssistant?.model ?? null,
        questionsAreReadOnly: true,
        explicitListingRequestRequired: true
      }
    }));
  app.get('/v1/seller-ui/ebay-categories', async (request, reply) => {
    const { query, limit } = ebayCategoryQuery.parse(request.query);
    const categories = await store.listEbayLeafCategories?.(query, limit) ?? [];
    return reply
      .header('cache-control', 'private, max-age=300')
      .header('x-content-type-options', 'nosniff')
      .send({
        marketplaceId: 'EBAY_US',
        rootCategoryId: '6028',
        source: categories.length ? 'EBAY_OFFICIAL_MOTORS_CATEGORY_TREE' : 'UNAVAILABLE',
        categories
      });
  });
  app.get('/v1/seller-ui/ebay-category-policy/:categoryId', async (request, reply) => {
    const { categoryId } = ebayCategoryParams.parse(request.params);
    if (!ebayTaxonomy) {
      return reply.header('cache-control', 'no-store').send({
        categoryId,
        source: 'UNAVAILABLE',
        verified: false,
        itemConditionRequired: true,
        conditions: []
      });
    }
    try {
      const policy = await ebayTaxonomy.getItemConditionPolicy(categoryId);
      return reply.header('cache-control', 'private, max-age=1800').send({
        categoryId,
        source: policy ? 'EBAY_METADATA_API' : 'UNAVAILABLE',
        verified: Boolean(policy),
        itemConditionRequired: policy?.itemConditionRequired ?? true,
        conditions: policy?.conditions ?? []
      });
    } catch (error) {
      request.log.warn({ error, categoryId }, 'eBay condition policy unavailable');
      return reply.header('cache-control', 'no-store').send({
        categoryId,
        source: 'UNAVAILABLE',
        verified: false,
        itemConditionRequired: true,
        conditions: []
      });
    }
  });
  app.get('/v1/seller-ui/vero-profiles', async (_request, reply) => reply
    .header('cache-control', 'private, max-age=3600')
    .header('x-content-type-options', 'nosniff')
    .send(await veroProfiles.getSnapshot()));
  app.post('/v1/seller-ui/command-preview', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const permit = sellerPreviewGuard.acquire(request.ip);
    try {
      const { command } = listingCommandRequestSchema.parse(request.body);
      const inventoryIntent = parseVintageGmInventoryQuestion(command);
      if (inventoryIntent) {
        const pool = store.queryVintageGmInventory
          ? await store.queryVintageGmInventory(inventoryIntent)
          : {
              dataset: await store.getVintageGmStatus?.() ?? null,
              matches: [],
              truncated: false
            };
        return reply
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .send({ inventoryAnswer: buildVintageGmInventoryAnswer(command, inventoryIntent, pool) });
      }
      if (isVintageGmShortlistCommand(command)) {
        const requested = vintageGmShortlistRequestedCount(command);
        const pool = store.listVintageGmCatalogMatches
          ? await store.listVintageGmCatalogMatches(Math.min(2_500, Math.max(250, requested * 50)))
          : { dataset: null, matches: [] };
        return reply
          .header('cache-control', 'no-store')
          .header('x-content-type-options', 'nosniff')
          .send({ shortlist: buildVintageGmShortlist(command, pool) });
      }
      if (!isExplicitListingRequest(command)) {
        const assistantPermit = sellerAssistantGuard.acquire(request.ip);
        try {
          const partNumber = findPartNumber(command);
          let rawCatalog: GmCatalogPart | undefined;
          let merchantMedia = null;
          let exactInventoryAnswer: ReturnType<typeof buildVintageGmInventoryAnswer> | null = null;
          if (partNumber) {
            try {
              rawCatalog = await store.lookupGmCatalogPart?.(partNumber);
            } catch (error) {
              request.log.warn({ error, partNumber }, 'catalog lookup unavailable for read-only assistant answer');
            }
            if (shopifyMedia) {
              try {
                merchantMedia = await shopifyMedia.lookup(partNumber);
              } catch (error) {
                request.log.warn({ error, partNumber }, 'merchant media lookup unavailable for read-only assistant answer');
              }
            }
            if (store.queryVintageGmInventory) {
              try {
                const exactInventoryIntent = parseVintageGmInventoryQuestion(`Do we have part ${partNumber} in stock?`);
                if (exactInventoryIntent) {
                  const exactInventoryPool = await store.queryVintageGmInventory(exactInventoryIntent);
                  exactInventoryAnswer = buildVintageGmInventoryAnswer(command, exactInventoryIntent, exactInventoryPool);
                }
              } catch (error) {
                request.log.warn({ error, partNumber }, 'inventory lookup unavailable for read-only assistant answer');
              }
            }
          }
          const mapping = assessGmCatalogMapping(rawCatalog, partNumber);
          const catalog = normalizeGmCatalogPart(rawCatalog, partNumber);
          const evidence = buildSellerAssistantEvidence(partNumber, catalog, mapping, merchantMedia, exactInventoryAnswer);
          let assistantAnswer;
          if (sellerAssistant?.available) {
            try {
              assistantAnswer = await sellerAssistant.answer(command, evidence);
            } catch (error) {
              request.log.warn({ error }, 'Azure Foundry seller assistant unavailable; returning fail-safe evidence answer');
              assistantAnswer = deterministicSellerAssistantAnswer(command, evidence, true);
            }
          } else {
            assistantAnswer = deterministicSellerAssistantAnswer(command, evidence);
          }
          return reply
            .header('cache-control', 'no-store')
            .header('x-content-type-options', 'nosniff')
            .send({ assistantAnswer });
        } finally {
          assistantPermit.release();
        }
      }
      const intent = parseListingCommand(command);
      const rawGmCatalog = intent.partNumber
        ? await store.lookupGmCatalogPart?.(intent.partNumber)
        : undefined;
      const mapping = assessGmCatalogMapping(rawGmCatalog, intent.partNumber);
      let gmCatalog = normalizeGmCatalogPart(rawGmCatalog, intent.partNumber);
      if (gmCatalog) {
        try {
          const calloutEvidence = await resolveGmCatalogCallout(config, gmCatalog);
          if (calloutEvidence) {
            const correctedDescription = calloutEvidence.description ?? gmCatalog.description;
            const correctedProductType = correctedDescription?.split(/[,;(]/, 1)[0]?.trim() || gmCatalog.productType;
            gmCatalog = {
              ...gmCatalog,
              calloutEvidence,
              description: correctedDescription,
              productType: correctedProductType,
              catalogGroup: calloutEvidence.catalogGroup ?? gmCatalog.catalogGroup
            };
          }
        } catch (error) {
          request.log.warn({ error, partNumber: gmCatalog.partNumber }, 'GM callout detection unavailable; catalog evidence remains held');
        }
      }
      let intelligence = gmCatalog ? buildCatalogListingIntelligence(gmCatalog) : undefined;
      if (gmCatalog && intelligence && ebayTaxonomy) {
        try {
          const suggestion = await ebayTaxonomy.suggestCategory(intelligence.category.query);
          if (suggestion) intelligence = applyEbayCategorySuggestion(intelligence, suggestion);
        } catch (error) {
          request.log.warn({ error }, 'eBay category suggestion unavailable; using held PartQuill candidate');
        }
      }
      let merchantMedia = null;
      if (intent.partNumber && shopifyMedia) {
        try {
          merchantMedia = await shopifyMedia.lookup(intent.partNumber);
        } catch (error) {
          request.log.warn({ error, partNumber: intent.partNumber }, 'Shopify merchant media lookup unavailable; seller photo gate remains active');
        }
      }
      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .send({ preview: buildSellerCommandPreview(command, gmCatalog, intelligence, mapping, merchantMedia) });
    } finally {
      permit.release();
    }
  });
  app.get('/v1/seller-ui/ebay-reference/:partNumber', async (request, reply) => {
    const permit = sellerPreviewGuard.acquire(request.ip);
    try {
      const { partNumber } = ebayReferenceParams.parse(request.params);
      const rawCatalog = await store.lookupGmCatalogPart?.(partNumber);
      const catalog = normalizeGmCatalogPart(rawCatalog, partNumber);
      const result = ebayReference
        ? await ebayReference.lookup(partNumber, catalog)
        : { status: 'DISCOVERY_DISABLED' as const, reference: null, searchSuppressed: true };
      const publicResult = result.reference
        ? {
            ...result,
            reference: {
              ...result.reference,
              images: result.reference.images.map((image, index) => ({
                alt: result.status === 'PRIVATE_REFERENCE_ARCHIVE'
                  ? `Permanent archived reference ${index + 1} for OEM part ${result.reference!.partNumber}`
                  : image.alt,
                ...(image.contributorCredit ? { contributorCredit: image.contributorCredit } : {}),
                viewUrl: image.url.startsWith('/')
                  ? image.url
                  : `/v1/seller-ui/ebay-reference/${encodeURIComponent(result.reference!.partNumber)}/image/${index}`
              }))
            }
          }
        : result;
      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .send(publicResult);
    } finally {
      permit.release();
    }
  });
  app.get('/v1/reference-assets/:fileName', async (request, reply) => {
    const { fileName } = referenceAssetParams.parse(request.params);
    const localPath = resolve(referenceAssetRoot, fileName);
    if (!localPath.startsWith(`${referenceAssetRoot}/`) || !existsSync(localPath)) {
      return reply.code(404).send({ error: { code: 'REFERENCE_ASSET_NOT_AVAILABLE', message: 'reference asset is not available' } });
    }
    return reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .type('image/png')
      .send(createReadStream(localPath));
  });
  app.get('/v1/seller-ui/ebay-reference/:partNumber/image/:index', async (request, reply) => {
    const permit = sellerPreviewGuard.acquire(request.ip);
    try {
      const { partNumber, index } = ebayReferenceImageParams.parse(request.params);
      if (!ebayReference) return reply.code(404).send({ error: { code: 'REFERENCE_NOT_AVAILABLE', message: 'reference image is not available' } });
      const rawCatalog = await store.lookupGmCatalogPart?.(partNumber);
      const catalog = normalizeGmCatalogPart(rawCatalog, partNumber);
      const result = await ebayReference.lookup(partNumber, catalog);
      if (result.status !== 'MATCHED_LIVE_REFERENCE' || !result.reference) {
        return reply.code(404).send({ error: { code: 'REFERENCE_NOT_AVAILABLE', message: 'reference image is not available' } });
      }
      const source = result.reference.images[index]?.url;
      if (!source) return reply.code(404).send({ error: { code: 'REFERENCE_NOT_AVAILABLE', message: 'reference image is not available' } });
      const sourceUrl = new URL(source);
      if (sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'i.ebayimg.com') {
        return reply.code(502).send({ error: { code: 'INVALID_REFERENCE_SOURCE', message: 'reference source was rejected' } });
      }
      const upstream = await fetch(sourceUrl, {
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg', 'user-agent': 'PartQuill/0.15 (+https://partquill.com)' },
        redirect: 'error',
        signal: AbortSignal.timeout(12_000)
      });
      if (!upstream.ok) return reply.code(502).send({ error: { code: 'REFERENCE_UPSTREAM_ERROR', message: 'reference image is unavailable' } });
      const mediaType = upstream.headers.get('content-type')?.split(';')[0]?.trim();
      if (!mediaType || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mediaType)) {
        return reply.code(502).send({ error: { code: 'INVALID_REFERENCE_IMAGE', message: 'reference image type was rejected' } });
      }
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
        return reply.code(502).send({ error: { code: 'INVALID_REFERENCE_IMAGE', message: 'reference image size was rejected' } });
      }
      if (isBlockedReferenceImageBytes(bytes)) {
        return reply.code(404).send({ error: { code: 'REFERENCE_IMAGE_BLOCKED', message: 'reference image was blocked by visual policy' } });
      }
      return reply
        .header('cache-control', 'no-store, max-age=0')
        .header('pragma', 'no-cache')
        .header('x-content-type-options', 'nosniff')
        .type(mediaType)
        .send(bytes);
    } finally {
      permit.release();
    }
  });
  app.get('/v1/gm-catalog/pages/:pageId/image', async (request, reply) => {
    const { pageId } = gmPageParams.parse(request.params);
    const pageFolder = String(pageId).padStart(6, '0');
    const localPath = resolve(config.GM_CATALOG_SCAN_DIR, pageFolder, 'full_page.png');
    if (existsSync(localPath)) {
      return reply
        .header('cache-control', 'public, max-age=86400, immutable')
        .header('x-partquill-media-source', 'local')
        .header('x-content-type-options', 'nosniff')
        .type('image/png')
        .send(createReadStream(localPath));
    }
    try {
      const azureScan = await loadAzureCatalogScan(config, pageFolder);
      if (azureScan) {
        return reply
          .header('cache-control', 'public, max-age=86400, immutable')
          .header('x-partquill-media-source', 'azure-blob')
          .header('x-content-type-options', 'nosniff')
          .type(azureScan.contentType)
          .send(azureScan.bytes);
      }
    } catch (error) {
      request.log.warn({ error, pageId }, 'Azure catalog scan retrieval failed');
    }
    if (config.GM_CATALOG_MEDIA_BASE_URL) {
      const base = config.GM_CATALOG_MEDIA_BASE_URL.replace(/\/$/, '');
      const upstream = await fetch(`${base}/${pageFolder}/full_page.png`, { signal: AbortSignal.timeout(10_000) });
      if (upstream.ok) {
        const contentType = upstream.headers.get('content-type');
        if (contentType?.startsWith('image/')) {
          return reply
            .header('cache-control', 'public, max-age=86400')
            .header('x-partquill-media-source', 'media-base-url')
            .header('x-content-type-options', 'nosniff')
            .type(contentType)
            .send(Buffer.from(await upstream.arrayBuffer()));
        }
      }
    }
    return reply.code(404).send({ error: { code: 'CATALOG_SCAN_NOT_AVAILABLE', message: 'catalog scan is not available in PartQuill media storage' } });
  });
  app.get('/v1/gm-catalog/parts/:partNumber/callout', async (request, reply) => {
    const permit = sellerPreviewGuard.acquire(request.ip);
    try {
      const { partNumber } = ebayReferenceParams.parse(request.params);
      const rawCatalog = await store.lookupGmCatalogPart?.(partNumber);
      const catalog = normalizeGmCatalogPart(rawCatalog, partNumber);
      if (!catalog) return reply.code(404).send({ error: { code: 'CATALOG_PART_NOT_FOUND', message: 'exact catalog part was not found' } });
      const evidence = await resolveGmCatalogCallout(config, catalog);
      if (!evidence) return reply.code(404).send({ error: { code: 'CALLOUT_NOT_RESOLVED', message: 'an exact row-to-callout relationship was not resolved' } });
      return reply
        .header('cache-control', 'public, max-age=86400, stale-while-revalidate=604800')
        .header('x-content-type-options', 'nosniff')
        .send(evidence);
    } finally {
      permit.release();
    }
  });
  app.get('/v1/gm-catalog/parts/:partNumber/callout-image', async (request, reply) => {
    const permit = sellerPreviewGuard.acquire(request.ip);
    try {
      const { partNumber } = ebayReferenceParams.parse(request.params);
      const rawCatalog = await store.lookupGmCatalogPart?.(partNumber);
      const catalog = normalizeGmCatalogPart(rawCatalog, partNumber);
      if (!catalog) return reply.code(404).send({ error: { code: 'CATALOG_PART_NOT_FOUND', message: 'exact catalog part was not found' } });
      const evidence = await resolveGmCatalogCallout(config, catalog);
      if (!evidence) return reply.code(404).send({ error: { code: 'CALLOUT_NOT_RESOLVED', message: 'an exact row-to-callout relationship was not resolved' } });
      const scan = await loadGmCatalogPage(config, evidence.pageId);
      if (!scan) return reply.code(404).send({ error: { code: 'CATALOG_SCAN_NOT_AVAILABLE', message: 'catalog scan is not available in PartQuill media storage' } });
      const annotated = await renderGmCalloutImage(scan, evidence);
      return reply
        .header('cache-control', 'public, max-age=86400, stale-while-revalidate=604800')
        .header('content-disposition', `inline; filename="${evidence.partNumber}_callout_${evidence.calloutId}.png"`)
        .header('x-partquill-callout-id', evidence.calloutId)
        .header('x-content-type-options', 'nosniff')
        .type('image/png')
        .send(annotated);
    } finally {
      permit.release();
    }
  });
  app.post('/internal/gm-catalog/import', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const authorized = secureTokenMatches(supplied, config.GM_IMPORT_TOKEN)
      || (config.MIGRATION_GITHUB_OIDC_ENABLED && await verifyGithubMigrationOidcToken(supplied));
    if (!authorized || !store.importGmCatalogRecords) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
    }
    const { datasetId, records, complete } = gmCatalogImportSchema.parse(request.body);
    await store.importGmCatalogRecords(records as unknown as GmCatalogPart[], { datasetId, complete });
    return reply.header('cache-control', 'no-store').send({ datasetId: datasetId ?? null, imported: records.length, complete });
  });
  app.post('/internal/vintage-gm/import', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const authorized = secureTokenMatches(supplied, config.GM_IMPORT_TOKEN)
      || (config.MIGRATION_GITHUB_OIDC_ENABLED && await verifyGithubMigrationOidcToken(supplied));
    if (!authorized || !store.importVintageGmRecords) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
    }
    const payload = vintageGmImportSchema.parse(request.body);
    const status = await store.importVintageGmRecords(
      payload.records as VintageGmInventoryRecord[],
      {
        datasetId: payload.datasetId,
        sourceSha256: payload.sourceSha256,
        sourceFileName: payload.sourceFileName,
        sourceTotalRows: payload.sourceTotalRows,
        expectedGmRows: payload.expectedGmRows,
        complete: payload.complete
      }
    );
    return reply.header('cache-control', 'no-store').send({
      datasetId: payload.datasetId,
      imported: payload.records.length,
      complete: payload.complete,
      status
    });
  });
  const migrationAuthorized = async (authorization: string | undefined) => {
    const token = authorization?.replace(/^Bearer\s+/i, '');
    if (secureTokenMatches(token, config.MIGRATION_TRANSFER_TOKEN)) return true;
    return config.MIGRATION_GITHUB_OIDC_ENABLED && verifyGithubMigrationOidcToken(token);
  };
  const migrationUnavailable = (reply: { code: (status: number) => { send: (payload: unknown) => unknown } }) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });

  app.get('/internal/migration/media-upload-target', async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!(await verifyGithubMediaMigrationOidcToken(token))) {
      return migrationUnavailable(reply);
    }
    if (!config.AZURE_STORAGE_ACCOUNT_NAME
      || !config.GM_CATALOG_MEDIA_CONTAINER
      || !config.GM_CATALOG_MEDIA_UPLOAD_SAS) {
      return reply.code(503).send({
        error: { code: 'MEDIA_UPLOAD_NOT_CONFIGURED', message: 'media upload target is not configured' }
      });
    }
    const containerUrl = new URL(
      `https://${config.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${config.GM_CATALOG_MEDIA_CONTAINER}`
    );
    containerUrl.search = config.GM_CATALOG_MEDIA_UPLOAD_SAS.replace(/^\?/, '');
    return reply.header('cache-control', 'no-store').send({
      containerUrl: containerUrl.toString(),
      blobPrefix: config.GM_CATALOG_MEDIA_PREFIX.replace(/^\/+|\/+$/g, ''),
      pageRange: { first: 100001, last: 235000 }
    });
  });

  app.get('/internal/migration/manifest', async (request, reply) => {
    if (!(await migrationAuthorized(request.headers.authorization)) || !store.getMigrationManifest) {
      return migrationUnavailable(reply);
    }
    return reply.header('cache-control', 'no-store').send(await store.getMigrationManifest());
  });
  app.get('/internal/migration/export/:table', async (request, reply) => {
    if (!(await migrationAuthorized(request.headers.authorization)) || !store.exportMigrationTable) {
      return migrationUnavailable(reply);
    }
    const { table } = migrationTableParams.parse(request.params);
    const { offset, limit } = migrationExportQuery.parse(request.query);
    return reply.header('cache-control', 'no-store').send(await store.exportMigrationTable(table, offset, limit));
  });
  app.post('/internal/migration/reset', async (request, reply) => {
    if (!(await migrationAuthorized(request.headers.authorization)) || !store.resetMigrationTarget) {
      return migrationUnavailable(reply);
    }
    await store.resetMigrationTarget();
    return reply.header('cache-control', 'no-store').send({ reset: true });
  });
  app.post('/internal/migration/import/:table', { bodyLimit: 64 * 1024 * 1024 }, async (request, reply) => {
    if (!(await migrationAuthorized(request.headers.authorization)) || !store.importMigrationRows) {
      return migrationUnavailable(reply);
    }
    const { table } = migrationTableParams.parse(request.params);
    const { rows } = migrationImportSchema.parse(request.body);
    return reply.header('cache-control', 'no-store').send(await store.importMigrationRows(table, rows));
  });
  app.get('/v1/deere-model-pilot/latest', async (_request, reply) => {
    if (!deereCollectionPilot) {
      return reply.code(404).send({ error: { code: 'DEERE_PILOT_UNAVAILABLE', message: 'Deere model pilot is unavailable' } });
    }
    const batch = await deereCollectionPilot.publicLatest();
    if (!batch) {
      return reply.code(404).send({ error: { code: 'DEERE_PILOT_NOT_FOUND', message: 'No Deere model pilot batch is available' } });
    }
    return reply.header('cache-control', 'public,max-age=30').send({ batch });
  });

  app.get('/v1/deere-model-pilot/images/:slug', async (request, reply) => {
    if (!deereCollectionPilot) {
      return reply.code(404).send({ error: { code: 'DEERE_PILOT_UNAVAILABLE', message: 'Deere model pilot is unavailable' } });
    }
    const { slug } = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/) }).parse(request.params);
    const bytes = await deereCollectionPilot.readImage(slug);
    if (!bytes) {
      return reply.code(404).send({ error: { code: 'DEERE_PILOT_IMAGE_NOT_FOUND', message: 'Deere pilot image is unavailable' } });
    }
    return reply
      .header('cache-control', 'public,max-age=3600')
      .header('x-content-type-options', 'nosniff')
      .type('image/png')
      .send(Buffer.from(bytes));
  });

  app.get('/v1/shopify-media/parts/:partNumber/images/:assetId', async (request, reply) => {
    if (!shopifyMedia) {
      return reply.code(404).send({ error: { code: 'SHOPIFY_MEDIA_UNAVAILABLE', message: 'Merchant media is unavailable' } });
    }
    const { partNumber, assetId } = shopifyMediaImageParams.parse(request.params);
    const bytes = await shopifyMedia.readImage(partNumber, assetId);
    if (!bytes) {
      return reply.code(404).send({ error: { code: 'SHOPIFY_MEDIA_NOT_FOUND', message: 'No QA-passed merchant image matches this exact part key' } });
    }
    return reply
      .header('cache-control', 'public,max-age=3600,immutable')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('x-content-type-options', 'nosniff')
      .type('image/jpeg')
      .send(Buffer.from(bytes));
  });

  app.get('/ready', async (_request, reply) => {
    try {
      await store.ping?.();
      const [gmCatalog, vintageGm, shopifyMediaStatus] = await Promise.all([
        store.getGmCatalogStatus?.(),
        store.getVintageGmStatus?.(),
        shopifyMedia?.status().catch(() => null)
      ]);
      return {
        ready: true,
        ebay: { environment: config.EBAY_ENV, mode: config.EBAY_MODE, writesEnabled: config.ALLOW_EBAY_WRITES },
        ebayReferenceDiscovery: {
          mode: config.EBAY_REFERENCE_DISCOVERY_MODE,
          maxImages: config.EBAY_REFERENCE_MAX_IMAGES,
          cacheHours: config.EBAY_REFERENCE_CACHE_HOURS,
          permanentArchiveRequiresRights: true
        },
        persistence: config.DATABASE_URL ? 'postgres' : config.PILOT_EPHEMERAL_MODE ? 'ephemeral-memory-pilot' : 'memory',
        imageStudio: {
          mode: config.IMAGE_STUDIO_MODE,
          provider: config.PARTQUILL_AI_PROVIDER,
          activated: imageStudio?.activated ?? false,
          maxImages: config.IMAGE_STUDIO_MAX_IMAGES,
          storage: config.IMAGE_STUDIO_STORAGE_MODE
        },
        epcImage: {
          activated: epcImage?.activated ?? false,
          ruleVersion: 'eurospares-clean-epc-v1.0',
          canvas: { width: 1470, height: 1070 },
          storage: config.IMAGE_STUDIO_STORAGE_MODE
        },
        communityImages: {
          enabled: Boolean(communityImages),
          aiProvider: config.PARTQUILL_AI_PROVIDER,
          editMode: communityImages?.editMode ?? config.COMMUNITY_EDIT_MODE,
          chatGptManualActive: communityImages?.chatGptManualActive ?? false,
          maxImages: config.COMMUNITY_IMAGE_MAX_IMAGES,
          automatedReviewActive: communityImages?.automatedReviewActive ?? false,
          gitArchiveConnected: communityImages?.archiveActivated ?? false,
          requiresHumanReview: true,
          listingPayloadEligible: false
        },
        shopifyMedia: {
          enabled: Boolean(shopifyMedia),
          source: 'SHOPIFY_MERCHANT_MEDIA',
          profile: 'ferrari-product-photo-v1',
          originalsImmutable: true,
          derivativesMetadataStripped: true,
          actualItemConfirmationRequired: true,
          status: shopifyMediaStatus
        },
        sellerUi: {
          version: '0.24.0',
          commandPreview: true,
          astraAssistant: sellerAssistant?.available ?? false,
          questionsAreReadOnly: true,
          explicitListingRequestRequired: true,
          assistantProtection: {
            maxConcurrency: config.SELLER_ASSISTANT_MAX_CONCURRENCY,
            requestsPerWindow: config.SELLER_ASSISTANT_RATE_LIMIT_MAX,
            windowMs: config.SELLER_ASSISTANT_RATE_LIMIT_WINDOW_MS
          },
          vintageGmShortlist: true,
          vintageGmInventoryQuestions: true,
          publicEbayWritesDisabled: true
        },
        gmCatalog: gmCatalog ?? {
          datasetId: null,
          status: 'not_started',
          importedParts: 0,
          availableParts: 0,
          lastPartNumber: null
        },
        vintageGmCrosswalk: vintageGm ? {
          status: vintageGm.status,
          active: vintageGm.active,
          importedRows: vintageGm.importedRows,
          normalizedRows: vintageGm.normalizedRows,
          rejectedRows: vintageGm.rejectedRows,
          distinctPartNumbers: vintageGm.distinctPartNumbers,
          catalogKeyMatches: vintageGm.catalogKeyMatches
        } : {
          status: 'not_started',
          active: false,
          importedRows: 0,
          normalizedRows: 0,
          rejectedRows: 0,
          distinctPartNumbers: 0,
          catalogKeyMatches: 0
        },
        oemResearch: {
          mode: config.OEM_RESEARCH_MODE,
          rightsConfirmed: config.OEM_DATA_RIGHTS_CONFIRMED,
          requestsAllowed: config.OEM_RESEARCH_MODE === 'private-pilot' && config.OEM_DATA_RIGHTS_CONFIRMED
        },
        mcpProtection: {
          maxBodyBytes: config.MCP_MAX_BODY_BYTES,
          maxConcurrency: config.MCP_MAX_CONCURRENCY,
          requestsPerWindow: config.MCP_RATE_LIMIT_MAX,
          windowMs: config.MCP_RATE_LIMIT_WINDOW_MS
        }
      };
    } catch {
      return reply.code(503).send({ ready: false, reason: 'persistence unavailable' });
    }
  });

  app.post('/mcp', { bodyLimit: config.MCP_MAX_BODY_BYTES }, async (request, reply) => {
    const permit = mcpGuard.acquire(request.ip);
    const server = buildPartQuillMcpServer({
      oemResearchAllowed: config.OEM_RESEARCH_MODE === 'private-pilot' && config.OEM_DATA_RIGHTS_CONFIRMED,
      communityImages
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.raw.once('close', () => {
        void transport.close();
        void server.close();
      });
    } catch (error) {
      request.log.error(error);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'PartQuill MCP request failed' },
            id: null
          })
        );
      }
    } finally {
      permit.release();
    }
    return reply;
  });

  const methodNotAllowed = async (_request: unknown, reply: { code: (status: number) => { send: (payload: unknown) => unknown } }) =>
    reply.code(405).send({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use Streamable HTTP POST.' },
      id: null
    });

  app.get('/mcp', methodNotAllowed);
  app.delete('/mcp', methodNotAllowed);

  app.get('/v1/catalog/images/:imageId', async (request, reply) => {
    const { imageId } = z.object({ imageId: z.string().regex(/^[a-f0-9]{40}$/) }).parse(request.params);
    const sourceUrl = resolveCatalogImage(imageId);
    if (!sourceUrl) return reply.code(404).send({ error: { code: 'IMAGE_NOT_FOUND', message: 'catalog image expired' } });
    const response = await fetch(sourceUrl, {
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg', 'user-agent': 'PartQuill/0.5 (+https://partquill.com)' },
      redirect: 'error',
      signal: AbortSignal.timeout(12_000)
    });
    if (!response.ok) return reply.code(502).send({ error: { code: 'IMAGE_UPSTREAM_ERROR', message: 'catalog image unavailable' } });
    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim();
    if (!mediaType || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mediaType)) {
      return reply.code(502).send({ error: { code: 'INVALID_IMAGE', message: 'catalog image type rejected' } });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) {
      return reply.code(502).send({ error: { code: 'INVALID_IMAGE', message: 'catalog image size rejected' } });
    }
    return reply
      .header('content-type', mediaType)
      .header('cache-control', 'public, max-age=3600, stale-while-revalidate=86400')
      .header('x-content-type-options', 'nosniff')
      .send(bytes);
  });

  app.get('/v1/image-studio/quote', async (request) => {
    const { count } = z.object({ count: z.coerce.number().int().min(1).max(24) }).parse(request.query);
    return { quote: quoteStudioBatch(count) };
  });

  app.post('/v1/image-studio/jobs', async (request, reply) => {
    if (!imageStudio) throw new DomainError('Image Studio is unavailable', 'STUDIO_UNAVAILABLE', 503);
    const fields = new Map<string, string>();
    const files: StudioSourceUpload[] = [];
    let totalBytes = 0;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'images') {
          await part.toBuffer();
          throw new DomainError('image files must use the images field', 'INVALID_IMAGE_FIELD', 400);
        }
        const mediaType = z.enum(['image/jpeg', 'image/png', 'image/webp']).parse(part.mimetype);
        const bytes = await part.toBuffer();
        totalBytes += bytes.length;
        if (totalBytes > 120 * 1024 * 1024) {
          throw new DomainError('the complete image batch must be 120 MB or less', 'IMAGE_BATCH_TOO_LARGE', 413);
        }
        files.push({ filename: part.filename || `image-${files.length + 1}`, mediaType, bytes });
      } else {
        fields.set(part.fieldname, String(part.value));
      }
    }
    const metadata = z
      .object({
        sellerId: z.string().min(1).max(120),
        background: z.enum(['PURE_WHITE', 'TRANSPARENT', 'SOFT_GRAY']).default('PURE_WHITE'),
        rightsConfirmed: z.enum(['true', 'false']).transform((value) => value === 'true'),
        watermarkStatus: z.enum(['NONE', 'OWNED_OR_AUTHORIZED', 'SUSPECTED_THIRD_PARTY']).default('NONE')
      })
      .parse(Object.fromEntries(fields));
    const job = await imageStudio.createJob({ ...metadata, files });
    return reply.code(job.status === 'BLOCKED' ? 409 : 202).send({ job: publicStudioJob(job) });
  });

  app.get('/v1/image-studio/jobs/:jobId', async (request) => {
    if (!imageStudio) throw new DomainError('Image Studio is unavailable', 'STUDIO_UNAVAILABLE', 503);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return { job: publicStudioJob(await imageStudio.getJob(jobId)) };
  });

  app.get('/v1/image-studio/jobs/:jobId/images/:imageId/:kind', async (request, reply) => {
    if (!imageStudio) throw new DomainError('Image Studio is unavailable', 'STUDIO_UNAVAILABLE', 503);
    const { jobId, imageId, kind } = z
      .object({ jobId: z.string().uuid(), imageId: z.string().uuid(), kind: z.enum(['original', 'result']) })
      .parse(request.params);
    const image = await imageStudio.readImage(jobId, imageId, kind);
    return reply
      .header('content-type', image.mediaType)
      .header('cache-control', kind === 'original' ? 'private, immutable, max-age=31536000' : 'private, max-age=3600')
      .send(Buffer.from(image.bytes));
  });

  app.post('/v1/image-studio/jobs/:jobId/retry', async (request, reply) => {
    if (!imageStudio) throw new DomainError('Image Studio is unavailable', 'STUDIO_UNAVAILABLE', 503);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return reply.code(202).send({ job: publicStudioJob(await imageStudio.retry(jobId)) });
  });

  app.post('/v1/epc-image/jobs', async (request, reply) => {
    if (!epcImage) throw new DomainError('EPC Image Pipeline is unavailable', 'EPC_IMAGE_UNAVAILABLE', 503);
    const fields = new Map<string, string>();
    let upload: { filename: string; mediaType: string; bytes: Uint8Array } | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'image' || upload) {
          await part.toBuffer();
          throw new DomainError('provide exactly one EPC source using the image field', 'INVALID_EPC_IMAGE_FIELD', 400);
        }
        const mediaType = z.enum(['image/jpeg', 'image/png', 'image/webp']).parse(part.mimetype);
        upload = { filename: part.filename || 'epc-source', mediaType, bytes: await part.toBuffer() };
      } else {
        fields.set(part.fieldname, String(part.value));
      }
    }
    if (!upload) throw new DomainError('one EPC source image is required', 'EPC_IMAGE_REQUIRED', 400);
    const raw = Object.fromEntries(fields);
    const metadata = z.object({
      brand: z.enum(['FERRARI', 'LAMBORGHINI', 'ASTON_MARTIN', 'OTHER']),
      diagramId: z.string().trim().min(1).max(160),
      rightsConfirmed: z.enum(['true', 'false']).transform((value) => value === 'true'),
      watermarkStatus: z.enum(['NONE', 'OWNED_OR_AUTHORIZED', 'SUSPECTED_THIRD_PARTY']).default('NONE'),
      lineThreshold: z.coerce.number().int().min(120).max(235).default(190),
      callouts: z.string().min(2).max(100_000).transform((value, context) => {
        try {
          return z.array(z.object({
            ref: z.string().trim().min(1).max(24),
            x: z.number().finite().min(0),
            y: z.number().finite().min(0),
            radius: z.number().finite().min(6).max(60).optional(),
            sku: z.string().trim().min(1).max(96).optional()
          })).min(1).max(500).parse(JSON.parse(value));
        } catch {
          context.addIssue({ code: 'custom', message: 'callouts must be valid JSON hotspot records' });
          return z.NEVER;
        }
      })
    }).parse(raw);
    const job = await epcImage.createJob({
      ...metadata,
      filename: upload.filename,
      mediaType: upload.mediaType,
      source: upload.bytes
    });
    return reply.code(job.status === 'BLOCKED' ? 409 : 202).send({ job: publicEpcJob(job) });
  });

  app.get('/v1/epc-image/jobs/:jobId', async (request) => {
    if (!epcImage) throw new DomainError('EPC Image Pipeline is unavailable', 'EPC_IMAGE_UNAVAILABLE', 503);
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    return { job: publicEpcJob(await epcImage.getJob(jobId)) };
  });

  app.get('/v1/epc-image/jobs/:jobId/artifacts/:kind', async (request, reply) => {
    if (!epcImage) throw new DomainError('EPC Image Pipeline is unavailable', 'EPC_IMAGE_UNAVAILABLE', 503);
    const { jobId, kind } = z.object({
      jobId: z.string().uuid(),
      kind: z.enum(['source', 'clean-base', 'interactive', 'thumbnail', 'callout-map'])
    }).parse(request.params);
    const artifact = await epcImage.readArtifact(jobId, kind);
    return reply
      .header('content-type', artifact.mediaType)
      .header('cache-control', kind === 'source' ? 'private, immutable, max-age=31536000' : 'private, max-age=3600')
      .send(Buffer.from(artifact.bytes));
  });

  app.post('/v1/community/submissions', { bodyLimit: 110 * 1024 * 1024 }, async (request, reply) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const permit = communityUploadGuard.acquire(request.ip);
    try {
      const fields = new Map<string, string>();
      const uploads: Array<{ filename: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Uint8Array }> = [];
      let totalBytes = 0;
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'images') {
            await part.toBuffer();
            throw new DomainError('community files must use the images field', 'INVALID_COMMUNITY_IMAGE_FIELD', 400);
          }
          const mediaType = z.enum(['image/jpeg','image/png','image/webp']).parse(part.mimetype);
          const bytes = await part.toBuffer();
          totalBytes += bytes.length;
          if (totalBytes > 100 * 1024 * 1024) throw new DomainError('the complete contribution must be 100 MB or less', 'COMMUNITY_BATCH_TOO_LARGE', 413);
          uploads.push({ filename: part.filename || `part-image-${uploads.length + 1}`, mediaType, bytes });
        } else fields.set(part.fieldname, String(part.value));
      }
      const metadata = z.object({
        contributorCredit: z.string().min(2).max(80),
        partNumbers: z.string().transform((value, context) => {
          try { return z.array(z.string().min(1).max(64)).parse(JSON.parse(value)); }
          catch { context.addIssue({ code: 'custom', message: 'partNumbers must be a JSON string array' }); return z.NEVER; }
        }),
        ownershipConfirmed: z.literal('true'),
        licenseConfirmed: z.literal('true'),
        contentRulesConfirmed: z.literal('true')
      }).parse(Object.fromEntries(fields));
      if (metadata.partNumbers.length !== uploads.length) throw new DomainError('every selected image must have one part number', 'COMMUNITY_PART_NUMBER_COUNT_MISMATCH', 400);
      const created = await communityImages.createSubmission({
        contributorCredit: metadata.contributorCredit,
        ownershipConfirmed: true,
        licenseConfirmed: true,
        contentRulesConfirmed: true,
        attestationFingerprint: `${request.ip}|${request.headers['user-agent'] ?? ''}|${metadata.contributorCredit}`,
        files: uploads.map((file, index) => ({ ...file, partNumber: metadata.partNumbers[index]! }))
      });
      const { statusTokenHash: _hash, attestationFingerprint: _fingerprint, ...safeSubmission } = created.submission;
      return reply.code(202).header('cache-control','no-store').send({
        submission: safeSubmission,
        statusToken: created.statusToken,
        statusUrl: `/v1/community/submissions/${created.submission.id}`
      });
    } finally { permit.release(); }
  });

  app.get('/v1/community/submissions/:submissionId', async (request, reply) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { submissionId } = z.object({ submissionId: z.string().uuid() }).parse(request.params);
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(request.query);
    return reply.header('cache-control','no-store').send(await communityImages.getPublicSubmission(submissionId, token));
  });

  app.get('/v1/community-assets/:fileName', async (request, reply) => {
    if (!communityImages) return reply.code(404).send({ error: { code: 'COMMUNITY_ASSET_NOT_AVAILABLE', message: 'community image is not available' } });
    const { fileName } = referenceAssetParams.parse(request.params);
    const asset = await communityImages.readPublishedAsset(fileName);
    if (!asset) return reply.code(404).send({ error: { code: 'COMMUNITY_ASSET_NOT_AVAILABLE', message: 'community image is not available' } });
    return reply.header('cache-control','public,max-age=31536000,immutable').header('x-content-type-options','nosniff').type(asset.mediaType).send(Buffer.from(asset.bytes));
  });

  app.get('/internal/community-images/queue', async (request) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(250).default(100) }).parse(request.query);
    return { queue: await communityImages.listReviewQueue(limit) };
  });

  app.get('/internal/community-images/images/:imageId/original', async (request, reply) => {
    const { imageId } = z.object({ imageId: z.string().uuid() }).parse(request.params);
    const image = await store.getCommunityImage(imageId);
    if (!image) throw new DomainError('community image not found', 'COMMUNITY_IMAGE_NOT_FOUND', 404);
    return reply.header('cache-control','private,no-store').type(image.sourceMediaType).send(Buffer.from(image.sourceBytes));
  });

  app.post('/internal/community-images/submissions/:submissionId/approve', async (request) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { submissionId } = z.object({ submissionId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      reviewer: z.string().min(1).max(120),
      note: z.string().max(500).default(''),
      manualSafetyConfirmed: z.boolean().default(false),
      partNumberMatchConfirmed: z.boolean().default(false)
    }).parse(request.body ?? {});
    return {
      submission: await communityImages.approveSubmission(submissionId, body.reviewer, body.note, {
        manualSafetyConfirmed: body.manualSafetyConfirmed,
        partNumberMatchConfirmed: body.partNumberMatchConfirmed
      })
    };
  });

  app.post('/internal/community-images/images/:imageId/chatgpt-handoff', async (request, reply) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { imageId } = z.object({ imageId: z.string().uuid() }).parse(request.params);
    const handoff = await communityImages.issueChatGptHandoff(imageId);
    return reply.header('cache-control', 'private,no-store').send({ handoff });
  });

  app.get('/internal/community-images/images/:imageId/derivative', async (request, reply) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { imageId } = z.object({ imageId: z.string().uuid() }).parse(request.params);
    const derivative = await communityImages.readChatGptDerivative(imageId);
    return reply.header('cache-control', 'private,no-store').type(derivative.mediaType).send(Buffer.from(derivative.bytes));
  });

  app.post('/internal/community-images/images/:imageId/approve-derivative', async (request) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { imageId } = z.object({ imageId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      reviewer: z.string().min(1).max(120),
      note: z.string().max(500).default(''),
      sourceComparedConfirmed: z.literal(true),
      contentRulesConfirmed: z.literal(true)
    }).parse(request.body);
    return {
      image: await communityImages.approveChatGptDerivative(imageId, body.reviewer, body.note, {
        sourceComparedConfirmed: body.sourceComparedConfirmed,
        contentRulesConfirmed: body.contentRulesConfirmed
      })
    };
  });

  app.post('/internal/community-images/submissions/:submissionId/retry-archive', async (request) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { submissionId } = z.object({ submissionId: z.string().uuid() }).parse(request.params);
    return { submission: await communityImages.retryArchive(submissionId) };
  });

  app.post('/internal/community-images/images/:imageId/reject', async (request) => {
    if (!communityImages) throw new DomainError('community image contributions are unavailable', 'COMMUNITY_UNAVAILABLE', 503);
    const { imageId } = z.object({ imageId: z.string().uuid() }).parse(request.params);
    const body = z.object({ reviewer: z.string().min(1).max(120), note: z.string().min(1).max(500) }).parse(request.body);
    return { image: await communityImages.rejectImage(imageId, body.reviewer, body.note) };
  });

  app.post('/v1/items', async (request, reply) => {
    const input = createItemSchema.parse(request.body);
    const item = await service.createItem(input);
    return reply.code(201).send({ item });
  });

  app.get('/v1/items/:itemId', async (request, reply) => {
    const { itemId } = itemParams.parse(request.params);
    const item = await store.getItem(itemId);
    if (!item) throw new DomainError('item not found', 'ITEM_NOT_FOUND', 404);
    return reply.send({
      item,
      evidence: await store.listEvidence(itemId),
      approvals: await store.listApprovals(itemId),
      listing: await store.getListing(itemId)
    });
  });

  app.put('/v1/items/:itemId/payload', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const body = z.object({ actorId: z.string().min(1), payload: listingPayloadSchema }).parse(request.body);
    return { item: await service.replacePayload(itemId, body.payload, body.actorId) };
  });

  app.post('/v1/items/:itemId/catalog-resolution', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const { actorId } = z.object({ actorId: z.string().min(1) }).parse(request.body);
    return { item: await service.resolveCatalog(itemId, actorId) };
  });

  app.post('/v1/items/:itemId/evidence', async (request, reply) => {
    const { itemId } = itemParams.parse(request.params);
    const input = evidenceSchema.parse(request.body);
    const item = await service.addEvidence(itemId, input);
    return reply.code(201).send({ item });
  });

  app.post('/v1/items/:itemId/images', async (request, reply) => {
    const { itemId } = itemParams.parse(request.params);
    const input = imageSchema.parse(request.body);
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length === 0 || bytes.length > 12 * 1024 * 1024) {
      throw new DomainError('image must be between 1 byte and 12 MB', 'INVALID_IMAGE', 400);
    }
    const { base64: _base64, ...metadata } = input;
    const result = await service.saveImage(itemId, { ...metadata, bytes });
    return reply.code(201).send({ image: { ...result.image, bytes: undefined }, item: result.item });
  });

  app.post('/v1/items/:itemId/approvals/preflight', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const input = approvalSchema.omit({ feeEstimateId: true }).parse(request.body);
    return { item: await service.approvePreflight(itemId, input.actorId, input.payloadHash) };
  });

  app.post('/v1/items/:itemId/stage', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const { actorId } = z.object({ actorId: z.string().min(1) }).parse(request.body);
    return service.stage(itemId, actorId);
  });

  app.post('/v1/items/:itemId/approvals/public', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const input = approvalSchema.required({ feeEstimateId: true }).parse(request.body);
    return { item: await service.approvePublic(itemId, input.actorId, input.payloadHash, input.feeEstimateId) };
  });

  app.post('/v1/items/:itemId/fees/refresh', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const input = z.object({
      actorId: z.string().min(1).max(200),
      payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
      payloadVersion: z.number().int().positive(),
      feeEstimateId: z.string().min(1).max(200).nullable()
    }).strict().parse(request.body);
    return service.refreshFees(itemId, input.actorId, input);
  });

  app.post('/v1/items/:itemId/publish', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const { actorId } = z.object({ actorId: z.string().min(1) }).parse(request.body);
    return service.publish(itemId, actorId);
  });

  app.patch('/v1/items/:itemId/listing', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const input = reviseSchema.parse(request.body);
    const { actorId, ...changes } = input;
    return { listing: await service.revise(itemId, actorId, changes) };
  });

  app.post('/v1/items/:itemId/withdraw', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const input = z.object({ actorId: z.string().min(1), reason: z.string().min(3).max(1_000) }).parse(request.body);
    return { listing: await service.withdraw(itemId, input.actorId, input.reason) };
  });

  app.post('/v1/items/:itemId/reconcile', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const { actorId } = z.object({ actorId: z.string().min(1) }).parse(request.body);
    return service.reconcile(itemId, actorId);
  });

  app.post('/v1/items/:itemId/drift-resolution', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const input = z
      .object({ actorId: z.string().min(1), decision: z.enum(['ACCEPT_REMOTE', 'PREPARE_LOCAL_REVISION']) })
      .parse(request.body);
    return service.resolveDrift(itemId, input.actorId, input.decision);
  });

  app.post('/v1/items/:itemId/does-not-fit', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    const input = z
      .object({ actorId: z.string().min(1), reason: z.string().min(3).max(2_000), evidenceId: z.string().uuid().optional() })
      .parse(request.body);
    return service.reportDoesNotFit(itemId, input.actorId, input.reason, input.evidenceId);
  });

  app.get('/v1/items/:itemId/evidence-pack', async (request) => {
    const { itemId } = itemParams.parse(request.params);
    return service.evidencePack(itemId);
  });

  app.get('/v1/sellers/:sellerId/exceptions', async (request) => {
    const { sellerId } = sellerParams.parse(request.params);
    return { items: await service.exceptionQueue(sellerId) };
  });

  app.get('/v1/sellers/:sellerId/connection', async (request) => {
    const { sellerId } = sellerParams.parse(request.params);
    const connection = await store.getConnection(sellerId);
    return { connection: connection ? { ...connection, tokenCiphertext: undefined } : { sellerId, status: 'NOT_CONNECTED' } };
  });

  app.post('/v1/sellers/:sellerId/acknowledgements/inventory-api-ownership', async (request, reply) => {
    const { sellerId } = sellerParams.parse(request.params);
    const input = z.object({ actorId: z.string().min(1), accepted: z.literal(true) }).parse(request.body);
    const acknowledgement = await service.acknowledgeInventoryApiOwnership(sellerId, input.actorId);
    return reply.code(201).send({ acknowledgement });
  });

  app.post('/v1/sellers/:sellerId/mock-connect', async (request, reply) => {
    const { sellerId } = sellerParams.parse(request.params);
    if (config.EBAY_MODE !== 'mock') throw new DomainError('mock connection only exists in mock mode', 'MOCK_MODE_REQUIRED', 404);
    await store.saveConnection({ sellerId, ebayUserId: `mock-${sellerId}`, scopes: [...REQUIRED_EBAY_SCOPES], status: 'CONNECTED', updatedAt: now() });
    return reply.code(201).send({ sellerId, status: 'CONNECTED', environment: 'mock' });
  });

  app.get('/v1/sellers/:sellerId/oauth/ebay/start', async (request) => {
    const { sellerId } = sellerParams.parse(request.params);
    const nonce = randomUUID();
    const expiresAt = Date.now() + 10 * 60_000;
    await store.saveOAuthNonce(nonce, sellerId, new Date(expiresAt).toISOString());
    const state = signOAuthState({ sellerId, nonce, expiresAt }, config.OAUTH_STATE_SECRET);
    return { authorizationUrl: new EbayOAuthClient(config).authorizationUrl(state), expiresInSeconds: 600 };
  });

  app.get('/v1/oauth/ebay/callback', async (request, reply) => {
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(request.query);
    const state = verifyOAuthState(query.state, config.OAUTH_STATE_SECRET);
    if (!(await store.consumeOAuthNonce(state.nonce, state.sellerId, now()))) {
      throw new DomainError('OAuth state was already used, expired or unknown', 'OAUTH_STATE_REJECTED', 400);
    }
    if (!tokenVault) throw new DomainError('token vault is not configured', 'TOKEN_VAULT_REQUIRED', 503);
    const tokens = await new EbayOAuthClient(config).exchangeCode(query.code);
    await store.saveConnection({
      sellerId: state.sellerId,
      tokenCiphertext: tokenVault.encrypt(
        JSON.stringify({ ...tokens, accessTokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1_000).toISOString() })
      ),
      scopes: [...REQUIRED_EBAY_SCOPES],
      status: 'CONNECTED',
      updatedAt: now()
    });
    return reply.send({ connected: true, sellerId: state.sellerId, returnTo: `${config.PUBLIC_BASE_URL}/connected` });
  });

  app.delete('/v1/sellers/:sellerId/connection', async (request, reply) => {
    const { sellerId } = sellerParams.parse(request.params);
    await store.saveConnection({ sellerId, scopes: [], status: 'AUTHORIZATION_REQUIRED', updatedAt: now() });
    return reply.code(204).send();
  });

  return app;
}
