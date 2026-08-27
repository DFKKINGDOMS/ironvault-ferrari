import { describe, expect, it } from 'vitest';
import type { OemPartResearch } from '../src/catalog/oem-research.js';
import { decodeToyotaVin, verifyOemPartVin } from '../src/catalog/vin-fitment.js';

const vin = 'JT2BF22K1W0123456';

function vpicFetch(overrides: Record<string, string> = {}): typeof fetch {
  return async () => new Response(JSON.stringify({
    Results: [{
      ErrorCode: '0',
      Make: 'TOYOTA',
      Model: 'CAMRY',
      ModelYear: '2002',
      EngineModel: '1MZ-FE',
      DisplacementL: '3.0',
      EngineCylinders: '6',
      Trim: 'XLE',
      ...overrides
    }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function researchWithFitment(raw: string, trimEngine?: string): OemPartResearch {
  return {
    identity: {
      partNumber: '13568-29025',
      description: 'Belt, Timing',
      alternateNames: ['Timing Belt'],
      manufacturerNotes: [],
      pncCodes: ['13568'],
      replacedBy: ['13568-YZZ10'],
      replaces: []
    },
    brandCoverage: {
      catalogBrands: ['Lexus', 'Toyota'],
      fitmentBrands: ['Lexus', 'Toyota'],
      crossoverStatus: 'MULTI_BRAND'
    },
    pricing: { currency: 'USD', observedQuoteCount: 2, anonymousQuotes: [] },
    quickSale: {
      discountPercent: 20,
      basis: 'UNAVAILABLE',
      disclaimer: 'Anonymous OEM catalog estimate only.'
    },
    images: [],
    fitment: [{
      yearStart: 1997,
      yearEnd: 2006,
      make: 'Toyota',
      model: 'Camry',
      ...(trimEngine ? { trimEngine } : {}),
      raw
    }],
    fitmentTotal: 1,
    catalogChecks: {
      attempted: 3,
      exactMatches: 2,
      unavailable: 1,
      retrievedAt: '2026-08-27T12:00:00.000Z'
    },
    dealerIdentityExposed: false,
    vinConfirmationRequired: true
  };
}

describe('buyer VIN catalog cross-check', () => {
  it('decodes a supported VIN without adding source identity', async () => {
    const decoded = await decodeToyotaVin(vin, vpicFetch());
    expect(decoded).toEqual(expect.objectContaining({
      make: 'Toyota',
      model: 'CAMRY',
      modelYear: 2002,
      engineModel: '1MZ-FE',
      displacementL: 3,
      cylinders: 6
    }));
  });

  it('allows catalog fitment only when year, make, model and engine evidence match', async () => {
    const result = await verifyOemPartVin('13568-29025', vin, {
      fetch: vpicFetch(),
      research: async () => researchWithFitment('1997-2006 Toyota Camry | 3.0L V6 | 1MZ-FE', '3.0L V6 | 1MZ-FE')
    });
    expect(result).toMatchObject({
      partNumber: '13568-29025',
      vinLastFour: '3456',
      status: 'CATALOG_MATCH',
      listingFitmentAllowed: true,
      vinStored: false,
      dealerIdentityExposed: false,
      catalogChecks: { attempted: 3, exactPartMatches: 2, matchingRows: 1 }
    });
    expect(JSON.stringify(result)).not.toContain(vin);
  });

  it('fails closed when the decoded vehicle has no matching catalog row', async () => {
    const result = await verifyOemPartVin('13568-29025', vin, {
      fetch: vpicFetch({ Model: 'COROLLA', ModelYear: '2002', EngineModel: '1ZZ-FE', DisplacementL: '1.8' }),
      research: async () => researchWithFitment('1997-2006 Toyota Camry | 3.0L V6 | 1MZ-FE', '3.0L V6 | 1MZ-FE')
    });
    expect(result.status).toBe('CATALOG_NO_MATCH');
    expect(result.listingFitmentAllowed).toBe(false);
  });

  it('returns inconclusive rather than guessing when engine evidence is broad', async () => {
    const result = await verifyOemPartVin('13568-29025', vin, {
      fetch: vpicFetch(),
      research: async () => researchWithFitment('1997-2006 Toyota Camry V6')
    });
    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.listingFitmentAllowed).toBe(false);
  });

  it('rejects malformed VINs before any network request', async () => {
    let called = false;
    await expect(decodeToyotaVin('NOT-A-VIN', async () => {
      called = true;
      return new Response();
    })).rejects.toThrow('17-character VIN');
    expect(called).toBe(false);
  });
});
