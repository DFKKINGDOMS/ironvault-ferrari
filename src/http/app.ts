import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
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

const itemParams = z.object({ itemId: z.string().uuid() });
const sellerParams = z.object({ sellerId: z.string().min(1) });
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

export interface AppDependencies {
  config: AppConfig;
  store: Store;
  service: PartQuillService;
  tokenVault?: TokenVault;
  imageStudio?: ImageStudioService;
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
  const { config, store, service, tokenVault, imageStudio } = dependencies;
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 128 * 1024 * 1024 });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((origin) => origin.trim()),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  });
  await app.register(multipart, {
    limits: { files: config.IMAGE_STUDIO_MAX_IMAGES, fileSize: 12 * 1024 * 1024, parts: config.IMAGE_STUDIO_MAX_IMAGES + 8 }
  });

  app.addHook('onRequest', async (request, reply) => {
    const publicPaths = ['/health', '/ready', '/mcp', '/v1/oauth/ebay/callback'];
    if (['GET', 'HEAD'].includes(request.method) && (request.url === '/' || request.url.startsWith('/?'))) return;
    if (publicPaths.some((path) => request.url.startsWith(path))) return;
    if (request.method === 'GET' && request.url.startsWith('/v1/catalog/images/')) return;
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
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'request validation failed', issues: error.issues } });
    }
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    request.log.error(error);
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'unexpected server error' } });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'partquill-api', version: '0.7.0' }));
  app.get('/', async (_request, reply) =>
    reply.type('text/html; charset=utf-8').send(buildPartQuillWidgetHtml())
  );
  app.get('/ready', async (_request, reply) => {
    try {
      await store.ping?.();
      return {
        ready: true,
        ebay: { environment: config.EBAY_ENV, mode: config.EBAY_MODE, writesEnabled: config.ALLOW_EBAY_WRITES },
        persistence: config.DATABASE_URL ? 'postgres' : config.PILOT_EPHEMERAL_MODE ? 'ephemeral-memory-pilot' : 'memory',
        imageStudio: {
          mode: config.IMAGE_STUDIO_MODE,
          activated: imageStudio?.activated ?? false,
          maxImages: config.IMAGE_STUDIO_MAX_IMAGES,
          storage: config.IMAGE_STUDIO_STORAGE_DIR
        }
      };
    } catch {
      return reply.code(503).send({ ready: false, reason: 'persistence unavailable' });
    }
  });

  app.post('/mcp', async (request, reply) => {
    const server = buildPartQuillMcpServer();
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
