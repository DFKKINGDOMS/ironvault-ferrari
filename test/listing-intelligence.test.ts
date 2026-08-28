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
      suggestedPackageIn: { length: 8, width: 8, height: 4 },
      dimDivisor: 139,
      dimensionalWeightLb: 2,
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
});
