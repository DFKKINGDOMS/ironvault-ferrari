import { describe, expect, it } from 'vitest';
import type { GmCatalogApplication, GmCatalogPart } from '../src/catalog/gm-catalog.js';
import { mergeGmCatalogParts } from '../src/catalog/gm-catalog-merge.js';

function application(overrides: Partial<GmCatalogApplication>): GmCatalogApplication {
  return {
    claimId: -1,
    manufacturer: 'General Motors',
    division: 'Chevrolet',
    catalogTitle: 'Chevrolet Parts Catalog',
    catalogGroup: '1.762',
    partName: 'Hose',
    description: 'HOSE PORTED PURGE SOL',
    groupHeading: null,
    componentFamily: 'Hose',
    supplier: null,
    applicationText: '1990–1992 Y 5 7J LT5',
    yearStart: 1990,
    yearEnd: 1992,
    modelScope: 'Y 5 7J LT5',
    equipmentQualifier: null,
    exclusion: null,
    position: null,
    quantity: null,
    sourcePageId: 138445,
    sourceUrl: 'http://gmpartswiki.com/getpage?pageid=138445',
    imageRef: 'GM138445-FULL',
    imageBlobKey: 'gm-scans/pages/138445/full_page.png',
    evidenceBox: null,
    evidenceContext: '90 92 Y 5 7J LT5 10110988 1 5 73 HOSE PORTED PURGE SOL',
    layoutLine: '90 92 Y 5 7J LT5 10110988 1 5 73 HOSE PORTED PURGE SOL',
    crossReference: null,
    relationMethod: 'curated_catalog_table',
    confidence: 0.99,
    verificationState: 'catalog_stated',
    modelExpansionState: 'not_expanded',
    models: [],
    ...overrides
  };
}

function catalog(overrides: Partial<GmCatalogPart>): GmCatalogPart {
  return {
    partNumber: '10110988',
    manufacturer: 'General Motors',
    divisions: ['Chevrolet'],
    productType: 'Evaporative Emission Hose',
    description: 'Ported purge solenoid hose',
    catalogGroup: '1.762',
    verificationState: 'catalog_stated',
    rollup: {
      occurrenceCount: 1,
      pageCount: 1,
      catalogStatedOccurrences: 1,
      firstPageId: 138445,
      lastPageId: 138445,
      representativePageId: 138445,
      representativeImageRef: 'GM138445-FULL',
      bestLayoutConfidence: 0.99
    },
    applications: [application({})],
    diagrams: [],
    ...overrides
  };
}

describe('GM catalog version merge', () => {
  it('adds exact-link provenance without erasing richer existing fields', () => {
    const current = catalog({
      ebayCategory: {
        marketplaceId: 'EBAY_US',
        categoryId: '33607',
        categoryName: 'Hoses & Lines',
        categoryPath: 'Parts & Accessories > Hoses & Lines',
        source: 'EBAY_OFFICIAL_CATEGORY_FILE',
        classificationMode: 'RULE_EXACT_LEAF',
        categoryTreeId: '0',
        categoryTreeVersion: '2026-01',
        verifiedAt: '2026-08-27T00:00:00.000Z'
      }
    });
    const incoming = catalog({
      productType: 'Hose',
      description: 'HOSE PORTED PURGE SOL',
      identityEvidence: {
        method: 'gmpartswiki_exact_part_link',
        verificationState: 'catalog_stated',
        sourcePages: [138445, 138446]
      },
      rollup: {
        occurrenceCount: 2,
        pageCount: 2,
        catalogStatedOccurrences: 2,
        firstPageId: 138445,
        lastPageId: 138446,
        representativePageId: 138445,
        representativeImageRef: 'GM138445-FULL',
        bestLayoutConfidence: 1
      },
      applications: [application({
        relationMethod: 'exact_html_part_link_with_bounded_embedded_catalog_row',
        confidence: 1
      })]
    });

    const merged = mergeGmCatalogParts(current, incoming);

    expect(merged).toMatchObject({
      partNumber: '10110988',
      productType: 'Evaporative Emission Hose',
      description: 'Ported purge solenoid hose',
      identityEvidence: {
        method: 'gmpartswiki_exact_part_link',
        sourcePages: [138445, 138446]
      },
      ebayCategory: { categoryId: '33607' },
      rollup: { pageCount: 2, lastPageId: 138446 }
    });
    expect(merged.applications).toHaveLength(1);
    expect(merged.applications[0]?.relationMethod).toBe('curated_catalog_table');
  });
});
