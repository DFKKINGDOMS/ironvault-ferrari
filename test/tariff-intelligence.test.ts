import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';
import { buildTariffIntelligence } from '../src/catalog/tariff-intelligence.js';

const gmCatalog = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-smoke-5459066.json', import.meta.url), 'utf8')
) as GmCatalogPart;

describe('identity-first tariff intelligence', () => {
  it('classifies the exact item identity before unrelated fitment prose', () => {
    const result = buildTariffIntelligence({
      ...gmCatalog,
      productType: 'Bolt',
      description: 'Bolt',
      applications: gmCatalog.applications.map((application) => ({
        ...application,
        description: 'Brake master cylinder hose and suspension application',
        applicationText: 'Brake-equipped vehicle application'
      }))
    });

    expect(result).toMatchObject({
      state: 'CANDIDATE_REQUIRES_SELLER_REVIEW',
      hsCode: '731815',
      htsCode: '7318.15',
      classificationMode: 'IDENTITY_RULE',
      sellerConfirmationRequired: true
    });
    expect(result.basis.join(' ')).toContain('fitment prose was excluded');
  });

  it('always returns a reviewable six-digit candidate for an exact automotive catalog item', () => {
    const result = buildTariffIntelligence({
      ...gmCatalog,
      productType: 'Fuel-oil evaporative hose',
      description: 'HOSE, FUEL-OIL EVAP'
    });

    expect(result.hsCode).toMatch(/^\d{6}$/);
    expect(result.htsCode).not.toBe('');
    expect(result.classificationMode).toBe('AUTOMOTIVE_FALLBACK');
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.missingFacts).toContain('Base material and construction');
  });
});
