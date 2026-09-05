import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/http/app.js';
import { StudioFileStore } from '../src/image-studio/file-store.js';
import { ShopifyMediaCatalog } from '../src/shopify-media/catalog.js';
import {
  SHOPIFY_MEDIA_JOB_ID,
  SHOPIFY_MEDIA_PROFILE,
  SHOPIFY_MEDIA_PUBLIC_SOURCE,
  SHOPIFY_MEDIA_SOURCE_STORE,
  type ShopifyPartMediaIndex
} from '../src/shopify-media/types.js';
import { harness } from './helpers.js';

const roots: string[] = [];
let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Shopify merchant media HTTP integration', () => {
  it('maps exact passed media into the preview without clearing the seller-photo gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'partquill-shopify-http-'));
    roots.push(root);
    const files = new StudioFileStore(root);
    await files.initialize();
    const catalog = new ShopifyMediaCatalog(files);
    const sourceSha = '1'.repeat(64);
    const assetId = '2'.repeat(32);
    const derivativePath = files.artifactPath(
      SHOPIFY_MEDIA_JOB_ID,
      'derivatives',
      `${sourceSha}-${SHOPIFY_MEDIA_PROFILE}.jpg`
    );
    const index: ShopifyPartMediaIndex = {
      id: 'shopify-media-10110989',
      schemaVersion: 1,
      partNumber: '10110989',
      sourceStore: SHOPIFY_MEDIA_SOURCE_STORE,
      profile: SHOPIFY_MEDIA_PROFILE,
      assets: [{
        id: assetId,
        source: 'SHOPIFY_PRODUCT_MEDIA',
        sourceStore: SHOPIFY_MEDIA_SOURCE_STORE,
        shopifyFileId: 'gid://shopify/MediaImage/10110989',
        shopifyProductId: 'gid://shopify/Product/10110989',
        shopifyMediaId: 'gid://shopify/MediaImage/10110989',
        filename: 'internal-source-name.jpg',
        alt: 'internal source alt text',
        partNumbers: ['10110989'],
        sourceUrl: 'https://cdn.shopify.com/s/files/1/example/10110989.jpg',
        sourceSha256: sourceSha,
        originalPath: files.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'originals', `${sourceSha}.jpg`),
        derivativePath,
        derivativeSha256: '3'.repeat(64),
        width: 1200,
        height: 900,
        qa: {
          status: 'PASSED',
          profile: SHOPIFY_MEDIA_PROFILE,
          classifierModel: 'gpt-6-astra-1',
          comparisonModel: 'gpt-6-astra-1',
          editModel: 'partquill-local-background-v2',
          reason: 'strict source comparison passed',
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
      }],
      updatedAt: '2026-09-05T17:00:00.000Z'
    };
    await files.writeBytes(catalog.indexPath('10110989'), Buffer.from(JSON.stringify(index)));
    await files.writeBytes(derivativePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const h = harness({ ALLOW_EBAY_WRITES: false, SHOPIFY_MEDIA_ENABLED: true });
    app = await buildApp({ ...h, shopifyMedia: catalog });
    const preview = await app.inject({
      method: 'POST',
      url: '/v1/seller-ui/command-preview',
      payload: { command: 'List part 10110989 for $9.99' }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview).toMatchObject({
      media: {
        state: 'SELLER_PHOTO_REQUIRED',
        merchantMedia: {
          partNumber: '10110989',
          sourceStore: SHOPIFY_MEDIA_PUBLIC_SOURCE,
          assets: [{
            id: assetId,
            filename: '10110989-01.jpg',
            qaState: 'FERRARI_RULES_PASSED',
            mappingState: 'EXACT_SHOPIFY_SKU',
            requiresActualItemConfirmation: true
          }]
        }
      },
      gates: { publicEbayWrite: 'DISABLED' }
    });
    expect(preview.body).not.toContain(SHOPIFY_MEDIA_SOURCE_STORE);
    expect(preview.body).not.toContain('internal-source');

    const question = await app.inject({
      method: 'POST',
      url: '/v1/seller-ui/command-preview',
      payload: { command: 'What do you know about part 10110989?' }
    });
    expect(question.statusCode).toBe(200);
    expect(question.json()).toMatchObject({
      assistantAnswer: {
        evidence: { partNumber: '10110989', approvedImageCount: 1 },
        images: [{
          id: assetId,
          filename: '10110989-01.jpg',
          width: 2000,
          height: 2000,
          qaState: 'FERRARI_RULES_PASSED',
          requiresActualItemConfirmation: true
        }],
        listingDraftCreated: false,
        publicEbayWrite: 'DISABLED'
      }
    });
    expect(question.json().preview).toBeUndefined();
    expect(question.body).not.toContain(SHOPIFY_MEDIA_SOURCE_STORE);
    expect(question.body).not.toContain('internal-source');

    const image = await app.inject({
      method: 'GET',
      url: `/v1/shopify-media/parts/10110989/images/${assetId}`
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toContain('image/jpeg');
    expect(image.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });
});
