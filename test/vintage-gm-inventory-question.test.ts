import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GmCatalogApplication, GmCatalogPart } from '../src/catalog/gm-catalog.js';
import {
  buildVintageGmInventoryAnswer,
  matchesVintageVehicleApplication,
  parseVintageGmInventoryQuestion
} from '../src/vintage-gm/inventory-question.js';
import type {
  VintageGmCatalogInventory,
  VintageGmDatasetStatus,
  VintageGmInventoryQuestionIntent,
  VintageGmInventoryQuestionPool
} from '../src/vintage-gm/types.js';

const baseCatalog = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-smoke-5459066.json', import.meta.url), 'utf8')
) as GmCatalogPart;

const dataset: VintageGmDatasetStatus = {
  datasetId: 'vintage-question-test-v1',
  status: 'completed',
  active: true,
  sourceSha256: 'd'.repeat(64),
  sourceFileName: 'Products_Vintage_Full_Original.csv',
  sourceTotalRows: 788_581,
  expectedGmRows: 2,
  importedRows: 2,
  normalizedRows: 2,
  rejectedRows: 0,
  distinctPartNumbers: 2,
  catalogKeyMatches: 2,
  completedAt: '2026-08-31T12:00:00.000Z',
  updatedAt: '2026-08-31T12:00:00.000Z'
};

function application(modelName: string, year = 1990, page = 50_001): GmCatalogApplication {
  const base = baseCatalog.applications[0]!;
  return {
    ...base,
    division: 'Chevrolet',
    catalogTitle: `Chevrolet ${modelName} Parts Catalog`,
    applicationText: `${year} ${modelName}`,
    yearStart: year,
    yearEnd: year,
    sourcePageId: page,
    confidence: 0.97,
    verificationState: 'catalog_stated',
    models: [{
      ...base.models[0]!,
      year,
      division: 'Chevrolet',
      modelName,
      confidence: 0.92,
      verificationState: 'catalog_derived_candidate',
      sourcePageId: page
    }]
  };
}

function catalog(partNumber: string, description: string, app: GmCatalogApplication): GmCatalogPart {
  return {
    ...baseCatalog,
    partNumber,
    productType: description,
    description,
    divisions: ['Chevrolet'],
    applications: [app]
  };
}

function inventory(partNumber: string, description: string, quantity: number, price: string): VintageGmCatalogInventory {
  return {
    partNumber,
    productName: `2585-${partNumber}`,
    sku: partNumber,
    brands: ['GM NA'],
    descriptions: [description],
    quantity,
    sourcePriceMin: price,
    sourcePriceMax: price,
    sourceWeightMin: '1.0000',
    sourceWeightMax: '1.0000',
    sourceRows: [100 + Number(partNumber.slice(-1))],
    recordCount: 1
  };
}

describe('Vintage inventory question intent', () => {
  it('recognizes the captured 1990 Corvette question instead of treating it as a listing', () => {
    expect(parseVintageGmInventoryQuestion(
      'give me a list of all the 1990 corvette parts that vintage parts has in stock'
    )).toMatchObject({
      kind: 'VINTAGE_GM_INVENTORY_QUESTION',
      source: 'VINTAGE_PARTS',
      year: 1990,
      make: null,
      model: 'Corvette',
      inStockOnly: true,
      sortBy: 'QUANTITY',
      sortDirection: 'DESC',
      requestedLimit: null
    });
  });

  it('understands requested value sorting and keeps explicit listing commands on the listing route', () => {
    expect(parseVintageGmInventoryQuestion(
      'Show all 1990 Chevrolet Corvette parts Vintage Parts has available, sorted by inventory value highest first'
    )).toMatchObject({ make: 'Chevrolet', model: 'Corvette', sortBy: 'INVENTORY_VALUE', sortDirection: 'DESC' });
    expect(parseVintageGmInventoryQuestion('List GM part 5459066 on eBay for $9.99')).toBeNull();
    expect(parseVintageGmInventoryQuestion('Give me 10 rare Vintage GM parts in the database')).toBeNull();
  });
});

describe('Vintage inventory answer', () => {
  const intent = parseVintageGmInventoryQuestion(
    'Give me all 1990 Corvette parts that Vintage Parts has in stock by quantity'
  ) as VintageGmInventoryQuestionIntent;
  const corvetteA = application('Corvette', 1990, 50_001);
  const corvetteB = application('Corvette', 1990, 50_002);
  const camaro = application('Camaro', 1990, 50_003);

  it('requires catalog-stated year/model application evidence', () => {
    expect(matchesVintageVehicleApplication(corvetteA, intent)).toBe(true);
    expect(matchesVintageVehicleApplication(application('Corvette', 1991), intent)).toBe(false);
    expect(matchesVintageVehicleApplication(camaro, intent)).toBe(false);
  });

  it('resolves the catalog-stated Y series code as Corvette without weakening the year or make gates', () => {
    const codedCorvette = application('Y', 1990, 50_004);
    codedCorvette.catalogTitle = 'Chevrolet Passenger Car Parts Catalog';
    codedCorvette.applicationText = '1990 Y';
    codedCorvette.modelScope = 'Y';
    codedCorvette.models[0]!.seriesCode = 'Y';
    expect(matchesVintageVehicleApplication(codedCorvette, intent)).toBe(true);

    codedCorvette.division = 'Buick';
    codedCorvette.models[0]!.division = 'Buick';
    expect(matchesVintageVehicleApplication(codedCorvette, { ...intent, make: 'Chevrolet' })).toBe(false);
  });

  it('returns a read-only sortable inventory answer with exact source value totals', () => {
    const pool: VintageGmInventoryQuestionPool = {
      dataset,
      truncated: false,
      matches: [
        {
          inventory: inventory('1000001', 'FILTER ASSEMBLY', 8, '4.5000'),
          sourceInventoryValue: '36.0000',
          catalog: catalog('1000001', 'Filter Assembly', corvetteA),
          matchedApplications: [corvetteA]
        },
        {
          inventory: inventory('1000002', 'STEERING BRACKET', 2, '100.0000'),
          sourceInventoryValue: '200.0000',
          catalog: catalog('1000002', 'Steering Bracket', corvetteB),
          matchedApplications: [corvetteB]
        },
        {
          inventory: inventory('1000003', 'CAMARO BRACKET', 99, '1.0000'),
          sourceInventoryValue: '99.0000',
          catalog: catalog('1000003', 'Camaro Bracket', camaro),
          matchedApplications: [camaro]
        }
      ]
    };

    const answer = buildVintageGmInventoryAnswer('Give me all 1990 Corvette parts that Vintage Parts has in stock', intent, pool);

    expect(answer).toMatchObject({
      kind: 'VINTAGE_GM_INVENTORY_ANSWER',
      status: 'READY',
      returnedCount: 2,
      summary: { distinctParts: 2, totalUnits: 10, sourceInventoryValue: '236.0000', complete: true },
      rows: [
        expect.objectContaining({ partNumber: '1000001', quantity: 8, sourceInventoryValue: '36.0000' }),
        expect.objectContaining({ partNumber: '1000002', quantity: 2, sourceInventoryValue: '200.0000' })
      ],
      readOnly: true,
      listingDraftCreated: false,
      allowanceConsumed: false,
      noExternalRequestMade: true
    });
    expect(answer.valueDefinition).toContain('not resale or eBay market value');
  });
});
