import { describe, expect, it } from 'vitest';
import {
  acceptedReferenceImage,
  isBlockedReferenceImageBytes,
  isBlockedReferenceImageHash
} from '../src/ebay/reference-image-policy.js';

const cleanReview = {
  decision: 'ACCEPT_PART_ONLY' as const,
  method: 'MANUAL_EXACT_LISTING_REVIEW' as const,
  containsPerson: false,
  containsFace: false,
  containsHand: false,
  containsBodyPart: false,
  containsMarketplacePromo: false,
  containsWatermarkOrOverlay: false,
  checkedAt: '2026-08-28T11:30:00Z'
};

describe('marketplace reference image policy', () => {
  it('requires an explicit clean part-only review and blocks every human or promo signal', () => {
    expect(acceptedReferenceImage({ url: 'https://i.ebayimg.com/part.jpg', alt: 'part' })).toBe(false);
    expect(acceptedReferenceImage({ url: 'https://i.ebayimg.com/part.jpg', alt: 'part', contentReview: cleanReview })).toBe(true);
    for (const field of ['containsPerson', 'containsFace', 'containsHand', 'containsBodyPart', 'containsMarketplacePromo', 'containsWatermarkOrOverlay'] as const) {
      expect(acceptedReferenceImage({
        url: 'https://i.ebayimg.com/rejected.jpg',
        alt: 'part',
        contentReview: { ...cleanReview, [field]: true }
      })).toBe(false);
    }
    expect(acceptedReferenceImage({
      url: 'https://i.ebayimg.com/promo.jpg',
      alt: 'eBay Motors Guaranteed Fit',
      contentReview: cleanReview
    })).toBe(false);
  });

  it('hash-blocks the supplied eBay Motors promo exemplar', () => {
    expect(isBlockedReferenceImageHash('7066ca0b1c10244b4f78644af2d8ca932846ca3952448f7f2bb1e921571d4904')).toBe(true);
    const bytes = Buffer.from('not-the-real-promo');
    expect(isBlockedReferenceImageBytes(bytes)).toBe(false);
  });
});
