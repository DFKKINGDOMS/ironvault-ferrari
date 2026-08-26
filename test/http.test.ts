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
    expect((await app.inject({ method: 'POST', url: '/v1/items', payload: {} })).statusCode).toBe(401);
    const studioQuote = await app.inject({ method: 'GET', url: '/v1/image-studio/quote?count=24' });
    expect(studioQuote.statusCode).toBe(200);
    expect(studioQuote.json().quote.customerPriceUsd).toBe('2.49');
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
