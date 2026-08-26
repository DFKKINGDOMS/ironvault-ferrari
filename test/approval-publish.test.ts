import { describe, expect, it } from 'vitest';
import { createReadyItem, harness, stageAndApprove, validPayload } from './helpers.js';

describe('dual approval and publish safety', () => {
  it('publishes only after preflight, stage, fee-bound public approval', async () => {
    const { service, store } = harness();
    const { item } = await stageAndApprove(service);
    const result = await service.publish(item.id, 'publisher-1');

    expect(result.item.status).toBe('PUBLISHED');
    expect(result.listing.listingId).toMatch(/^mock-listing-/);
    expect(await store.getSuccessfulPublishCount('seller-1')).toBe(1);
  });

  it('rejects publishing without public approval and records the rejection', async () => {
    const { service, store } = harness();
    const item = await createReadyItem(service);
    await service.acknowledgeInventoryApiOwnership(item.sellerId, 'seller-owner');
    await service.approvePreflight(item.id, 'reviewer-1', item.payloadHash);
    await service.stage(item.id, 'reviewer-1');

    await expect(service.publish(item.id, 'publisher-1')).rejects.toMatchObject({
      code: 'PUBLIC_APPROVAL_REQUIRED'
    });
    expect((await store.listAudit(item.id)).at(-1)?.action).toBe('LISTING_PUBLISH_REJECTED');
  });

  it('invalidates approvals after any payload change', async () => {
    const { service } = harness();
    const { item, staged } = await stageAndApprove(service);
    await service.replacePayload(item.id, validPayload({ price: { currency: 'USD', value: '13.49' } }), 'editor-1');

    await expect(
      service.approvePublic(item.id, 'publisher-1', item.payloadHash, staged.listing.feeEstimate!.id)
    ).rejects.toMatchObject({ code: 'PAYLOAD_HASH_MISMATCH' });
    await expect(service.publish(item.id, 'publisher-1')).rejects.toMatchObject({
      code: 'PUBLIC_APPROVAL_REQUIRED'
    });
  });

  it('refuses all external writes when the kill switch is off', async () => {
    const { service } = harness({ ALLOW_EBAY_WRITES: false });
    const { item } = await stageAndApprove(service);
    await expect(service.publish(item.id, 'publisher-1')).rejects.toMatchObject({
      code: 'EXTERNAL_WRITES_DISABLED'
    });
  });

  it('requires the seller-facing Inventory API ownership acknowledgement', async () => {
    const { service } = harness();
    const item = await createReadyItem(service);
    await expect(service.approvePreflight(item.id, 'reviewer-1', item.payloadHash)).rejects.toMatchObject({
      code: 'INVENTORY_API_DISCLOSURE_REQUIRED'
    });
  });

  it('requires the explicit ready state, not merely an empty exception array', async () => {
    const { service, store } = harness();
    const item = await createReadyItem(service);
    await service.acknowledgeInventoryApiOwnership(item.sellerId, 'seller-owner');
    await store.saveItem({ ...item, status: 'CAPTURED', exceptions: [] });
    await expect(service.approvePreflight(item.id, 'reviewer-1', item.payloadHash)).rejects.toMatchObject({
      code: 'DRAFT_NOT_READY_FOR_PREFLIGHT'
    });
  });
});
