import { describe, expect, it } from 'vitest';
import { canonicalShopifyUrl, exactMediaPartNumbers, isTextQuarantined, mediaFilename } from '../src/shopify-media/policy.js';

describe('Shopify merchant-media policy', () => {
  it('maps an exact single product SKU without guessing from descriptive text', () => {
    expect(exactMediaPartNumbers({
      filename: 'front-angle.jpg',
      alt: 'New OEM Corvette cruise control hose',
      productSkus: ['10110989']
    })).toEqual(['10110989']);
    expect(exactMediaPartNumbers({
      filename: 'front-angle.jpg',
      alt: 'Fits a 1991 Corvette',
      productSkus: []
    })).toEqual([]);
  });

  it('accepts a strict file key and refuses ambiguous multi-SKU associations', () => {
    expect(exactMediaPartNumbers({ filename: '10110989-front-01.jpg' })).toEqual(['10110989']);
    expect(exactMediaPartNumbers({
      filename: 'product-photo.jpg',
      alt: 'Product image',
      productSkus: ['10110989', '10110990']
    })).toEqual([]);
    expect(exactMediaPartNumbers({
      filename: 'product-photo.jpg',
      productSkus: ['X'.repeat(100)]
    })).toEqual([]);
  });

  it('quarantines explicit store logos but not a product photo whose alt text names the store', () => {
    expect(isTextQuarantined('import-export-auto-parts-logo.png', null)).toBe(true);
    expect(isTextQuarantined('10110989.jpg', 'Import Export Auto Parts Inc product photo')).toBe(false);
    expect(isTextQuarantined('payment-trust-badge.png', null)).toBe(true);
  });

  it('allows only canonical Shopify CDN media URLs', () => {
    expect(canonicalShopifyUrl('https://cdn.shopify.com/s/files/1/0719/9575/2747/files/10110989.jpg?v=123'))
      .toBe('https://cdn.shopify.com/s/files/1/0719/9575/2747/files/10110989.jpg');
    expect(mediaFilename('https://cdn.shopify.com/s/files/1/0719/9575/2747/files/10110989.jpg?v=123')).toBe('10110989.jpg');
    expect(canonicalShopifyUrl('https://example.com/10110989.jpg')).toBeNull();
  });
});
