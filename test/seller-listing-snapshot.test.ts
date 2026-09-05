import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/http/app.js';
import type { SellerListingRecord } from '../src/seller-listings/types.js';
import { harness } from './helpers.js';

const snapshotRows: SellerListingRecord[] = [
  {
    sourceRow: 2,
    sku: '1996743',
    partNumber: '1996743',
    title: 'Seller-authored exact-key listing for part 1996743',
    availableQuantity: 7,
    soldQuantity: 2,
    currency: 'USD',
    askingPrice: '19.95',
    condition: 'Used',
    normalizationState: 'NORMALIZED_EXACT_KEY',
    normalizationIssue: null
  },
  {
    sourceRow: 3,
    sku: '3938633',
    partNumber: '3938633',
    title: '1969 GM Camaro Rear Bumper Overrider Guards',
    availableQuantity: 8,
    soldQuantity: 0,
    currency: 'USD',
    askingPrice: '49.99',
    condition: 'New',
    normalizationState: 'NORMALIZED_EXACT_KEY',
    normalizationIssue: null
  },
  {
    sourceRow: 4,
    sku: '3846810',
    partNumber: '3846810',
    title: '1967-1969 Camaro Firebird Control Arm Bushing',
    availableQuantity: 11,
    soldQuantity: 1,
    currency: 'USD',
    askingPrice: '24.99',
    condition: 'New',
    normalizationState: 'NORMALIZED_EXACT_KEY',
    normalizationIssue: null
  }
];

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

describe('seller-owned listing snapshot evidence', () => {
  it('answers an exact missing catalog key and returns vehicle candidates without claiming verified fitment', async () => {
    const h = harness({ ALLOW_EBAY_WRITES: false });
    await h.store.importSellerListingRecords(snapshotRows, {
      datasetId: 'seller-listings-2026-08-08-test',
      sourceSha256: 'a'.repeat(64),
      sourceFileName: 'active-listings-2026-08-08.csv',
      snapshotDate: '2026-08-08',
      sourceTotalRows: snapshotRows.length,
      expectedRows: snapshotRows.length,
      complete: true
    });
    app = await buildApp(h);

    const exact = await app.inject({
      method: 'POST',
      url: '/v1/seller-ui/command-preview',
      payload: { command: '1996743' }
    });
    expect(exact.statusCode).toBe(200);
    expect(exact.json()).toMatchObject({
      assistantAnswer: {
        status: 'EVIDENCE_LIMITED',
        evidence: {
          partNumber: '1996743',
          sellerListingState: 'EXACT_MATCH',
          sellerListingMatches: 1,
          sellerListedUnits: 7,
          sellerListingSnapshotDate: '2026-08-08'
        },
        listingDraftCreated: false,
        publicEbayWrite: 'DISABLED'
      }
    });
    expect(exact.json().assistantAnswer.answer).toContain('USD 19.95');
    expect(exact.json().assistantAnswer.answer).toContain('not current physical stock');

    const vehicle = await app.inject({
      method: 'POST',
      url: '/v1/seller-ui/command-preview',
      payload: { command: 'Give me all 1969 Camaro parts we have in stock' }
    });
    expect(vehicle.statusCode).toBe(200);
    expect(vehicle.json()).toMatchObject({
      inventoryAnswer: {
        sellerListingSnapshot: {
          state: 'AVAILABLE',
          snapshotDate: '2026-08-08',
          candidateCount: 2
        },
        sellerListingCandidates: [
          expect.objectContaining({ partNumber: '3846810', fitmentVerified: false, physicalInventoryVerified: false }),
          expect.objectContaining({ partNumber: '3938633', fitmentVerified: false, physicalInventoryVerified: false })
        ],
        listingDraftCreated: false
      }
    });
  });
});
