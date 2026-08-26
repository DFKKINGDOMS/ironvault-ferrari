import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/http/app.js';
import { harness, validPayload } from './helpers.js';

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

describe('HTTP contract', () => {
  it('keeps health public and business routes authenticated', async () => {
    const h = harness();
    app = await buildApp(h);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const widget = await app.inject({ method: 'GET', url: '/' });
    expect(widget.statusCode).toBe(200);
    expect(widget.headers['content-type']).toContain('text/html');
    expect(widget.body).toContain('PartQuill Image Studio');
    const widgetHead = await app.inject({ method: 'HEAD', url: '/' });
    expect(widgetHead.statusCode).toBe(200);
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
});
