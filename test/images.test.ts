import { describe, expect, it } from 'vitest';
import { createReadyItem, harness } from './helpers.js';

describe('original image retention and edit rights', () => {
  it('hashes and retains an immutable original before accepting a derivative', async () => {
    const { service, store } = harness();
    const item = await createReadyItem(service);
    const original = await service.saveImage(item.id, {
      sellerId: item.sellerId,
      kind: 'ORIGINAL',
      mediaType: 'image/jpeg',
      bytes: Buffer.from('original-item-pixels'),
      rightsBasis: 'SELLER_PHOTOGRAPH',
      watermarkStatus: 'NONE'
    });
    const derivative = await service.saveImage(item.id, {
      sellerId: item.sellerId,
      kind: 'DETERMINISTIC_DERIVATIVE',
      mediaType: 'image/png',
      bytes: Buffer.from('foreground-with-clean-background'),
      originalImageId: original.image.id,
      rightsBasis: 'SELLER_PHOTOGRAPH',
      watermarkStatus: 'NONE',
      itemPixelsPreserved: true
    });

    expect(original.image.sha256).toHaveLength(64);
    expect(derivative.image.originalImageId).toBe(original.image.id);
    expect(Buffer.from((await store.getImage(original.image.id))!.bytes).toString()).toBe('original-item-pixels');
  });

  it('blocks suspected third-party watermark removal', async () => {
    const { service } = harness();
    const item = await createReadyItem(service);
    await expect(
      service.saveImage(item.id, {
        sellerId: item.sellerId,
        kind: 'ORIGINAL',
        mediaType: 'image/jpeg',
        bytes: Buffer.from('supplier-photo'),
        rightsBasis: 'BUSINESS_OWNED',
        watermarkStatus: 'SUSPECTED_THIRD_PARTY'
      })
    ).rejects.toMatchObject({ code: 'THIRD_PARTY_WATERMARK_BLOCKED' });
  });

  it('blocks a derivative that changes item pixels', async () => {
    const { service } = harness();
    const item = await createReadyItem(service);
    const original = await service.saveImage(item.id, {
      sellerId: item.sellerId,
      kind: 'ORIGINAL',
      mediaType: 'image/jpeg',
      bytes: Buffer.from('original'),
      rightsBasis: 'SELLER_PHOTOGRAPH',
      watermarkStatus: 'NONE'
    });
    const result = await service.saveImage(item.id, {
      sellerId: item.sellerId,
      kind: 'DETERMINISTIC_DERIVATIVE',
      mediaType: 'image/png',
      bytes: Buffer.from('changed'),
      originalImageId: original.image.id,
      rightsBasis: 'SELLER_PHOTOGRAPH',
      watermarkStatus: 'NONE',
      itemPixelsPreserved: false
    });
    expect(result.item.status).toBe('BLOCKED');
    expect(result.item.exceptions.map((row) => row.code)).toContain('IMAGE_FOREGROUND_CHANGED');
  });
});
