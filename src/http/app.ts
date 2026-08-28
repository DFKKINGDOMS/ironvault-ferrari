import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
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
import type { StudioJobRecord, StudioSourceUpload } from '../image-studio/types.js';
import { buildPartQuillMcpServer } from '../mcp/server.js';
import { buildPartQuillWidgetHtml } from '../mcp/widget.js';
import { resolveCatalogImage } from '../catalog/image-proxy.js';
import { buildSellerCommandPreview, buildSellerUiBootstrap, listingCommandRequestSchema, parseListingCommand } from '../seller/command-preview.js';
import { normalizeGmCatalogPart } from '../catalog/gm-catalog-quality.js';
import { RequestGuard, RequestLimitError } from '../security/request-guard.js';
import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import { applyEbayCategorySuggestion, buildCatalogListingIntelligence } from '../catalog/listing-intelligence.js';
import { EbayTaxonomyClient } from '../ebay/taxonomy-client.js';
import type { EbayReferenceService } from '../ebay/reference-service.js';
import { isBlockedReferenceImageBytes } from '../ebay/reference-image-policy.js';

const itemParams = z.object({ itemId: z.string().uuid() });
const sellerParams = z.object({ sellerId: z.string().min(1) });
const gmPageParams = z.object({ pageId: z.coerce.number().int().min(1).max(9_999_999) });
const ebayReferenceParams = z.object({
  partNumber: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._ -]*$/)
});
const ebayReferenceImageParams = ebayReferenceParams.extend({
  index: z.coerce.number().int().min(0).max(2)
});
const referenceAssetParams = z.object({
  fileName: z.string().regex(/^[A-Za-z0-9]+(?:_[0-9]+)?\.png$/)
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
  records: z.array(z.object({
    partNumber: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9\s./-]*$/),
    verificationState: z.string().min(1)
  }).passthrough()).min(1).max(1000),
  complete: z.boolean().default(false)
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
  ebayReference?: EbayReferenceService;
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

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { config, store, service, tokenVault, imageStudio, ebayReference } = dependencies;
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
  const ebayTaxonomy = config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET
    ? new EbayTaxonomyClient(config)
    : undefined;
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  });
  await app.register(multipart, {
    limits: { files: config.IMAGE_STUDIO_MAX_IMAGES, fileSize: 12 * 1024 * 1024, parts: config.IMAGE_STUDIO_MAX_IMAGES + 8 }
  });

  app.addHook('onRequest', async (request, reply) => {
    const publicPaths = ['/health', '/ready', '/mcp', '/v1/oauth/ebay/callback'];
    if (['GET', 'HEAD'].includes(request.method) && (
      request.url === '/'
      || request.url.startsWith('/?')
      || request.url === '/image-studio'
      || request.url.startsWith('/image-studio?')
      || request.url.startsWith('/assets/')
      || request.url.startsWith('/connected')
    )) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/seller-ui/bootstrap')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/seller-ui/ebay-reference/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/reference-assets/')) return;
    if (request.method === 'POST' && request.url.startsWith('/v1/seller-ui/command-preview')) return;
    if (request.method === 'POST' && request.url === '/internal/gm-catalog/import') return;
    if (publicPaths.some((path) => request.url.startsWith(path))) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/catalog/images/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/gm-catalog/pages/')) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/image-studio/quote')) return;
    if (
      request.url.startsWith('/v1/image-studio/') &&
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

  app.get('/health', async () => ({ status: 'ok', service: 'partquill-api', version: '0.15.4' }));
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
  app.get('/connected', async (_request, reply) => reply.redirect('/?connected=ebay'));
  app.get('/v1/seller-ui/bootstrap', async (_request, reply) => reply
    .header('cache-control', 'no-store')
    .send(buildSellerUiBootstrap(config)));
  app.post('/v1/seller-ui/command-preview', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const permit = sellerPreviewGuard.acquire(request.ip);
    try {
      const { command } = listingCommandRequestSchema.parse(request.body);
      const intent = parseListingCommand(command);
      const rawGmCatalog = intent.partNumber
        ? await store.lookupGmCatalogPart?.(intent.partNumber)
        : undefined;
      const gmCatalog = normalizeGmCatalogPart(rawGmCatalog, intent.partNumber);
      let intelligence = gmCatalog ? buildCatalogListingIntelligence(gmCatalog) : undefined;
      if (gmCatalog && intelligence && ebayTaxonomy) {
        try {
          const suggestion = await ebayTaxonomy.suggestCategory(intelligence.category.query);
          if (suggestion) intelligence = applyEbayCategorySuggestion(intelligence, suggestion);
        } catch (error) {
          request.log.warn({ error }, 'eBay category suggestion unavailable; using held PartQuill candidate');
        }
      }
      return reply
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .send({ preview: buildSellerCommandPreview(command, gmCatalog, intelligence) });
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
                alt: image.alt,
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
        .header('x-content-type-options', 'nosniff')
        .type('image/png')
        .send(createReadStream(localPath));
    }
    if (config.GM_CATALOG_MEDIA_BASE_URL) {
      const base = config.GM_CATALOG_MEDIA_BASE_URL.replace(/\/$/, '');
      const upstream = await fetch(`${base}/${pageFolder}/full_page.png`, { signal: AbortSignal.timeout(10_000) });
      if (upstream.ok) {
        const contentType = upstream.headers.get('content-type');
        if (contentType?.startsWith('image/')) {
          return reply
            .header('cache-control', 'public, max-age=86400')
            .header('x-content-type-options', 'nosniff')
            .type(contentType)
            .send(Buffer.from(await upstream.arrayBuffer()));
        }
      }
    }
    return reply.code(404).send({ error: { code: 'CATALOG_SCAN_NOT_AVAILABLE', message: 'catalog scan is not available in PartQuill media storage' } });
  });
  app.post('/internal/gm-catalog/import', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!secureTokenMatches(supplied, config.GM_IMPORT_TOKEN) || !store.importGmCatalogRecords) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'not found' } });
    }
    const { records, complete } = gmCatalogImportSchema.parse(request.body);
    await store.importGmCatalogRecords(records as unknown as GmCatalogPart[], complete);
    return reply.header('cache-control', 'no-store').send({ imported: records.length, complete });
  });
  app.get('/ready', async (_request, reply) => {
    try {
      await store.ping?.();
      const gmCatalog = await store.getGmCatalogStatus?.();
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
          activated: imageStudio?.activated ?? false,
          maxImages: config.IMAGE_STUDIO_MAX_IMAGES,
          storage: config.IMAGE_STUDIO_STORAGE_DIR
        },
        sellerUi: {
          version: '0.15.4',
          commandPreview: true,
          publicEbayWritesDisabled: true
        },
        gmCatalog: gmCatalog ?? {
          datasetId: null,
          status: 'not_started',
          importedParts: 0,
          availableParts: 0,
          lastPartNumber: null
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
      oemResearchAllowed: config.OEM_RESEARCH_MODE === 'private-pilot' && config.OEM_DATA_RIGHTS_CONFIRMED
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
