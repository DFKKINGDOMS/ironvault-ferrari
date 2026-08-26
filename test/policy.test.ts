import { describe, expect, it } from 'vitest';
import { createReadyItem, harness, validPayload } from './helpers.js';

describe('eBay-first launch policy', () => {
  it('blocks unverified compatibility', async () => {
    const { service } = harness();
    const item = await createReadyItem(service, {
      compatibility: [{ Make: 'Chevrolet', Model: 'Chevelle', Year: '1964' }]
    });
    expect(item.status).toBe('BLOCKED');
    expect(item.exceptions.map((row) => row.code)).toContain('FITMENT_NOT_VERIFIED');
  });

  it('holds international only when origin or HS code is unknown', async () => {
    const { service } = harness();
    const item = await createReadyItem(service, { internationalEligible: true });
    expect(item.status).toBe('HELD');
    expect(item.exceptions).toContainEqual(expect.objectContaining({ code: 'INTERNATIONAL_CUSTOMS_HOLD', severity: 'HOLD' }));
  });

  it('does not hold an otherwise valid domestic draft for unknown origin', async () => {
    const { service } = harness();
    const item = await createReadyItem(service, { countryOfOrigin: undefined, hsCode: undefined, internationalEligible: false });
    expect(item.status).toBe('READY_FOR_PREFLIGHT');
  });

  it('blocks safety-critical keywords in the pilot', async () => {
    const { service } = harness();
    const item = await createReadyItem(service, {
      title: 'Fits Chevrolet Airbag Inflator Module',
      description: 'Used airbag inflator module'
    });
    expect(item.status).toBe('BLOCKED');
    expect(item.exceptions.map((row) => row.code)).toContain('SAFETY_CRITICAL_REVIEW');
  });

  it('requires core terms for reman core inventory', async () => {
    const { service } = harness();
    const item = await createReadyItem(service, {
      condition: 'REMANUFACTURED',
      title: 'Remanufactured Alternator',
      description: 'Remanufactured alternator without documented core terms'
    });
    expect(item.exceptions.map((row) => row.code)).toContain('CORE_TERMS_REQUIRED');
  });

  it('enforces the 80-character title contract at the schema boundary', async () => {
    const payload = validPayload({ title: 'x'.repeat(81) });
    const { listingPayloadSchema } = await import('../src/domain/schemas.js');
    expect(() => listingPayloadSchema.parse(payload)).toThrow();
  });

  it('blocks an append-only conflicting evidence record even when the payload itself is unchanged', async () => {
    const { service } = harness();
    const item = await createReadyItem(service);
    const blocked = await service.addEvidence(item.id, {
      field: 'mpn',
      value: { observed: ['51040', '51042'] },
      state: 'CONFLICTING_EVIDENCE',
      source: 'OCR_REVIEW',
      createdBy: 'reviewer-1'
    });
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.exceptions.map((row) => row.code)).toContain('EVIDENCE_CONFLICT');
  });

  it('never promotes a mock identifier into ePID or eBay catalog evidence', async () => {
    const { service, store } = harness();
    const item = await createReadyItem(service);
    const resolved = await service.resolveCatalog(item.id, 'catalog-worker');
    const evidence = await store.listEvidence(item.id);
    expect(resolved.payload.epid).toBeUndefined();
    expect(evidence[0]?.state).toBe('FITMENT_NOT_VERIFIED');
    expect(evidence[0]?.source).toBe('MOCK_EBAY_CATALOG');
  });
});
