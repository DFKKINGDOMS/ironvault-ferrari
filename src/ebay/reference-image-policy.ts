import { createHash } from 'node:crypto';
import type { EbayReferenceImage } from './reference-types.js';

const blockedImageHashes = new Set([
  // eBay Motors / eBay Guaranteed Fit promotional creative supplied as the
  // canonical reject example on 2026-08-28.
  '7066ca0b1c10244b4f78644af2d8ca932846ca3952448f7f2bb1e921571d4904'
]);

const blockedMetadata = /\b(?:ebay\s*motors|ebay\s*guaranteed\s*fit|guaranteed\s*fit)\b/i;

export function acceptedReferenceImage(image: EbayReferenceImage): boolean {
  const review = image.contentReview;
  if (!review || review.decision !== 'ACCEPT_PART_ONLY') return false;
  if (blockedMetadata.test(image.alt)) return false;
  return !review.containsPerson
    && !review.containsFace
    && !review.containsHand
    && !review.containsBodyPart
    && !review.containsMarketplacePromo
    && !review.containsWatermarkOrOverlay;
}

export function isBlockedReferenceImageBytes(bytes: Buffer): boolean {
  return isBlockedReferenceImageHash(createHash('sha256').update(bytes).digest('hex'));
}

export function isBlockedReferenceImageHash(sha256: string): boolean {
  return blockedImageHashes.has(sha256.toLowerCase());
}
