import { describe, expect, it } from 'vitest';
import {
  findCorrectOemPart,
  lookupVinFilteredParts,
  type VinFilteredPartCandidate
} from '../src/catalog/correct-part.js';
import type { OemPartResearch } from '../src/catalog/oem-research.js';

const vin = 'JT2BF22K1W0123456';

function researchFixture(partNumber = '13568-29025'): OemPartResearch {
  return {
    identity: {
      partNumber,
      description: 'Belt, Timing',
      alternateNames: ['Timing Belt'],
      manufacturerNotes: [],
      pncCodes: ['13568'],
      replacedBy: partNumber === '13568-29025' ? ['13568-YZZ10'] : [],
      replaces: []
    },
    brandCoverage: {
      catalogBrands: ['Toyota', 'Lexus'],
      fitmentBrands: ['Toyota', 'Lexus'],
      crossoverStatus: 'MULTI_BRAND'
    },
    pricing: {
      currency: 'USD',
      observedQuoteCount: 2,
      currentPriceLow: 49.97,
      currentPriceHigh: 54.59,
      anonymousQuotes: []
    },
    quickSale: {
      discountPercent: 20,
      basis: 'LOWEST_CURRENT_OEM_QUOTE',
      disclaimer: 'Anonymous OEM catalog estimate only.'
    },
    images: [],
    fitment: [{
      yearStart: 2002,
      yearEnd: 2002,
      make: 'Toyota',
      model: 'Camry',
      trimEngine: '3.0L V6',
      raw: '2002 Toyota Camry | 3.0L V6'
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

const decodedVehicle = {
  make: 'Toyota' as const,
  model: 'CAMRY',
  modelYear: 2002,
  engineModel: '1MZ-FE',
  displacementL: 3,
  cylinders: 6
};

describe('buyer correct-part recovery', () => {
  it('returns green only for one exact VIN-filtered PNC candidate', async () => {
    const lookedUp: Array<{ vin: string; family: string }> = [];
    const result = await findCorrectOemPart('13568-29025', vin, {
      decodeVin: async () => decodedVehicle,
      research: async (partNumber) => researchFixture(partNumber),
      lookupCandidates: async (_vehicle, fullVin, family) => {
        lookedUp.push({ vin: fullVin, family });
        return [
          { partNumber: '13568-09050', description: 'Belt, Timing', pncCode: '13568' },
          { partNumber: '13505-20030', description: 'Idler Sub-Assy, Timing Belt', pncCode: '13505' }
        ];
      }
    });
    expect(lookedUp).toEqual([{ vin, family: 'Timing Belt' }]);
    expect(result).toMatchObject({
      rejectedPartNumber: '13568-29025',
      partFamily: 'Timing Belt',
      vinLastFour: '3456',
      status: 'EXACT_MATCH',
      statusLabel: 'Correct part found',
      verdictTone: 'GREEN',
      matchBasis: 'VIN_FILTERED_PNC',
      candidatePartNumbers: ['13568-09050'],
      correctPart: { identity: { partNumber: '13568-09050' } },
      buyerFitmentVerified: true,
      sellerListingChanged: false,
      eBayWritePerformed: false,
      vinStored: false,
      dealerIdentityExposed: false
    });
    expect(JSON.stringify(result)).not.toContain(vin);
    expect(JSON.stringify(result)).not.toMatch(/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts/i);
  });

  it('stays amber when two parts share the requested PNC', async () => {
    const candidates: VinFilteredPartCandidate[] = [
      { partNumber: '13568-09050', description: 'Belt, Timing', pncCode: '13568' },
      { partNumber: '13568-20020', description: 'Belt, Timing', pncCode: '13568' }
    ];
    const result = await findCorrectOemPart('13568-29025', vin, {
      decodeVin: async () => decodedVehicle,
      research: async (partNumber) => researchFixture(partNumber),
      lookupCandidates: async () => candidates
    });
    expect(result).toMatchObject({
      status: 'MULTIPLE_MATCHES',
      statusLabel: 'Possible matching parts',
      verdictTone: 'AMBER',
      candidatePartNumbers: ['13568-09050', '13568-20020'],
      buyerFitmentVerified: false
    });
    expect(result.correctPart).toBeUndefined();
  });

  it('stays amber instead of choosing an adjacent timing component', async () => {
    const result = await findCorrectOemPart('13568-29025', vin, {
      decodeVin: async () => decodedVehicle,
      research: async (partNumber) => researchFixture(partNumber),
      lookupCandidates: async () => [
        { partNumber: '13505-20030', description: 'Idler Sub-Assy, Timing Belt', pncCode: '13505' },
        { partNumber: '11302-20010', description: 'Timing Belt Cover', pncCode: '11302' }
      ]
    });
    expect(result.status).toBe('NO_EXACT_MATCH');
    expect(result.verdictTone).toBe('AMBER');
    expect(result.candidatePartNumbers).toEqual([]);
  });

  it('uses the private VIN search payload but returns only sanitized candidates', async () => {
    const requestBodies: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/url/vehicle-redirect')) {
        requestBodies.push(String(init?.body));
        return new Response(JSON.stringify({
          data: { url: `/page_product/searchbyname?vin=${vin}&make=Toyota&model=Camry&year=2002&keywords=Timing%20Belt` }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/page_product/searchbyname')) {
        return new Response(`<script id="initialState">window.__INITIAL_STORE__ = ${JSON.stringify({
          initApp: { decodeVehicleInfo: { make: 'Toyota', model: 'Camry', year: '2002', vin } }
        })};</script>`, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (url.endsWith('/api/search/pagination-result-new')) {
        requestBodies.push(String(init?.body));
        return new Response(JSON.stringify({
          data: {
            parts: [
              { partNumber: '13568-09050', mainDesc: 'Belt, Timing', pncCode: '13568' },
              { partNumber: '13505-20030', mainDesc: 'Idler Sub-Assy, Timing Belt', pncCode: '13505' }
            ]
          }
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(null, { status: 404 });
    };
    const candidates = await lookupVinFilteredParts(decodedVehicle, vin, 'Timing Belt', fetcher);
    expect(requestBodies[0]).toContain(vin);
    expect(requestBodies[1]).toContain(vin);
    expect(candidates).toEqual([
      { partNumber: '13568-09050', description: 'Belt, Timing', pncCode: '13568' },
      { partNumber: '13505-20030', description: 'Idler Sub-Assy, Timing Belt', pncCode: '13505' }
    ]);
    expect(JSON.stringify(candidates)).not.toContain(vin);
    expect(JSON.stringify(candidates)).not.toMatch(/lexuspartsnow|toyotapartsdeal|longotoyota/i);
  });
});
