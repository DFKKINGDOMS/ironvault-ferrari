import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId, now } from '../src/domain/canonical.js';
import type { ListingRecord } from '../src/domain/types.js';
import { buildApp } from '../src/http/app.js';
import { PostgresStore } from '../src/store/postgres-store.js';
import type { ReviewTransition } from '../src/store/store.js';
import { createReadyItem, harness, stageAndApprove, validPayload } from './helpers.js';

afterEach(() => vi.restoreAllMocks());

function refreshRequest(item: { payloadHash: string; payloadVersion: number }, listing: ListingRecord) {
  return { payloadHash: item.payloadHash, payloadVersion: item.payloadVersion, feeEstimateId: listing.feeEstimate!.id };
}

async function reviewTransition(): Promise<ReviewTransition> {
  const { service, store } = harness();
  const { item } = await stageAndApprove(service);
  const expectedItem = (await store.getItem(item.id))!;
  const expectedListing = (await store.getListing(item.id))!;
  const nextItem = { ...expectedItem, status: 'READY_FOR_PUBLIC_APPROVAL' as const, updatedAt: now() };
  return {
    expectedItem,
    expectedListing,
    item: nextItem,
    listing: { ...expectedListing, updatedAt: now() },
    audit: {
      id: newId(),
      sellerId: expectedItem.sellerId,
      itemId: expectedItem.id,
      actorId: 'reviewer',
      action: 'TEST_REVIEW_TRANSITION',
      outcome: 'SUCCEEDED',
      payloadHash: expectedItem.payloadHash,
      details: {},
      createdAt: now()
    }
  };
}

function postgresStoreWithClient(client: { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }) {
  const store = new PostgresStore('postgresql://partquill:partquill@127.0.0.1:5432/partquill_test', false);
  Object.defineProperty(store, 'pool', { value: { connect: vi.fn().mockResolvedValue(client) } });
  return store;
}

describe('version-bound review and fee recovery', () => {
  it('keeps the fee-refresh HTTP route authenticated and accepts an explicit null snapshot', async () => {
    const h = harness();
    const { item, staged } = await stageAndApprove(h.service);
    await h.store.saveListing({ ...staged.listing, feeEstimate: undefined });
    const app = await buildApp(h);
    try {
      const payload = {
        actorId: 'reviewer',
        payloadHash: item.payloadHash,
        payloadVersion: item.payloadVersion,
        feeEstimateId: null
      };
      expect((await app.inject({ method: 'POST', url: `/v1/items/${item.id}/fees/refresh`, payload })).statusCode).toBe(401);
      const refreshed = await app.inject({
        method: 'POST',
        url: `/v1/items/${item.id}/fees/refresh`,
        headers: { authorization: `Bearer ${h.config.PARTQUILL_API_KEY}` },
        payload
      });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json()).toMatchObject({
        item: { status: 'READY_FOR_PUBLIC_APPROVAL' },
        listing: { offerId: staged.listing.offerId, feeEstimate: { source: 'MOCK' } }
      });
    } finally {
      await app.close();
    }
  });

  it('commits PostgreSQL review state, listing, and audit in one transaction', async () => {
    const transition = await reviewTransition();
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM items')) return { rows: [{ record: transition.expectedItem }] };
      if (statement.includes('FROM listings')) return { rows: [{ record: transition.expectedListing }] };
      return { rows: [] };
    });
    const release = vi.fn();
    const store = postgresStoreWithClient({ query, release });

    await store.commitReviewTransition(transition);

    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements[0]).toBe('BEGIN');
    expect(statements.some((statement) => statement.includes('FROM items') && statement.includes('FOR UPDATE'))).toBe(true);
    expect(statements.some((statement) => statement.includes('FROM listings') && statement.includes('FOR UPDATE'))).toBe(true);
    expect(statements.some((statement) => statement.startsWith('UPDATE items'))).toBe(true);
    expect(statements.some((statement) => statement.includes('INSERT INTO listings'))).toBe(true);
    expect(statements.some((statement) => statement.startsWith('INSERT INTO audit_events'))).toBe(true);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back the PostgreSQL review transaction when its audit append fails', async () => {
    const transition = await reviewTransition();
    const query = vi.fn(async (statement: string) => {
      if (statement.includes('FROM items')) return { rows: [{ record: transition.expectedItem }] };
      if (statement.includes('FROM listings')) return { rows: [{ record: transition.expectedListing }] };
      if (statement.startsWith('INSERT INTO audit_events')) throw new Error('audit append failed');
      return { rows: [] };
    });
    const release = vi.fn();
    const store = postgresStoreWithClient({ query, release });

    await expect(store.commitReviewTransition(transition)).rejects.toThrow('audit append failed');

    expect(query.mock.calls.map(([statement]) => String(statement)).at(-1)).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not revive approvals when an edited payload is restored to its prior hash', async () => {
    const { service, gateway } = harness();
    const { item } = await stageAndApprove(service);
    await service.replacePayload(item.id, validPayload({ quantity: 2 }), 'editor');
    const restored = await service.replacePayload(item.id, item.payload, 'editor');
    expect(restored.payloadHash).toBe(item.payloadHash);
    expect(restored.payloadVersion).toBe(3);
    const stage = vi.spyOn(gateway, 'stageOffer');
    const publish = vi.spyOn(gateway, 'publish');
    await expect(service.stage(item.id, 'reviewer')).rejects.toMatchObject({ code: 'PREFLIGHT_APPROVAL_REQUIRED' });
    await expect(service.publish(item.id, 'reviewer')).rejects.toMatchObject({ code: 'PUBLIC_APPROVAL_REQUIRED' });
    expect(stage).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    await service.approvePreflight(item.id, 'reviewer', restored.payloadHash);
    const staged = await service.stage(item.id, 'reviewer');
    expect(staged.listing.stagedPayloadVersion).toBe(3);
    await service.approvePublic(item.id, 'reviewer', restored.payloadHash, staged.listing.feeEstimate!.id);
    expect((await service.publish(item.id, 'reviewer')).item.status).toBe('PUBLISHED');
  });

  it('holds legacy unversioned staging until the reviewed payload is staged again', async () => {
    const { service, store } = harness();
    const { item, staged } = await stageAndApprove(service);
    await store.saveListing({ ...staged.listing, stagedPayloadVersion: undefined });
    await expect(service.approvePublic(item.id, 'reviewer', item.payloadHash, staged.listing.feeEstimate!.id))
      .rejects.toMatchObject({ code: 'STAGED_PAYLOAD_VERSION_MISMATCH' });
    await expect(service.publish(item.id, 'reviewer')).rejects.toMatchObject({ code: 'STAGED_PAYLOAD_VERSION_MISMATCH' });
  });

  it.each([
    { fee: { expiresAt: '2000-01-01T00:00:00.000Z' }, code: 'FEE_ESTIMATE_EXPIRED' },
    { fee: { expiresAt: 'not-a-date' }, code: 'FEE_ESTIMATE_INVALID' },
    { fee: { amount: undefined }, code: 'FEE_ESTIMATE_INVALID' },
    { fee: { amount: '-1.00' }, code: 'FEE_ESTIMATE_INVALID' },
    { fee: { currency: undefined }, code: 'FEE_ESTIMATE_INVALID' },
    { fee: { source: 'UNAVAILABLE' as const }, code: 'FEE_ESTIMATE_UNAVAILABLE' },
    { fee: { source: 'EBAY_RESPONSE' as const }, code: 'FEE_ESTIMATE_UNAVAILABLE' }
  ])('rejects invalid fees at approval AND publish: $code / $fee', async ({ fee, code }) => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    await store.saveListing({ ...staged.listing, feeEstimate: { ...staged.listing.feeEstimate!, ...fee } });
    const publish = vi.spyOn(gateway, 'publish');
    await expect(service.approvePublic(item.id, 'reviewer', item.payloadHash, staged.listing.feeEstimate!.id))
      .rejects.toMatchObject({ code });
    await expect(service.publish(item.id, 'reviewer')).rejects.toMatchObject({ code });
    expect(publish).not.toHaveBeenCalled();
    expect(await store.getSuccessfulPublishCount(item.sellerId)).toBe(0);
    expect((await store.listAudit(item.id)).at(-1)).toMatchObject({ outcome: 'REJECTED', details: { code } });
  });

  it('requires an independent current preflight even when a public record exists', async () => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    const approvals = await store.listApprovals(item.id);
    vi.spyOn(store, 'listApprovals').mockResolvedValue(approvals.filter((approval) => approval.stage === 'PUBLIC'));
    const publish = vi.spyOn(gateway, 'publish');
    await expect(service.approvePublic(item.id, 'reviewer', item.payloadHash, staged.listing.feeEstimate!.id))
      .rejects.toMatchObject({ code: 'PREFLIGHT_APPROVAL_REQUIRED' });
    await expect(service.publish(item.id, 'reviewer')).rejects.toMatchObject({ code: 'PREFLIGHT_APPROVAL_REQUIRED' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('makes sequential approval and stage retries no-ops without new offers or ledger rows', async () => {
    const { service, store, gateway } = harness();
    const item = await createReadyItem(service);
    await service.acknowledgeInventoryApiOwnership(item.sellerId, 'seller-owner');
    const approved = await service.approvePreflight(item.id, 'reviewer', item.payloadHash);
    expect(await service.approvePreflight(item.id, 'reviewer', item.payloadHash)).toEqual(approved);
    const stageOffer = vi.spyOn(gateway, 'stageOffer');
    const estimate = vi.spyOn(gateway, 'estimateFees');
    const staged = await service.stage(item.id, 'reviewer');
    expect(await service.stage(item.id, 'reviewer')).toEqual(staged);
    const publicApproved = await service.approvePublic(item.id, 'reviewer', item.payloadHash, staged.listing.feeEstimate!.id);
    expect(await service.approvePublic(item.id, 'reviewer', item.payloadHash, staged.listing.feeEstimate!.id)).toEqual(publicApproved);
    expect(stageOffer).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(await store.listApprovals(item.id)).toHaveLength(2);
    const audit = await store.listAudit(item.id);
    expect(audit.filter((event) => event.action === 'PREFLIGHT_APPROVED')).toHaveLength(1);
    expect(audit.filter((event) => event.action === 'PUBLIC_APPROVED')).toHaveLength(1);
  });

  it('refreshes expired fees on the SAME offer and requires a new public approval', async () => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    const expiredListing = { ...staged.listing, feeEstimate: { ...staged.listing.feeEstimate!, expiresAt: '2000-01-01T00:00:00Z' } };
    await store.saveListing(expiredListing);
    const stageOffer = vi.spyOn(gateway, 'stageOffer');
    const publish = vi.spyOn(gateway, 'publish');
    const expected = refreshRequest(item, expiredListing);
    const refreshed = await service.refreshFees(item.id, 'reviewer', expected);
    expect(refreshed.listing.offerId).toBe(staged.listing.offerId);
    expect(refreshed.item).toMatchObject({ payloadHash: item.payloadHash, payloadVersion: item.payloadVersion, status: 'READY_FOR_PUBLIC_APPROVAL' });
    expect(refreshed.listing.feeEstimate!.id).not.toBe(expected.feeEstimateId);
    expect(stageOffer).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    await expect(service.refreshFees(item.id, 'reviewer', expected)).rejects.toMatchObject({ code: 'REVIEW_STATE_CHANGED' });
    await expect(service.publish(item.id, 'reviewer')).rejects.toMatchObject({ code: 'PUBLIC_APPROVAL_REQUIRED' });
    await expect(service.approvePublic(item.id, 'reviewer', item.payloadHash, expected.feeEstimateId))
      .rejects.toMatchObject({ code: 'FEE_ESTIMATE_MISMATCH' });
    await service.approvePublic(item.id, 'reviewer', item.payloadHash, refreshed.listing.feeEstimate!.id);
    expect((await service.publish(item.id, 'reviewer')).item.status).toBe('PUBLISHED');
    expect(await store.listApprovals(item.id)).toHaveLength(3);
    expect((await store.listAudit(item.id)).some((event) => event.action === 'FEES_REFRESHED_PUBLIC_APPROVAL_INVALIDATED')).toBe(true);
  });

  it('leaves the previous review intact on fee dependency failure and permits retry', async () => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    const before = await service.evidencePack(item.id);
    const estimate = vi.spyOn(gateway, 'estimateFees').mockRejectedValueOnce(new Error('dependency unavailable'));
    await expect(service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing)))
      .rejects.toMatchObject({ code: 'FEE_ESTIMATE_DEPENDENCY_FAILED', statusCode: 503 });
    expect(await store.getItem(item.id)).toEqual(before.item);
    expect(await store.getListing(item.id)).toEqual(before.listing);
    expect(await store.listAudit(item.id)).toEqual(before.audit);
    expect((await service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing))).item.status).toBe('READY_FOR_PUBLIC_APPROVAL');
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('rejects a fee refresh that reuses an approved estimate identifier', async () => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    vi.spyOn(gateway, 'estimateFees').mockResolvedValue(staged.listing.feeEstimate!);
    await expect(service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing)))
      .rejects.toMatchObject({ code: 'FEE_ESTIMATE_NOT_RENEWED' });
    expect((await store.getItem(item.id))?.status).toBe('PUBLIC_APPROVED');
  });

  it('recovers a missing fee estimate using an explicit null precondition', async () => {
    const { service, store } = harness();
    const { item, staged } = await stageAndApprove(service);
    await store.saveListing({ ...staged.listing, feeEstimate: undefined });
    const refreshed = await service.refreshFees(item.id, 'reviewer', {
      payloadHash: item.payloadHash, payloadVersion: item.payloadVersion, feeEstimateId: null
    });
    expect(refreshed.listing.offerId).toBe(staged.listing.offerId);
    expect(refreshed.listing.feeEstimate?.source).toBe('MOCK');
    expect(refreshed.item.status).toBe('READY_FOR_PUBLIC_APPROVAL');
  });

  it.each([
    { fee: { expiresAt: 'not-a-date' }, code: 'FEE_ESTIMATE_INVALID' },
    { fee: { expiresAt: '2000-01-01T00:00:00Z' }, code: 'FEE_ESTIMATE_EXPIRED' },
    { fee: { source: 'UNAVAILABLE' as const }, code: 'FEE_ESTIMATE_UNAVAILABLE' }
  ])('does not persist an unusable refreshed fee: $code', async ({ fee, code }) => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    vi.spyOn(gateway, 'estimateFees').mockResolvedValue({ ...staged.listing.feeEstimate!, id: newId(), ...fee });
    await expect(service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing))).rejects.toMatchObject({ code });
    expect(await store.getListing(item.id)).toEqual(staged.listing);
    expect((await store.getItem(item.id))?.status).toBe('PUBLIC_APPROVED');
  });

  it('keeps authorization loss actionable without exposing upstream diagnostics', async () => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    Object.defineProperty(gateway, 'mode', { value: 'live' });
    const estimate = vi.spyOn(gateway, 'estimateFees');
    await expect(service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing)))
      .rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED', message: 'Reconnect seller authorization before refreshing fees.' });
    expect(estimate).not.toHaveBeenCalled();
    expect((await store.getConnection(item.sellerId))?.status).toBe('AUTHORIZATION_REQUIRED');
    expect(await store.getListing(item.id)).toEqual(staged.listing);
  });

  it('does not overwrite an edit made while fees were being fetched', async () => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    vi.spyOn(gateway, 'estimateFees').mockImplementationOnce(async () => {
      await service.replacePayload(item.id, validPayload({ quantity: 2 }), 'editor');
      return { ...staged.listing.feeEstimate!, id: newId() };
    });
    await expect(service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing)))
      .rejects.toMatchObject({ code: 'REVIEW_STATE_CHANGED' });
    expect((await store.getItem(item.id))?.payload.quantity).toBe(2);
    expect(await store.getListing(item.id)).toEqual(staged.listing);
  });

  it('does not append an approval if the payload changes while evidence is read', async () => {
    const { service, store } = harness();
    const item = await createReadyItem(service);
    await service.acknowledgeInventoryApiOwnership(item.sellerId, 'seller-owner');
    vi.spyOn(store, 'listImages').mockImplementationOnce(async () => {
      await service.replacePayload(item.id, validPayload({ quantity: 2 }), 'editor');
      return [];
    });
    await expect(service.approvePreflight(item.id, 'reviewer', item.payloadHash)).rejects.toMatchObject({ code: 'REVIEW_STATE_CHANGED' });
    expect(await store.listApprovals(item.id)).toEqual([]);
    expect((await store.getItem(item.id))?.payload.quantity).toBe(2);
  });

  it('reevaluates evidence rather than trusting a stale empty exception array', async () => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    await store.addEvidence({ id: newId(), itemId: item.id, field: 'identity', value: 'held', state: 'BLOCKED', source: 'TEST', createdBy: 'reviewer', createdAt: now() });
    const estimate = vi.spyOn(gateway, 'estimateFees');
    const publish = vi.spyOn(gateway, 'publish');
    await expect(service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing))).rejects.toMatchObject({ code: 'DRAFT_HAS_EXCEPTIONS' });
    await expect(service.approvePublic(item.id, 'reviewer', item.payloadHash, staged.listing.feeEstimate!.id)).rejects.toMatchObject({ code: 'DRAFT_HAS_EXCEPTIONS' });
    await expect(service.publish(item.id, 'reviewer')).rejects.toMatchObject({ code: 'DRAFT_HAS_EXCEPTIONS' });
    expect(estimate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(['PUBLISHED', 'DRIFTED', 'WITHDRAWN'] as const)('does not restage or refresh a %s offer', async (status) => {
    const { service, store, gateway } = harness();
    const { item, staged } = await stageAndApprove(service);
    await store.saveListing({ ...staged.listing, status });
    const stageOffer = vi.spyOn(gateway, 'stageOffer');
    const estimate = vi.spyOn(gateway, 'estimateFees');
    await expect(service.stage(item.id, 'reviewer')).rejects.toMatchObject({ code: 'LISTING_LIFECYCLE_REQUIRED' });
    await expect(service.refreshFees(item.id, 'reviewer', refreshRequest(item, staged.listing))).rejects.toMatchObject({ code: 'STAGED_OFFER_REQUIRED' });
    expect(stageOffer).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  });

  it('does not partially stage when fee estimation fails', async () => {
    const { service, store, gateway } = harness();
    const item = await createReadyItem(service);
    await service.acknowledgeInventoryApiOwnership(item.sellerId, 'seller-owner');
    await service.approvePreflight(item.id, 'reviewer', item.payloadHash);
    vi.spyOn(gateway, 'estimateFees').mockRejectedValueOnce(new Error('dependency unavailable'));
    await expect(service.stage(item.id, 'reviewer')).rejects.toThrow('dependency unavailable');
    expect(await store.getListing(item.id)).toBeUndefined();
    expect((await store.getItem(item.id))?.status).toBe('PREFLIGHT_APPROVED');
    expect((await store.listAudit(item.id)).some((event) => event.action === 'OFFER_STAGED')).toBe(false);
  });
});
