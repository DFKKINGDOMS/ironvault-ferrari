import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { RequestGuard } from '../security/request-guard.js';
import { createGoogleResearch, googleResearchConfig, GoogleResearchError, googleInputFingerprint, type GoogleResearchResult } from '../research/google-search.js';

const schema = z.object({
  sku: z.string().min(2).max(80),
  vendor: z.string().min(2).max(100),
  title: z.string().max(300).optional(),
  question: z.string().max(600).optional(),
  request_id: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export function registerGoogleResearchRoutes(app: FastifyInstance, config: AppConfig): void {
  const google = config.GOOGLE_RESEARCH_MODE === 'live' ? createGoogleResearch(googleResearchConfig()) : undefined;
  const guard = new RequestGuard(10, 60 * 60_000, 2);
  const requests = new Map<string, { fingerprint: string; expires: number; pending: Promise<GoogleResearchResult> }>();
  let day = new Date().toISOString().slice(0, 10);
  let count = 0;
  let proof: { model: string; at: string; sources: number; queries: number } | undefined;
  app.get('/v1/seller-ui/google-research/status', async (_request, reply) => {
    return reply.header('cache-control', 'no-store').send({
      provider: 'google_search', configured: Boolean(google),
      verified: Boolean(proof), lastResult: proof ?? null,
      catalogueSearchAvailable: true
    });
  });
  app.post('/v1/seller-ui/google-research', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!google) return reply.code(503).send({ error: { code: 'GOOGLE_NOT_CONFIGURED', message: 'Google research is not available yet.' } });
    const origin = request.headers.origin;
    if (origin) {
      let sameOrigin = false;
      try {
        const url = new URL(origin);
        sameOrigin = url.host === request.host && ['https:', 'http:'].includes(url.protocol);
      } catch { /* Invalid origins remain rejected. */ }
      if (!sameOrigin && !config.CORS_ORIGINS.split(',').map(value => value.trim()).includes(origin)) {
        return reply.code(403).send({ error: { code: 'ORIGIN_REJECTED', message: 'Open research from the PartQuill workspace.' } });
      }
    }
    const { request_id, ...input } = schema.parse(request.body);
    let fingerprint: string;
    try { fingerprint = googleInputFingerprint(input); }
    catch (error) {
      return reply.code(400).send({ error: { code: error instanceof GoogleResearchError ? error.code : 'INVALID_INPUT',
        message: 'Enter a valid OEM part number and manufacturer, without a full VIN.' } });
    }
    const visitor = createHash('sha256').update(request.ip).digest('hex');
    const key = createHash('sha256').update(visitor + ':' + request_id).digest('hex');
    const timestamp = Date.now();
    for (const [id, entry] of requests) if (entry.expires < timestamp) requests.delete(id);
    const today = new Date().toISOString().slice(0, 10);
    if (day !== today) { day = today; count = 0; }
    let entry = requests.get(key);
    if (entry && entry.fingerprint !== fingerprint) {
      return reply.code(409).send({ error: { code: 'REQUEST_CONFLICT', message: 'Start a new search for the changed part.' } });
    }
    if (!entry) {
      if (count >= config.GOOGLE_RESEARCH_DAILY_LIMIT) return reply.code(429).send({
        error: { code: 'DAILY_RESEARCH_LIMIT', message: 'Today’s Google research limit has been reached.' }
      });
      const permit = guard.acquire(visitor);
      count++;
      // This response is held only for delivery/retry by this requesting visitor.
      // Google text and links never enter the shared catalogue or listing store.
      const pending = google.research(input).then(result => {
        proof = { model: result.model, at: result.researched_at, sources: result.source_count, queries: result.search_query_count };
        return result;
      }).finally(() => permit.release());
      entry = { fingerprint, expires: timestamp + 15 * 60_000, pending };
      requests.set(key, entry);
    }
    try { return await entry.pending; }
    catch (error) {
      const code = error instanceof GoogleResearchError ? error.code : 'google_search_failed';
      const message = code === 'google_search_no_sources' || code === 'google_search_no_citations'
        ? 'Google did not return enough cited catalogue evidence. This does not prove that the part does not fit.'
        : code === 'full_vin_not_accepted'
          ? 'Use an OEM part number for web research; do not enter a full VIN.'
          : 'Google research is temporarily unavailable. Please try again shortly.';
      return reply.code(error instanceof GoogleResearchError ? error.status : 503).send({ error: { code, message }, provider: 'google_search' });
    }
  });
}
