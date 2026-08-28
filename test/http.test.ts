import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/http/app.js';
import { harness, validPayload } from './helpers.js';
import { registerCatalogImage } from '../src/catalog/image-proxy.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close();
});

describe('HTTP contract', () => {
  it('keeps health public and business routes authenticated', async () => {
    const h = harness();
    app = await buildApp(h);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const widget = await app.inject({ method: 'GET', url: '/' });
    expect(widget.statusCode).toBe(200);
    expect(widget.headers['content-type']).toContain('text/html');
    expect(widget.body).toContain('PartQuill');
    const widgetHead = await app.inject({ method: 'HEAD', url: '/' });
    expect(widgetHead.statusCode).toBe(200);
    const imageStudio = await app.inject({ method: 'GET', url: '/image-studio' });
    expect(imageStudio.statusCode).toBe(200);
    expect(imageStudio.body).toContain('PartQuill Image Studio');
    expect((await app.inject({ method: 'POST', url: '/v1/items', payload: {} })).statusCode).toBe(401);
    const studioQuote = await app.inject({ method: 'GET', url: '/v1/image-studio/quote?count=24' });
    expect(studioQuote.statusCode).toBe(200);
    expect(studioQuote.json().quote.customerPriceUsd).toBe('2.49');
    const mcpGet = await app.inject({ method: 'GET', url: '/mcp' });
    expect(mcpGet.statusCode).toBe(405);
    expect(mcpGet.json().error.message).toContain('Streamable HTTP POST');
    const mcpInitialize = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'partquill-http-test', version: '1.0.0' }
        }
      }
    });
    expect(mcpInitialize.statusCode).toBe(200);
    expect(mcpInitialize.body).toContain('partquill-image-studio');
  });

  it('serves the backend-connected seller bootstrap and fail-closed command preview publicly', async () => {
    const h = harness({ ALLOW_EBAY_WRITES: false, OEM_RESEARCH_MODE: 'private-pilot', OEM_DATA_RIGHTS_CONFIRMED: false });
    app = await buildApp(h);
    const bootstrap = await app.inject({ method: 'GET', url: '/v1/seller-ui/bootstrap' });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      version: '0.16.2',
      backendConnected: true,
      ebay: { writesEnabled: false, handoffUrl: 'https://www.ebay.com/' },
      safeguards: { unknownCatalogClaimsHeld: true, sellerPhotoRequired: true, dualApproval: true }
    });

    const preview = await app.inject({
      method: 'POST',
      url: '/v1/seller-ui/command-preview',
      payload: { command: 'List part 13568-29025 for $79.95' }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview).toMatchObject({
      status: 'HELD',
      identity: { brand: null, productType: null },
      fitment: { state: 'NOT_VERIFIED', totalApplications: 0 },
      media: { state: 'SELLER_PHOTO_REQUIRED' },
      gates: { publicEbayWrite: 'DISABLED', ebayHandoffUrl: 'https://www.ebay.com/' },
      noExternalRequestMade: true
    });
  });

  it('keeps catalog ingestion hidden behind its dedicated temporary token', async () => {
    const h = harness({ GM_IMPORT_TOKEN: 'test-gm-import-token-that-is-long-enough' });
    app = await buildApp(h);
    const record = { partNumber: '545-5055', verificationState: 'CATALOG_STATED' };
    expect((await app.inject({
      method: 'POST',
      url: '/internal/gm-catalog/import',
      payload: { records: [record] }
    })).statusCode).toBe(404);
    const accepted = await app.inject({
      method: 'POST',
      url: '/internal/gm-catalog/import',
      headers: { authorization: 'Bearer test-gm-import-token-that-is-long-enough' },
      payload: { records: [record], complete: true }
    });
    expect(accepted.statusCode).toBe(200);
    expect(await h.store.lookupGmCatalogPart('545 5055')).toMatchObject({
      ...record,
      partNumber: '5455055'
    });
    expect(await h.store.getGmCatalogStatus()).toMatchObject({ status: 'completed', availableParts: 1 });
  });

  it('serves recovered first-party GM catalog scans from PartQuill storage', async () => {
    const h = harness();
    app = await buildApp(h);
    const scan = await app.inject({ method: 'GET', url: '/v1/gm-catalog/pages/6761/image' });
    expect(scan.statusCode).toBe(200);
    expect(scan.headers['content-type']).toContain('image/png');
    expect(scan.rawPayload.byteLength).toBe(125_382);
  });

  it('creates a held draft and exposes an exception-first queue', async () => {
    const h = harness();
    app = await buildApp(h);
    const authorization = { authorization: `Bearer ${h.config.PARTQUILL_API_KEY}` };
    const create = await app.inject({
      method: 'POST',
      url: '/v1/items',
      headers: authorization,
      payload: {
        sellerId: 'seller-api',
        runId: 'run-api',
        inventoryAuthority: 'partquill_master',
        payload: validPayload({ brand: undefined, mpn: undefined })
      }
    });
    expect(create.statusCode).toBe(201);
    const queue = await app.inject({
      method: 'GET',
      url: '/v1/sellers/seller-api/exceptions',
      headers: authorization
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items).toHaveLength(1);
    expect(queue.json().items[0].exceptions[0].code).toBe('IDENTITY_INCOMPLETE');
  });

  it('serves catalog images through an opaque public PartQuill URL', async () => {
    const publicUrl = registerCatalogImage('https://www.toyotapartsdeal.com/resources/encry/part-picture/example.png');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'content-type': 'image/png' }
      })
    ));
    app = await buildApp(harness());
    const response = await app.inject({ method: 'GET', url: new URL(publicUrl).pathname });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['cache-control']).toContain('public');
  });

  it('serves archived GM scans only through the first-party PartQuill route', async () => {
    app = await buildApp(harness());
    const response = await app.inject({ method: 'GET', url: '/v1/gm-catalog/pages/2145/image' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers.location).toBeUndefined();
    expect(response.rawPayload.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
});
