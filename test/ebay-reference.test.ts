import { describe, expect, it, vi } from 'vitest';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';
import { normalizeGmCatalogPart } from '../src/catalog/gm-catalog-quality.js';
import {
  selectExactEbayReference,
  type EbayBrowseItem,
  type EbayReferenceProvider
} from '../src/ebay/reference-discovery.js';
import { EbayReferenceService } from '../src/ebay/reference-service.js';
import type { EbayReferenceCacheRecord, EbayReferenceCandidate } from '../src/ebay/reference-types.js';
import { buildApp } from '../src/http/app.js';
import { MemoryStore } from '../src/store/memory-store.js';
import { harness, testConfig } from './helpers.js';

function raw5455055(): GmCatalogPart {
  return {
    partNumber: '5455055',
    manufacturer: 'General Motors',
    divisions: [],
    productType: 'Ail Moraine',
    description: 'Ail Moraine',
    catalogGroup: '4.658',
    verificationState: 'catalog_stated',
    rollup: {
      occurrenceCount: 1,
      pageCount: 1,
      catalogStatedOccurrences: 1,
      firstPageId: 6761,
      lastPageId: 6761,
      representativePageId: 6761,
      representativeImageRef: 'GM6761-FULL',
      bestLayoutConfidence: 0.97
    },
    applications: [],
    diagrams: []
  };
}

function catalog5455055(): GmCatalogPart {
  const catalog = normalizeGmCatalogPart(raw5455055(), '5455055');
  if (!catalog) throw new Error('curated test catalog is unavailable');
  return catalog;
}

function ebay165201602251(overrides: Partial<EbayBrowseItem> = {}): EbayBrowseItem {
  return {
    itemId: 'v1|165201602251|0',
    title: '1955-1956 Oldsmobile Brake Vacuum Cylinder Repair Kit NOS Delco OEM #5455055',
    itemWebUrl: 'https://www.ebay.com/itm/165201602251?hash=tracking',
    categoryId: '33566',
    categoryPath: 'eBay Motors › Parts & Accessories › Brakes › Other Brake Parts',
    localizedAspects: [
      { name: 'Brand', value: 'Delco' },
      { name: 'Manufacturer Part Number', value: '5455055' }
    ],
    image: { imageUrl: 'https://i.ebayimg.com/images/g/example1/s-l1600.jpg?set=1' },
    additionalImages: [
      { imageUrl: 'https://i.ebayimg.com/images/g/example2/s-l1600.jpg' },
      { imageUrl: 'https://i.ebayimg.com/images/g/example3/s-l1600.jpg' },
      { imageUrl: 'https://i.ebayimg.com/images/g/example4/s-l1600.jpg' }
    ],
    ...overrides
  };
}

function candidate(): EbayReferenceCandidate {
  const match = selectExactEbayReference('5455055', catalog5455055(), ebay165201602251(), 3);
  if (!match) throw new Error('expected exact fixture match');
  return match;
}

function liveConfig() {
  return testConfig({
    EBAY_ENV: 'production',
    EBAY_CLIENT_ID: 'test-client-id',
    EBAY_CLIENT_SECRET: 'test-client-secret',
    EBAY_REFERENCE_DISCOVERY_MODE: 'live'
  });
}

describe('eBay exact-reference discovery', () => {
  it('accepts item 165201602251 as an exact, catalog-consistent 5455055 reference and caps the set at three', () => {
    const result = selectExactEbayReference('5455055', catalog5455055(), ebay165201602251(), 3);
    expect(result).toMatchObject({
      sourceItemId: 'v1|165201602251|0',
      sourceUrl: 'https://www.ebay.com/itm/165201602251',
      categoryId: '33566'
    });
    expect(result?.images).toHaveLength(3);
    expect(result?.images[0]?.url).not.toContain('?');
    expect(result?.matchEvidence.join(' ')).toContain('Exact Manufacturer Part Number');
  });

  it('rejects partial numbers, conflicting MPNs, unrelated categories and conflicting automakers', () => {
    const catalog = catalog5455055();
    expect(selectExactEbayReference('5455055', catalog, ebay165201602251({
      title: 'Oldsmobile Brake Vacuum Cylinder Repair Kit 54550550',
      localizedAspects: []
    }))).toBeUndefined();
    expect(selectExactEbayReference('5455055', catalog, ebay165201602251({
      localizedAspects: [{ name: 'Manufacturer Part Number', value: '5455054' }]
    }))).toBeUndefined();
    expect(selectExactEbayReference('5455055', catalog, ebay165201602251({
      categoryPath: 'Collectibles › Advertising › Signs'
    }))).toBeUndefined();
    expect(selectExactEbayReference('5455055', catalog, ebay165201602251({
      localizedAspects: [{ name: 'Brand', value: 'Toyota' }, { name: 'Manufacturer Part Number', value: '5455055' }]
    }))).toBeUndefined();
  });

  it('uses a fresh cache hit to suppress repeated eBay calls', async () => {
    const store = new MemoryStore();
    const searchExact = vi.fn(async () => candidate());
    const service = new EbayReferenceService(store, { searchExact }, liveConfig(), () => new Date('2026-08-28T07:00:00Z'));
    const first = await service.lookup('5455055', catalog5455055());
    const second = await service.lookup('5455055', catalog5455055());
    expect(first).toMatchObject({ status: 'MATCHED_LIVE_REFERENCE', searchSuppressed: false });
    expect(second).toMatchObject({ status: 'MATCHED_LIVE_REFERENCE', searchSuppressed: true });
    expect(searchExact).toHaveBeenCalledTimes(1);
    expect(first.reference?.archiveAllowed).toBe(false);
    expect(first.reference?.listingPayloadEligible).toBe(false);
  });

  it('deletes expired eBay content before a failed refresh', async () => {
    const store = new MemoryStore();
    const expired: EbayReferenceCacheRecord = {
      partNumber: '5455055',
      status: 'MATCHED_LIVE_REFERENCE',
      source: 'EBAY_BROWSE_API',
      rightsState: 'EBAY_PUBLIC_REFERENCE_ONLY',
      sourceItemId: 'v1|165201602251|0',
      sourceUrl: 'https://www.ebay.com/itm/165201602251',
      title: 'Expired listing data',
      categoryId: '33566',
      categoryPath: 'eBay Motors › Parts & Accessories',
      images: [{ url: 'https://i.ebayimg.com/images/g/expired/s-l1600.jpg', alt: 'expired' }],
      matchEvidence: ['expired'],
      checkedAt: '2026-08-27T00:00:00Z',
      expiresAt: '2026-08-27T06:00:00Z',
      retryAfter: null,
      archiveAllowed: false,
      listingPayloadEligible: false
    };
    await store.saveEbayReferenceCache(expired);
    const provider: EbayReferenceProvider = { searchExact: vi.fn(async () => { throw new Error('offline'); }) };
    const service = new EbayReferenceService(store, provider, liveConfig(), () => new Date('2026-08-28T07:00:00Z'));
    expect(await service.lookup('5455055', catalog5455055())).toEqual({
      status: 'TEMPORARILY_UNAVAILABLE', reference: null, searchSuppressed: false
    });
    expect(await store.getEbayReferenceCache('5455055')).toBeUndefined();
  });

  it('treats a rights-cleared archive as terminal and never searches eBay again', async () => {
    const store = new MemoryStore();
    const archived: EbayReferenceCacheRecord = {
      partNumber: '5455055',
      status: 'RIGHTS_CLEARED_ARCHIVE',
      source: 'PARTQUILL_RIGHTS_CLEARED',
      rightsState: 'RIGHTS_CLEARED',
      sourceItemId: null,
      sourceUrl: null,
      title: 'Rights-cleared 5455055 reference set',
      categoryId: null,
      categoryPath: null,
      images: [{ url: '/v1/reference-assets/5455055/1', alt: 'Rights-cleared reference' }],
      matchEvidence: ['Written permission recorded separately'],
      checkedAt: '2026-08-28T07:00:00Z',
      expiresAt: null,
      retryAfter: null,
      archiveAllowed: true,
      listingPayloadEligible: false
    };
    await store.saveEbayReferenceCache(archived);
    const searchExact = vi.fn(async () => candidate());
    const service = new EbayReferenceService(store, { searchExact }, liveConfig());
    expect(await service.lookup('5455055', catalog5455055())).toMatchObject({
      status: 'RIGHTS_CLEARED_ARCHIVE', searchSuppressed: true
    });
    expect(searchExact).not.toHaveBeenCalled();
  });

  it('exposes only catalog-keyed reference discovery through the public seller endpoint', async () => {
    const h = harness({
      EBAY_ENV: 'production',
      EBAY_CLIENT_ID: 'test-client-id',
      EBAY_CLIENT_SECRET: 'test-client-secret',
      EBAY_REFERENCE_DISCOVERY_MODE: 'live'
    });
    await h.store.importGmCatalogRecords([raw5455055()]);
    const searchExact = vi.fn(async () => candidate());
    const ebayReference = new EbayReferenceService(h.store, { searchExact }, h.config);
    const app = await buildApp({ ...h, ebayReference });
    try {
      const match = await app.inject({ method: 'GET', url: '/v1/seller-ui/ebay-reference/5455055' });
      expect(match.statusCode).toBe(200);
      expect(match.json()).toMatchObject({
        status: 'MATCHED_LIVE_REFERENCE',
        reference: {
          partNumber: '5455055',
          sourceItemId: 'v1|165201602251|0',
          listingPayloadEligible: false
        }
      });
      expect(match.json().reference.images).toHaveLength(3);
      expect(match.json().reference.images[0]).toMatchObject({
        viewUrl: '/v1/seller-ui/ebay-reference/5455055/image/0'
      });
      expect(match.body).not.toContain('i.ebayimg.com');

      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(new Uint8Array([255, 216, 255, 217]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' }
      })));
      const image = await app.inject({ method: 'GET', url: '/v1/seller-ui/ebay-reference/5455055/image/0' });
      expect(image.statusCode).toBe(200);
      expect(image.headers['content-type']).toContain('image/jpeg');
      expect(image.headers['cache-control']).toBe('no-store, max-age=0');

      const unknown = await app.inject({ method: 'GET', url: '/v1/seller-ui/ebay-reference/9999999' });
      expect(unknown.json()).toEqual({ status: 'NOT_CATALOG_VERIFIED', reference: null, searchSuppressed: true });
      expect(searchExact).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      await app.close();
    }
  });
});
