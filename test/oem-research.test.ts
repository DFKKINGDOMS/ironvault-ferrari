import { describe, expect, it } from 'vitest';
import { researchOemPart, summarizeOemApplications } from '../src/catalog/oem-research.js';
import type { LexusPartResearch } from '../src/catalog/lexuspartsnow.js';

function observation(
  provider: LexusPartResearch['source']['provider'],
  make: 'Lexus' | 'Toyota',
  salePrice: number,
  fitmentMake: 'Lexus' | 'Toyota' | 'Scion',
  imageUrl: string
): LexusPartResearch {
  return {
    source: {
      provider,
      url: provider === 'LexusPartsNow'
        ? 'https://www.lexuspartsnow.com/parts/private.html'
        : provider === 'ToyotaPartsDeal'
          ? 'https://www.toyotapartsdeal.com/oem/private.html'
          : 'https://parts.longotoyota.com/oem-parts/private',
      retrievedAt: '2026-08-27T12:00:00.000Z',
      evidenceStatus: 'DEALER_CATALOG_REFERENCE',
      limitations: []
    },
    identity: {
      manufacturer: make,
      partNumber: '90915-YZZS1',
      description: 'Oil Filter',
      alternateDescription: 'Engine Oil Filter',
      replaces: provider === 'RevolutionParts' ? ['SU003-00311'] : []
    },
    pricing: { currency: 'USD', listPrice: 6.57, dealerSalePrice: salePrice },
    quickSale: {
      discountPercent: 20,
      basis: 'DEALER_SALE_PRICE',
      disclaimer: 'internal'
    },
    images: [{ url: imageUrl, type: 'CATALOG_ILLUSTRATION', alt: 'Oil filter catalog image' }],
    fitment: [{
      yearStart: 2016,
      yearEnd: 2016,
      make: fitmentMake,
      model: fitmentMake === 'Scion' ? 'FR-S' : '86',
      raw: `2016 ${fitmentMake} ${fitmentMake === 'Scion' ? 'FR-S' : '86'}`
    }],
    fitmentTotal: 1,
    vinConfirmationRequired: true
  };
}

describe('anonymous multi-catalog OEM research', () => {
  it('groups models without exposing raw option codes and preserves disjoint year ranges', () => {
    expect(summarizeOemApplications([
      { yearStart: 1997, yearEnd: 2001, make: 'Toyota', model: 'Camry', raw: 'private row A' },
      { yearStart: 2003, yearEnd: 2006, make: 'Toyota', model: 'Camry', raw: 'private row B' },
      { yearStart: 2004, yearEnd: 2008, make: 'Lexus', model: 'RX330', raw: 'private row C' }
    ])).toEqual([
      { make: 'Lexus', model: 'RX330', yearRanges: ['2004–2008'] },
      { make: 'Toyota', model: 'Camry', yearRanges: ['1997–2001', '2003–2006'] }
    ]);
  });

  it('merges cross-brand evidence, sorts anonymous quotes and anchors quick sale to the lowest quote', async () => {
    const result = await researchOemPart('90915-YZZS1', {
      now: () => new Date('2026-08-27T12:00:00.000Z'),
      lookups: {
        lexus: async () => observation(
          'LexusPartsNow',
          'Lexus',
          6.1,
          'Lexus',
          'https://www.lexuspartsnow.com/resources/encry/part-picture/a.png'
        ),
        toyota: async () => observation(
          'ToyotaPartsDeal',
          'Toyota',
          4.68,
          'Toyota',
          'https://www.toyotapartsdeal.com/resources/encry/part-picture/b.png'
        ),
        scion: async () => observation(
          'RevolutionParts',
          'Toyota',
          5.23,
          'Scion',
          'https://cdn-product-images.revolutionparts.io/assets/c.webp'
        )
      }
    });

    expect(result.brandCoverage).toEqual({
      catalogBrands: ['Lexus', 'Scion', 'Toyota'],
      fitmentBrands: ['Lexus', 'Scion', 'Toyota'],
      crossoverStatus: 'MULTI_BRAND'
    });
    expect(result.pricing.anonymousQuotes.map((quote) => [quote.quote, quote.currentPrice])).toEqual([
      ['Quote A', 4.68],
      ['Quote B', 5.23],
      ['Quote C', 6.1]
    ]);
    expect(result.quickSale).toMatchObject({
      targetPrice: 3.74,
      lowPrice: 3.51,
      highPrice: 3.98,
      basis: 'LOWEST_CURRENT_OEM_QUOTE'
    });
    expect(result.fitmentTotal).toBe(3);
    expect(result.catalogChecks).toMatchObject({ attempted: 3, exactMatches: 3, unavailable: 0 });
    expect(result.dealerIdentityExposed).toBe(false);
    expect(result.images.every((image) => image.url.startsWith('https://api.partquill.com/v1/catalog/images/'))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts/i);
  });

  it('fails closed when no source returns an exact match', async () => {
    await expect(researchOemPart('13568-29025', {
      lookups: {
        lexus: async () => { throw new Error('not found'); },
        toyota: async () => { throw new Error('not found'); },
        scion: async () => { throw new Error('not found'); }
      }
    })).rejects.toThrow('No exact OEM catalog result');
  });
});
