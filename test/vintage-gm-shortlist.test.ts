import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';
import { MemoryStore } from '../src/store/memory-store.js';
import {
  buildVintageGmShortlist,
  isVintageGmShortlistCommand,
  vintageGmShortlistRequestedCount
} from '../src/vintage-gm/shortlist.js';
import type {
  VintageGmCatalogMatchPool,
  VintageGmDatasetStatus,
  VintageGmInventoryRecord
} from '../src/vintage-gm/types.js';

const gm5459066 = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-smoke-5459066.json', import.meta.url), 'utf8')
) as GmCatalogPart;

const completedDataset: VintageGmDatasetStatus = {
  datasetId: 'vintage-gm-test-v1',
  status: 'completed',
  active: true,
  sourceSha256: 'a'.repeat(64),
  sourceFileName: 'Products_Vintage_Full_Original.csv',
  sourceTotalRows: 788_581,
  expectedGmRows: 3,
  importedRows: 3,
  normalizedRows: 2,
  rejectedRows: 1,
  distinctPartNumbers: 2,
  catalogKeyMatches: 2,
  completedAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z'
};

function inventoryRecord(overrides: Partial<VintageGmInventoryRecord> = {}): VintageGmInventoryRecord {
  return {
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
    normalizationIssue: null,
    ...overrides
  };
}

function match(catalog: GmCatalogPart, record = inventoryRecord()): VintageGmCatalogMatchPool['matches'][number] {
  return {
    inventory: {
      partNumber: record.partNumber!,
      productName: record.productName,
      sku: record.sku,
      brands: [record.brand],
      descriptions: [record.description],
      quantity: record.quantity,
      sourcePriceMin: record.sourcePrice,
      sourcePriceMax: record.sourcePrice,
      sourceWeightMin: record.sourceWeight,
      sourceWeightMax: record.sourceWeight,
      sourceRows: [record.sourceRow],
      recordCount: 1
    },
    catalog
  };
}

describe('Vintage GM shortlist intent', () => {
  it('recognizes the seller phrasing in the captured PartQuill command', () => {
    const command = "give me a list 10 part #'s in the database that are rare";
    expect(isVintageGmShortlistCommand(command)).toBe(true);
    expect(vintageGmShortlistRequestedCount(command)).toBe(10);
  });

  it('recognizes the explicit Vintage-to-GMPartsWiki request and caps bulk output', () => {
    expect(isVintageGmShortlistCommand(
      'Give me 10 parts from the Vintage parts file that are mentioned in GMPartsWiki and can list on eBay'
    )).toBe(true);
    expect(isVintageGmShortlistCommand(
      'give me 10 partsfrom vinatge parts file mentioned in the gmpartswiki file that i can list on ebay'
    )).toBe(true);
    expect(vintageGmShortlistRequestedCount('show me 99 rare Vintage GM parts')).toBe(25);
  });

  it('does not intercept a normal single-part listing command', () => {
    expect(isVintageGmShortlistCommand('List part 5459066 on eBay for $9.99')).toBe(false);
  });
});

describe('Vintage GM evidence shortlist', () => {
  it('returns only in-stock, seller-safe exact catalog candidates and explains the ranking boundary', () => {
    const exactLinked: GmCatalogPart = {
      ...gm5459066,
      identityEvidence: {
        method: 'gmpartswiki_exact_part_link',
        verificationState: 'catalog_stated',
        sourcePages: [2166]
      }
    };
    const restraint: GmCatalogPart = {
      ...gm5459066,
      partNumber: '1234567',
      description: 'AIR BAG INFLATOR MODULE',
      productType: 'AIR BAG INFLATOR MODULE',
      identityEvidence: {
        method: 'gmpartswiki_exact_part_link',
        verificationState: 'catalog_stated',
        sourcePages: [3000]
      }
    };
    const weakOcr: GmCatalogPart = {
      ...gm5459066,
      partNumber: '7654321',
      verificationState: 'ocr_candidate',
      identityEvidence: undefined,
      applications: [],
      rollup: { ...gm5459066.rollup, catalogStatedOccurrences: 0 }
    };
    const pool: VintageGmCatalogMatchPool = {
      dataset: completedDataset,
      matches: [
        match(exactLinked),
        match(restraint, inventoryRecord({ sourceRow: 379, sku: '1234567', partNumber: '1234567', description: 'MODULE AIR BAG' })),
        match(weakOcr, inventoryRecord({ sourceRow: 380, sku: '7654321', partNumber: '7654321', description: 'BRACKET' }))
      ]
    };

    const result = buildVintageGmShortlist('Give me 10 rare Vintage GM parts in the database', pool);

    expect(result.status).toBe('PARTIAL');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      partNumber: '5459066',
      inventory: { quantity: 1, scarcityBand: 'ONE_IN_SOURCE', sourcePriceMax: '9.2375' },
      catalog: { mappingState: 'CATALOG_LINKED_EXACT', sourcePages: [2166] },
      listing: { state: 'DRAFT_CANDIDATE_REVIEW_REQUIRED', reviewCommand: 'List GM part 5459066 for $9.24' }
    });
    expect(result.ranking).toMatchObject({ marketRarityClaimed: false, ebayMarketDataUsed: false });
    expect(result.gates.publicEbayWrite).toBe('DISABLED');
    expect(result.noExternalRequestMade).toBe(true);
  });

  it('preserves every strict-GM row while holding an irreversible scientific-notation SKU', async () => {
    const store = new MemoryStore();
    await store.importGmCatalogRecords([gm5459066], { datasetId: 'gm-test', complete: true });
    const rejected = inventoryRecord({
      sourceRow: 689_977,
      productName: '2540-18E13',
      sku: '1.80E+14',
      partNumber: null,
      brand: 'GM FACTORY MOTOR PARTS',
      description: 'CYLINDER',
      normalizationState: 'REJECTED_SCIENTIFIC_NOTATION',
      normalizationIssue: 'Scientific notation cannot be reversed into an exact OEM key.'
    });
    const status = await store.importVintageGmRecords(
      [inventoryRecord(), rejected],
      {
        datasetId: 'vintage-gm-memory-v1',
        sourceSha256: 'b'.repeat(64),
        sourceFileName: 'Products_Vintage_Full_Original.csv',
        sourceTotalRows: 788_581,
        expectedGmRows: 2,
        complete: true
      }
    );

    expect(status).toMatchObject({
      active: true,
      importedRows: 2,
      normalizedRows: 1,
      rejectedRows: 1,
      distinctPartNumbers: 1,
      catalogKeyMatches: 1
    });
    const pool = await store.listVintageGmCatalogMatches(100);
    expect(pool.matches).toHaveLength(1);
    expect(pool.matches[0]?.inventory.partNumber).toBe('5459066');
  });
});
