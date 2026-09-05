import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioFileStore } from '../src/image-studio/file-store.js';
import { ShopifyMediaCatalog } from '../src/shopify-media/catalog.js';
import {
  SHOPIFY_MEDIA_JOB_ID,
  SHOPIFY_MEDIA_PROFILE,
  SHOPIFY_MEDIA_PUBLIC_SOURCE,
  SHOPIFY_MEDIA_SOURCE_STORE,
  type ShopifyMediaAssetRecord,
  type ShopifyPartMediaIndex
} from '../src/shopify-media/types.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'partquill-shopify-media-'));
  roots.push(root);
  const store = new StudioFileStore(root);
  await store.initialize();
  const catalog = new ShopifyMediaCatalog(store);
  const sourceSha256 = 'a'.repeat(64);
  const derivativePath = store.artifactPath(
    SHOPIFY_MEDIA_JOB_ID,
    'derivatives',
    `${sourceSha256}-${SHOPIFY_MEDIA_PROFILE}.jpg`
  );
  const record: ShopifyMediaAssetRecord = {
    id: 'b'.repeat(32),
    source: 'SHOPIFY_PRODUCT_MEDIA',
    sourceStore: SHOPIFY_MEDIA_SOURCE_STORE,
    shopifyFileId: 'gid://shopify/MediaImage/123',
    shopifyProductId: 'gid://shopify/Product/456',
    shopifyMediaId: 'gid://shopify/MediaImage/123',
    filename: 'private-source-name.jpg',
    alt: 'Private source alt text',
    partNumbers: ['10110989'],
    sourceUrl: 'https://cdn.shopify.com/s/files/1/example/10110989.jpg',
    sourceSha256,
    originalPath: store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'originals', `${sourceSha256}.jpg`),
    derivativePath,
    derivativeSha256: 'c'.repeat(64),
    width: 900,
    height: 700,
    qa: {
      status: 'PASSED',
      profile: SHOPIFY_MEDIA_PROFILE,
      classifierModel: 'gpt-6-astra-1',
      comparisonModel: 'gpt-6-astra-1',
      editModel: 'partquill-local-background-v2',
      reason: 'source comparison passed',
      checkedAt: '2026-09-05T17:00:00.000Z',
      output: {
        width: 2000,
        height: 2000,
        mediaType: 'image/jpeg',
        colorSpace: 'srgb',
        metadataStripped: true,
        background: '#FFFFFF'
      }
    },
    createdAt: '2026-09-05T17:00:00.000Z',
    updatedAt: '2026-09-05T17:00:00.000Z'
  };
  const index: ShopifyPartMediaIndex = {
    id: 'shopify-media-10110989',
    schemaVersion: 1,
    partNumber: '10110989',
    sourceStore: SHOPIFY_MEDIA_SOURCE_STORE,
    profile: SHOPIFY_MEDIA_PROFILE,
    assets: [record],
    updatedAt: '2026-09-05T17:00:00.000Z'
  };
  await store.writeBytes(catalog.indexPath('10110989'), Buffer.from(JSON.stringify(index)));
  await store.writeBytes(derivativePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return { store, catalog, index, derivativePath };
}

describe('Shopify merchant-media catalog', () => {
  it('returns only neutral, exact-key, QA-passed public media', async () => {
    const { catalog } = await fixture();
    const match = await catalog.lookup('10110-989');
    expect(match).toMatchObject({
      partNumber: '10110989',
      sourceStore: SHOPIFY_MEDIA_PUBLIC_SOURCE,
      assets: [{
        filename: '10110989-01.jpg',
        alt: 'Merchant product image 1 for part 10110989',
        mappingState: 'EXACT_SHOPIFY_SKU',
        qaState: 'FERRARI_RULES_PASSED',
        requiresActualItemConfirmation: true
      }]
    });
    expect(JSON.stringify(match)).not.toContain('Private source');
    expect(await catalog.readImage('10110989', 'b'.repeat(32))).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  it('refuses an index whose derivative path does not exactly match its immutable source hash', async () => {
    const { store, catalog, index } = await fixture();
    index.assets[0]!.derivativePath = store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'derivatives', '../originals/private.jpg');
    await store.replaceBytes(catalog.indexPath('10110989'), Buffer.from(JSON.stringify(index)));
    expect(await catalog.readImage('10110989', 'b'.repeat(32))).toBeNull();
  });

  it('returns no match for an unknown or mismatched part key', async () => {
    const { catalog } = await fixture();
    expect(await catalog.lookup('99999999')).toBeNull();
  });
});
