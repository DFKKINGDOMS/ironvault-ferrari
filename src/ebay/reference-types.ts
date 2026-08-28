export type EbayReferenceCacheStatus =
  | 'MATCHED_LIVE_REFERENCE'
  | 'NO_EXACT_MATCH'
  | 'RIGHTS_CLEARED_ARCHIVE';

export interface EbayReferenceImage {
  url: string;
  alt: string;
}

/**
 * eBay listing media is reference-only and short-lived. A record can become a
 * durable archive only after a separate rights review has replaced the eBay
 * URLs with PartQuill-owned media URLs.
 */
export interface EbayReferenceCacheRecord {
  partNumber: string;
  status: EbayReferenceCacheStatus;
  source: 'EBAY_BROWSE_API' | 'PARTQUILL_RIGHTS_CLEARED';
  rightsState: 'EBAY_PUBLIC_REFERENCE_ONLY' | 'RIGHTS_CLEARED';
  sourceItemId: string | null;
  sourceUrl: string | null;
  title: string | null;
  categoryId: string | null;
  categoryPath: string | null;
  images: EbayReferenceImage[];
  matchEvidence: string[];
  checkedAt: string;
  expiresAt: string | null;
  retryAfter: string | null;
  archiveAllowed: boolean;
  listingPayloadEligible: false;
}

export interface EbayReferenceCandidate {
  sourceItemId: string;
  sourceUrl: string;
  title: string;
  categoryId: string | null;
  categoryPath: string | null;
  images: EbayReferenceImage[];
  matchEvidence: string[];
}

export type EbayReferenceLookup =
  | {
      status: 'MATCHED_LIVE_REFERENCE' | 'RIGHTS_CLEARED_ARCHIVE';
      reference: EbayReferenceCacheRecord;
      searchSuppressed: boolean;
    }
  | {
      status: 'NO_EXACT_MATCH';
      reference: EbayReferenceCacheRecord;
      searchSuppressed: boolean;
    }
  | {
      status: 'DISCOVERY_DISABLED' | 'TEMPORARILY_UNAVAILABLE' | 'NOT_CATALOG_VERIFIED';
      reference: null;
      searchSuppressed: boolean;
    };
