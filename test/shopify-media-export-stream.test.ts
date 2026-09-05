import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  scanShopifyExport,
  shopifyCandidateKey,
  streamShopifyCandidates
} from '../src/shopify-media/export-stream.js';

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const row of rows) values.push(row);
  return values;
}

describe('streaming Shopify media export', () => {
  it('maps product media by exact SKU even when the variant appears later in the JSONL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'partquill-export-'));
    const path = join(directory, 'export.jsonl');
    const rows = [
      {
        __typename: 'MediaImage',
        id: 'gid://shopify/MediaImage/1',
        __parentId: 'gid://shopify/Product/9',
        mimeType: 'image/jpeg',
        image: { url: 'https://cdn.shopify.com/s/files/1/photo.jpg?v=1', width: 1600, height: 1200 }
      },
      {
        id: 'gid://shopify/ProductVariant/7',
        __parentId: 'gid://shopify/Product/9',
        sku: '10110989'
      },
      {
        __typename: 'MediaImage',
        id: 'gid://shopify/MediaImage/2',
        alt: 'A descriptive vehicle sentence must not become identity',
        image: { url: 'https://cdn.shopify.com/s/files/1/random-photo.jpg', width: 1000, height: 1000 }
      }
    ];
    await writeFile(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    try {
      const scan = await scanShopifyExport(path);
      expect(scan.mediaRows).toBe(2);
      expect(scan.productSkus.get('gid://shopify/Product/9')).toEqual(['10110989']);
      const mapped = await collect(streamShopifyCandidates(path, scan.productSkus, 'MAPPED'));
      const unmapped = await collect(streamShopifyCandidates(path, scan.productSkus, 'UNMAPPED'));
      expect(mapped).toHaveLength(1);
      expect(mapped[0]?.partNumbers).toEqual(['10110989']);
      expect(mapped[0]?.source).toBe('SHOPIFY_PRODUCT_MEDIA');
      expect(unmapped).toHaveLength(1);
      expect(unmapped[0]?.partNumbers).toEqual([]);
      expect(shopifyCandidateKey(mapped[0]!)).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('streams repeated rows independently so pixel deduplication can retain exact associations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'partquill-export-'));
    const path = join(directory, 'export.jsonl');
    const image = {
      __typename: 'MediaImage',
      id: 'gid://shopify/MediaImage/44',
      image: { url: 'https://cdn.shopify.com/s/files/1/10110989.jpg', width: 2000, height: 2000 }
    };
    await writeFile(path, `${JSON.stringify(image)}\n${JSON.stringify(image)}\n`);
    try {
      const scan = await scanShopifyExport(path);
      const mapped = await collect(streamShopifyCandidates(path, scan.productSkus, 'MAPPED'));
      expect(scan.mediaRows).toBe(2);
      expect(mapped).toHaveLength(2);
      expect(mapped.every((candidate) => candidate.partNumbers[0] === '10110989')).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
