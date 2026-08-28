import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';
import { applyEbayCategorySuggestion, buildCatalogListingIntelligence } from '../src/catalog/listing-intelligence.js';

const gm5459066 = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-smoke-5459066.json', import.meta.url), 'utf8')
) as GmCatalogPart;

describe('catalog listing intelligence', () => {
  it('derives a held category candidate and conservative shipping profile from catalog wording', () => {
    const result = buildCatalogListingIntelligence(gm5459066);
    expect(result.category).toMatchObject({
      state: 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION',
      categoryName: 'Air Filters',
      categoryId: null
    });
    expect(result.shipping).toMatchObject({
      state: 'ESTIMATED_REQUIRES_CONFIRMATION',
      packageType: 'BOX',
      profileId: 'P6',
      productFamilyProfileId: 'air-filter-element',
      suggestedPackageIn: { length: 10, width: 8, height: 4 },
      dimDivisor: 139,
      dimensionalWeightLb: 3,
      confirmationRequired: true
    });
  });

  it('replaces a rule candidate only when the eBay Taxonomy API returns a leaf category', () => {
    const result = applyEbayCategorySuggestion(buildCatalogListingIntelligence(gm5459066), {
      categoryId: '12345',
      categoryName: 'Air Filters',
      categoryPath: 'eBay Motors › Parts & Accessories › Air Filters'
    });
    expect(result.category).toMatchObject({
      state: 'EBAY_TAXONOMY_VERIFIED',
      source: 'EBAY_TAXONOMY_API',
      categoryId: '12345'
    });
  });

  it('uses an embedded official exact leaf but keeps the official fallback visible and held', () => {
    const exact = buildCatalogListingIntelligence({
      ...gm5459066,
      ebayCategory: {
        marketplaceId: 'EBAY_US',
        categoryId: '33659',
        categoryName: 'Air Filters',
        categoryPath: 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories › Air & Fuel Delivery › Air Filters',
        source: 'EBAY_OFFICIAL_CATEGORY_FILE',
        classificationMode: 'RULE_EXACT_LEAF',
        categoryTreeId: '100',
        categoryTreeVersion: 'US_JUNE_2026',
        verifiedAt: '2026-08-28T00:00:00.000Z'
      }
    });
    expect(exact.category).toMatchObject({
      state: 'EBAY_TAXONOMY_VERIFIED',
      source: 'EBAY_OFFICIAL_CATEGORY_FILE',
      categoryId: '33659'
    });

    const fallback = buildCatalogListingIntelligence({
      ...gm5459066,
      ebayCategory: {
        ...gm5459066.ebayCategory,
        marketplaceId: 'EBAY_US',
        categoryId: '9886',
        categoryName: 'Other Car & Truck Parts & Accessories',
        categoryPath: 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories › Other',
        source: 'EBAY_OFFICIAL_CATEGORY_FILE',
        classificationMode: 'OTHER_FALLBACK_REVIEWED',
        categoryTreeId: '100',
        categoryTreeVersion: 'US_JUNE_2026',
        verifiedAt: '2026-08-28T00:00:00.000Z'
      }
    });
    expect(fallback.category).toMatchObject({
      state: 'EBAY_OFFICIAL_LEAF_REQUIRES_REVIEW',
      categoryId: '9886'
    });
  });

  it('replaces generic 9886 with the official Brake Boosters leaf for a brake repair kit', () => {
    const result = buildCatalogListingIntelligence({
      ...gm5459066,
      productType: 'Moraine vacuum cylinder repair kit',
      description: 'Power brake vacuum booster repair kit',
      ebayCategory: {
        marketplaceId: 'EBAY_US',
        categoryId: '9886',
        categoryName: 'Other Car & Truck Parts & Accessories',
        categoryPath: 'eBay Motors › Parts & Accessories › Car & Truck Parts & Accessories › Other',
        source: 'EBAY_OFFICIAL_CATEGORY_FILE',
        classificationMode: 'OTHER_FALLBACK_REVIEWED',
        categoryTreeId: '100',
        categoryTreeVersion: 'US_JUNE_2026',
        verifiedAt: '2026-08-28T00:00:00.000Z'
      }
    });
    expect(result.category).toMatchObject({
      state: 'EBAY_TAXONOMY_VERIFIED',
      source: 'EBAY_OFFICIAL_CATEGORY_FILE',
      categoryId: '174021',
      categoryName: 'Brake Boosters'
    });
  });

});
