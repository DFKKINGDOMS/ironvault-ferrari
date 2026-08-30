import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/http/app.js';
import { harness, validPayload } from './helpers.js';
import { registerCatalogImage } from '../src/catalog/image-proxy.js';
import { clearGmCalloutCaches } from '../src/catalog/gm-callout.js';
import type { Store } from '../src/store/store.js';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';

const gm5459066 = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-smoke-5459066.json', import.meta.url), 'utf8')
) as GmCatalogPart;

let app: FastifyInstance | undefined;
afterEach(async () => {
  clearGmCalloutCaches();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
      version: '0.21.0',
      backendConnected: true,
      ebay: { writesEnabled: false, handoffUrl: 'https://www.ebay.com/' },
      defaults: {
        minimumPrice: '0.99',
        handlingTimes: expect.arrayContaining([
          { days: 0, label: 'Same business day' },
          { days: 40, label: '40 business days' }
        ])
      },
      safeguards: { unknownCatalogClaimsHeld: true, sellerPhotoRequired: true, dualApproval: true }
    });

    const categories = await app.inject({ method: 'GET', url: '/v1/seller-ui/ebay-categories' });
    expect(categories.statusCode).toBe(200);
    expect(categories.json()).toMatchObject({
      source: 'EBAY_OFFICIAL_MOTORS_CATEGORY_TREE',
      categories: expect.arrayContaining([
        expect.objectContaining({ categoryId: '174021', categoryName: 'Brake Boosters' })
      ])
    });

    const conditionPolicy = await app.inject({ method: 'GET', url: '/v1/seller-ui/ebay-category-policy/174021' });
    expect(conditionPolicy.statusCode).toBe(200);
    expect(conditionPolicy.json()).toMatchObject({
      categoryId: '174021',
      source: 'UNAVAILABLE',
      verified: false,
      conditions: []
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

  it('serves a locked orange primary image for an exact row-to-callout mapping', async () => {
    const h = harness({ ALLOW_EBAY_WRITES: false });
    const exactCatalog: GmCatalogPart = {
      ...gm5459066,
      partNumber: '9438315',
      productType: 'HOSE',
      description: 'HOSE, FUEL-OIL EVAP',
      catalogGroup: '8.962',
      diagrams: [{
        ...gm5459066.diagrams[0]!,
        pageId: 2145,
        calloutLabel: '9',
        displayRotationDegrees: 0,
        evidenceBox: {
          coordinate_space: 'source_image',
          rotation_degrees: 0,
          left: 400,
          top: 300,
          width: 90,
          height: 90,
          image_width: 3300,
          image_height: 2550
        },
        relationshipState: 'exact_row_spatial_callout',
        exactPartDepiction: true,
        isPrimary: true,
        confidence: 0.97
      }]
    };
    await h.store.importGmCatalogRecords([exactCatalog], { datasetId: 'gm-callout-http-test', complete: true });
    app = await buildApp(h);

    const metadata = await app.inject({ method: 'GET', url: '/v1/gm-catalog/parts/9438315/callout' });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toMatchObject({
      state: 'EXACT_ROW_AND_CALLOUT',
      partNumber: '9438315',
      pageId: 2145,
      calloutId: '9'
    });

    const image = await app.inject({ method: 'GET', url: '/v1/gm-catalog/parts/9438315/callout-image' });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/png');
    expect(image.headers['x-partquill-callout-id']).toBe('9');
    expect(image.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const preview = await app.inject({
      method: 'POST',
      url: '/v1/seller-ui/command-preview',
      payload: { command: 'List part 9438315 for $9.99' }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview).toMatchObject({
      listing: {
        handlingTime: '3 business days',
        aspects: { 'Callout Ref ID': '9' }
      },
      media: {
        primaryListingImage: {
          url: '/v1/gm-catalog/parts/9438315/callout-image',
          calloutId: '9'
        }
      },
      gates: { publicEbayWrite: 'DISABLED' }
    });
  });

  it('serves the downloaded read-only eBay VeRO participant snapshot', async () => {
    const links = Array.from({ length: 60 }, (_, index) =>
      '<a href="https://ir.ebaystatic.com/pictures/aw/pics/vero/profile-' + index + '.pdf">Brand ' + index + '</a>'
    ).join('');
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('GET');
      return new Response('<h2>VeRO participant profiles</h2>' + links, { status: 200 });
    }));
    app = await buildApp(harness());

    const response = await app.inject({ method: 'GET', url: '/v1/seller-ui/vero-profiles' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'CURRENT',
      participantCount: 60,
      completeness: 'OFFICIAL_PARTICIPANT_PROFILES_ARE_NOT_COMPLETE'
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
      payload: {
        datasetId: 'gm-exact-links-100001-235000-test',
        records: [record],
        complete: true
      }
    });
    expect(accepted.statusCode).toBe(200);
    expect(await h.store.lookupGmCatalogPart('545 5055')).toMatchObject({
      ...record,
      partNumber: '5455055'
    });
    expect(await h.store.getGmCatalogStatus()).toMatchObject({
      datasetId: 'gm-exact-links-100001-235000-test',
      status: 'completed',
      availableParts: 1
    });
  });

  it('imports the private Vintage GM crosswalk and returns held exact-evidence candidates without an eBay write', async () => {
    const h = harness({
      GM_IMPORT_TOKEN: 'test-gm-import-token-that-is-long-enough',
      ALLOW_EBAY_WRITES: false
    });
    await h.store.importGmCatalogRecords([gm5459066], { datasetId: 'gm-http-test', complete: true });
    const stageOffer = vi.spyOn(h.gateway, 'stageOffer');
    const publish = vi.spyOn(h.gateway, 'publish');
    app = await buildApp(h);
    const payload = {
      datasetId: 'vintage-gm-http-test-v1',
      sourceSha256: 'c'.repeat(64),
      sourceFileName: 'Products_Vintage_Full_Original.csv',
      sourceTotalRows: 788_581,
      expectedGmRows: 1,
      records: [{
        sourceRow: 378,
        productName: '2585-5459066',
        sku: '5459066',
        partNumber: '5459066',
        brand: 'GM NA',
        description: 'ELEMENT CLEANER MORAINE',
        quantity: 1,
        sourcePrice: '9.2375',
        sourceWeight: '0.9',
        normalizationState: 'NORMALIZED_EXACT_KEY',
        normalizationIssue: null
      }],
      complete: true
    };
    expect((await app.inject({
      method: 'POST',
      url: '/internal/vintage-gm/import',
      payload
    })).statusCode).toBe(404);
    const imported = await app.inject({
      method: 'POST',
      url: '/internal/vintage-gm/import',
      headers: { authorization: 'Bearer test-gm-import-token-that-is-long-enough' },
      payload
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json().status).toMatchObject({
      active: true,
      importedRows: 1,
      normalizedRows: 1,
      catalogKeyMatches: 1
    });

    const shortlist = await app.inject({
      method: 'POST',
      url: '/v1/seller-ui/command-preview',
      payload: { command: 'Give me 10 rare Vintage GM parts in the database with exact GMPartsWiki evidence' }
    });
    expect(shortlist.statusCode).toBe(200);
    expect(shortlist.json().shortlist).toMatchObject({
      kind: 'VINTAGE_GM_SHORTLIST',
      status: 'PARTIAL',
      requestedCount: 10,
      returnedCount: 1,
      candidates: [expect.objectContaining({
        partNumber: '5459066',
        listing: expect.objectContaining({ state: 'DRAFT_CANDIDATE_REVIEW_REQUIRED' })
      })],
      ranking: { marketRarityClaimed: false, ebayMarketDataUsed: false },
      gates: { publicEbayWrite: 'DISABLED' },
      noExternalRequestMade: true
    });
    expect(stageOffer).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps migration transfer endpoints disabled unless the temporary token and store adapter are present', async () => {
    const h = harness({ MIGRATION_TRANSFER_TOKEN: 'test-migration-transfer-token-long-enough' });
    const migrationStore = h.store as typeof h.store & {
      getMigrationManifest: NonNullable<Store['getMigrationManifest']>;
      exportMigrationTable: NonNullable<Store['exportMigrationTable']>;
      resetMigrationTarget: NonNullable<Store['resetMigrationTarget']>;
      importMigrationRows: NonNullable<Store['importMigrationRows']>;
    };
    migrationStore.getMigrationManifest = async () => ({
      version: 1,
      generatedAt: '2026-08-29T00:00:00.000Z',
      excludedTables: ['seller_connections', 'oauth_nonces', 'partquill_migrations'],
      tables: [{ table: 'items', rows: 1, bytes: 256 }]
    });
    migrationStore.exportMigrationTable = async (table, offset) => ({
      table,
      offset,
      nextOffset: null,
      rows: [{ id: '00000000-0000-0000-0000-000000000001' }]
    });
    migrationStore.resetMigrationTarget = async () => undefined;
    migrationStore.importMigrationRows = async (table, rows) => ({ table, imported: rows.length, totalRows: rows.length });
    app = await buildApp(h);

    expect((await app.inject({ method: 'GET', url: '/internal/migration/manifest' })).statusCode).toBe(404);
    const headers = { authorization: 'Bearer test-migration-transfer-token-long-enough' };
    expect((await app.inject({ method: 'GET', url: '/internal/migration/manifest', headers })).json()).toMatchObject({
      version: 1,
      tables: [{ table: 'items', rows: 1 }]
    });
    expect((await app.inject({ method: 'GET', url: '/internal/migration/export/items?offset=0&limit=250', headers })).json())
      .toMatchObject({ table: 'items', rows: [{ id: '00000000-0000-0000-0000-000000000001' }] });
    expect((await app.inject({ method: 'POST', url: '/internal/migration/reset', headers })).json()).toEqual({ reset: true });
    expect((await app.inject({
      method: 'POST',
      url: '/internal/migration/import/items',
      headers,
      payload: { rows: [{ id: '00000000-0000-0000-0000-000000000001' }] }
    })).json()).toMatchObject({ table: 'items', imported: 1, totalRows: 1 });
  });

  it('serves recovered first-party GM catalog scans from PartQuill storage', async () => {
    const h = harness();
    app = await buildApp(h);
    const scan = await app.inject({ method: 'GET', url: '/v1/gm-catalog/pages/6761/image' });
    expect(scan.statusCode).toBe(200);
    expect(scan.headers['content-type']).toContain('image/png');
    expect(scan.headers['x-partquill-media-source']).toBe('local');
    expect(scan.rawPayload.byteLength).toBe(125_382);
  });

  it('serves migrated GM scans from private Azure Blob storage', async () => {
    const sas = 'sv=2023-11-03&sp=r&sig=test-signature';
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      expect(url).toBe(`https://pqdata50230827.blob.core.windows.net/partquill-gm-scans/gm-scans/pages/138446/full_page.png?${sas}`);
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { 'content-type': 'application/octet-stream' }
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    app = await buildApp(harness({
      GM_CATALOG_SCAN_DIR: '/definitely-not-present',
      AZURE_STORAGE_ACCOUNT_NAME: 'pqdata50230827',
      GM_CATALOG_MEDIA_CONTAINER: 'partquill-gm-scans',
      GM_CATALOG_MEDIA_SAS: sas
    }));

    const response = await app.inject({ method: 'GET', url: '/v1/gm-catalog/pages/138446/image' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['x-partquill-media-source']).toBe('azure-blob');
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
