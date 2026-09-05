import { describe, expect, it } from 'vitest';
import { exactCanaryCandidates } from '../src/shopify-media/canary-source.js';

describe('exact Shopify media canary', () => {
  it('uses only an exact variant SKU and its real product media', () => {
    const payload = {
      productVariants: {
        nodes: [
          {
            sku: '101109890',
            product: {
              id: 'gid://shopify/Product/wrong',
              media: { nodes: [{ __typename: 'MediaImage', id: 'gid://shopify/MediaImage/wrong', mimeType: 'image/jpeg', image: { url: 'https://cdn.shopify.com/s/files/wrong.jpg', width: 800, height: 600 } }] }
            }
          },
          {
            sku: '10110989',
            product: {
              id: 'gid://shopify/Product/9159375421739',
              media: {
                nodes: [
                  { __typename: 'MediaImage', id: 'gid://shopify/MediaImage/1', alt: '', mimeType: 'image/jpeg', image: { url: 'https://cdn.shopify.com/s/files/1/10110989.jpg?v=1', width: 800, height: 600 } },
                  { __typename: 'MediaImage', id: 'gid://shopify/MediaImage/2', alt: '', mimeType: 'image/jpeg', image: { url: 'https://cdn.shopify.com/s/files/1/10110989a.jpg?v=1', width: 800, height: 600 } },
                  { __typename: 'Video', id: 'gid://shopify/Video/3' }
                ]
              }
            }
          }
        ]
      }
    };

    const candidates = exactCanaryCandidates(payload, '10110989');

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.filename)).toEqual(['10110989.jpg', '10110989a.jpg']);
    expect(candidates.every((candidate) => candidate.source === 'SHOPIFY_PRODUCT_MEDIA')).toBe(true);
    expect(candidates.every((candidate) => candidate.partNumbers.includes('10110989'))).toBe(true);
    expect(candidates.every((candidate) => [...candidate.productIds].includes('gid://shopify/Product/9159375421739'))).toBe(true);
  });
});
