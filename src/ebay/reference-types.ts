export type EbayReferenceCacheStatus =
  | 'MATCHED_LIVE_REFERENCE'
  | 'NO_EXACT_MATCH'
  | 'PRIVATE_REFERENCE_ARCHIVE'
  | 'RIGHTS_CLEARED_ARCHIVE';

export interface EbayReferenceImage {
  url: string;
  alt: string;
  contributorCredit?: string;
  contentReview?: {
    decision: 'ACCEPT_PART_ONLY' | 'REJECT' | 'QUARANTINE';
    method: 'MANUAL_EXACT_LISTING_REVIEW' | 'AUTOMATED_VISUAL_REVIEW';
    containsPerson: boolean;
    containsFace: boolean;
    containsHand: boolean;
    containsBodyPart: boolean;
    containsMarketplacePromo: boolean;
    containsWatermarkOrOverlay: boolean;
    checkedAt: string;
  };
}

/**
 * Marketplace media remains excluded from listing payloads. Permanent records
 * distinguish personal-use reference archives from separately rights-cleared
 * media so the UI never overstates the permission basis.
 */
export interface EbayReferenceCacheRecord {
  partNumber: string;
  status: EbayReferenceCacheStatus;
  source: 'EBAY_BROWSE_API' | 'PARTQUILL_PRIVATE_ARCHIVE' | 'PARTQUILL_RIGHTS_CLEARED';
  rightsState: 'EBAY_PUBLIC_REFERENCE_ONLY' | 'PRIVATE_PERSONAL_REFERENCE_ONLY' | 'RIGHTS_CLEARED';
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
  archiveState?: 'PRIVATE_PERSONAL_REFERENCE_ONLY';
}

export type EbayReferenceLookup =
  | {
      status: 'MATCHED_LIVE_REFERENCE' | 'PRIVATE_REFERENCE_ARCHIVE' | 'RIGHTS_CLEARED_ARCHIVE';
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
