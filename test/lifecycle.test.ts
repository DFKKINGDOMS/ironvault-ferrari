import { describe, expect, it } from 'vitest';
import { createReadyItem, harness, stageAndApprove, validPayload } from './helpers.js';

describe('post-publish lifecycle', () => {
  it('revises price and quantity through the gateway and preserves an audit trail', async () => {
    const { service, store } = harness();
    const { item } = await stageAndApprove(service);
    await service.publish(item.id, 'publisher-1');
    const listing = await service.revise(item.id, 'operator-1', { price: '14.25', quantity: 4 });
    const revisedItem = await store.getItem(item.id);

    expect(listing.status).toBe('PUBLISHED');
    expect(revisedItem?.payload.price.value).toBe('14.25');
    expect(revisedItem?.payload.quantity).toBe(4);
    expect((await store.listAudit(item.id)).map((row) => row.action)).toContain('LISTING_REVISED');
  });

  it('withdraws through the owned offer path and retains the local evidence', async () => {
    const { service, store } = harness();
    const { item } = await stageAndApprove(service);
    await service.publish(item.id, 'publisher-1');
    const listing = await service.withdraw(item.id, 'operator-1', 'Seller removed inventory from sale');

    expect(listing.status).toBe('WITHDRAWN');
    expect((await store.getItem(item.id))?.status).toBe('WITHDRAWN');
    expect((await service.evidencePack(item.id)).audit).toBeInstanceOf(Array);
  });

  it('detects remote drift and records evidence without overwriting the local snapshot', async () => {
    const { service, store } = harness();
    const { item } = await stageAndApprove(service);
    await service.publish(item.id, 'publisher-1');
    const result = await service.reconcile(item.id, 'monitor-1');

    expect(result.drifted).toBe(true);
    expect(result.listing.status).toBe('DRIFTED');
    expect((await store.listEvidence(item.id)).map((row) => row.state)).toContain('REMOTE_CHANGE_DETECTED');
  });

  it('counts successful publishes only and blocks the eleventh free listing', async () => {
    const { service, store } = harness();
    await service.acknowledgeInventoryApiOwnership('free-seller', 'seller-owner');
    for (let index = 0; index < 10; index += 1) {
      const payload = validPayload({ sku: `FREE-${index}`, mpn: `MPN-${index}`, title: `New Boxed Test Part MPN-${index}` });
      const item = await service.createItem({
        sellerId: 'free-seller',
        runId: 'allowance-run',
        inventoryAuthority: 'partquill_master',
        payload
      });
      await service.approvePreflight(item.id, 'reviewer', item.payloadHash);
      const staged = await service.stage(item.id, 'reviewer');
      await service.approvePublic(item.id, 'publisher', item.payloadHash, staged.listing.feeEstimate!.id);
      await service.publish(item.id, 'publisher');
    }
    expect(await store.getSuccessfulPublishCount('free-seller')).toBe(10);

    const eleventh = await service.createItem({
      sellerId: 'free-seller',
      runId: 'allowance-run',
      inventoryAuthority: 'partquill_master',
      payload: validPayload({ sku: 'FREE-10', mpn: 'MPN-10', title: 'New Boxed Test Part MPN-10' })
    });
    await service.approvePreflight(eleventh.id, 'reviewer', eleventh.payloadHash);
    const staged = await service.stage(eleventh.id, 'reviewer');
    await service.approvePublic(eleventh.id, 'publisher', eleventh.payloadHash, staged.listing.feeEstimate!.id);
    await expect(service.publish(eleventh.id, 'publisher')).rejects.toMatchObject({ code: 'FREE_ALLOWANCE_EXHAUSTED' });
    expect(await store.getSuccessfulPublishCount('free-seller')).toBe(10);
  });

  it('places blocks before holds in the exception-first queue', async () => {
    const { service } = harness();
    await createReadyItem(service, { sku: 'HOLD-1', internationalEligible: true });
    await createReadyItem(service, {
      sku: 'BLOCK-1',
      title: 'Used Airbag Inflator Module',
      description: 'Safety critical test fixture'
    });
    const queue = await service.exceptionQueue('seller-1');
    expect(queue[0]?.status).toBe('BLOCKED');
    expect(queue[1]?.status).toBe('HELD');
  });

  it('reopens fitment evidence and invalidates the public payload after a does-not-fit report', async () => {
    const { service, store } = harness();
    const item = await createReadyItem(service);
    await service.addEvidence(item.id, {
      field: 'compatibility',
      value: { source: 'test-eBay-response' },
      state: 'EBAY_COMPATIBILITY',
      source: 'TEST_FIXTURE',
      createdBy: 'catalog-worker'
    });
    const withCompatibility = await service.replacePayload(
      item.id,
      validPayload({ compatibility: [{ Make: 'Chevrolet', Model: 'Chevelle', Year: '1964' }] }),
      'catalog-worker'
    );
    const evidence = await store.listEvidence(item.id);
    const reopened = await service.reportDoesNotFit(
      item.id,
      'returns-agent',
      'Buyer reports bolt pattern does not match',
      evidence[0]!.id
    );
    expect(reopened.item.status).toBe('HELD');
    expect(reopened.item.payloadHash).not.toBe(withCompatibility.payloadHash);
    expect(reopened.item.exceptions.map((row) => row.code)).toContain('FITMENT_REVIEW_REOPENED');
  });

  it('quarantines sibling compatibility claims sharing the same evidence edge', async () => {
    const { service, store } = harness();
    const first = await createReadyItem(service, { sku: 'EDGE-1' });
    const second = await createReadyItem(service, { sku: 'EDGE-2' });
    for (const item of [first, second]) {
      await service.addEvidence(item.id, {
        field: 'compatibility',
        value: { source: 'eBay compatibility fixture' },
        state: 'EBAY_COMPATIBILITY',
        source: 'TEST_FIXTURE',
        sourceReference: 'edge:epid-123:fitment-456',
        createdBy: 'catalog-worker'
      });
      await service.replacePayload(
        item.id,
        validPayload({ sku: item.sku, compatibility: [{ Make: 'Chevrolet', Model: 'Chevelle', Year: '1964' }] }),
        'catalog-worker'
      );
    }
    const evidence = await store.listEvidence(first.id);
    const result = await service.reportDoesNotFit(
      first.id,
      'returns-agent',
      'Buyer reports the mounting points do not align',
      evidence[0]!.id
    );
    expect(result.siblingItemIds).toContain(second.id);
    expect((await store.getItem(second.id))?.status).toBe('HELD');
    expect((await store.getItem(second.id))?.payload.compatibility).toEqual([]);
  });

  it('requires an explicit drift disposition and can accept the remote snapshot', async () => {
    const { service, store } = harness();
    const { item } = await stageAndApprove(service);
    await service.publish(item.id, 'publisher-1');
    await service.reconcile(item.id, 'monitor-1');
    expect((await store.getItem(item.id))?.status).toBe('HELD');
    const resolved = await service.resolveDrift(item.id, 'seller-owner', 'ACCEPT_REMOTE');
    expect(resolved.listing.status).toBe('PUBLISHED');
    expect(resolved.item.status).toBe('PUBLISHED');
  });
});
