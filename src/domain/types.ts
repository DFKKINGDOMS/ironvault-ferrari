export type Id = string;

export type EvidenceState =
  | 'EBAY_CATALOG_MATCH'
  | 'EBAY_COMPATIBILITY'
  | 'SELLER_CONFIRMED'
  | 'MEASURED'
  | 'IMAGE_CANDIDATE'
  | 'FITMENT_NOT_VERIFIED'
  | 'CONFLICTING_EVIDENCE'
  | 'BLOCKED'
  | 'AUTHORIZATION_REQUIRED'
  | 'REMOTE_CHANGE_DETECTED'
  | 'COMPATIBILITY_REOPENED';

export type ItemStatus =
  | 'CAPTURED'
  | 'HELD'
  | 'READY_FOR_PREFLIGHT'
  | 'PREFLIGHT_APPROVED'
  | 'READY_FOR_PUBLIC_APPROVAL'
  | 'PUBLIC_APPROVED'
  | 'PUBLISHED'
  | 'WITHDRAWN'
  | 'BLOCKED';

export type InventoryAuthority = 'partquill_master' | 'shopify_master' | 'erp_dms_master' | 'manual_ebay';

export interface EvidenceRecord {
  id: Id;
  itemId: Id;
  field: string;
  value: unknown;
  state: EvidenceState;
  source: string;
  sourceReference?: string;
  confidence?: number;
  createdBy: string;
  createdAt: string;
  supersedesId?: Id;
}

export interface ListingPayload {
  sku: string;
  title: string;
  description: string;
  condition: 'NEW' | 'USED' | 'REMANUFACTURED' | 'FOR_PARTS_OR_NOT_WORKING';
  categoryId: string;
  brand?: string;
  mpn?: string;
  gtin?: string;
  epid?: string;
  price: { currency: 'USD'; value: string };
  saleMode?: 'FIXED_PRICE' | 'GIVEAWAY';
  quantity: number;
  aspects: Record<string, string[]>;
  compatibility: Array<Record<string, string>>;
  shippingPolicyId?: string;
  paymentPolicyId?: string;
  returnPolicyId?: string;
  merchantLocationKey?: string;
  countryOfOrigin?: string;
  hsCode?: string;
  internationalEligible: boolean;
  imageIds: string[];
  core?: {
    amount: string;
    returnWindowDays: number;
    acceptableCriteria: string;
    includedInCheckoutTotal: boolean;
  };
}

export interface ItemRecord {
  id: Id;
  runId: Id;
  sellerId: Id;
  sku: string;
  status: ItemStatus;
  inventoryAuthority: InventoryAuthority;
  payload: ListingPayload;
  payloadHash: string;
  payloadVersion: number;
  exceptions: ExceptionRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ExceptionRecord {
  code: string;
  severity: 'HOLD' | 'BLOCK';
  field?: string;
  message: string;
  nextAction: string;
}

export interface ApprovalRecord {
  id: Id;
  itemId: Id;
  stage: 'PREFLIGHT' | 'PUBLIC';
  payloadHash: string;
  payloadVersion: number;
  feeEstimateId?: string;
  actorId: string;
  createdAt: string;
}

export interface ListingRecord {
  id: Id;
  itemId: Id;
  sellerId: Id;
  offerId: string;
  listingId?: string;
  status: 'STAGED' | 'PUBLISHED' | 'WITHDRAWN' | 'AUTHORIZATION_REQUIRED' | 'DRIFTED';
  feeEstimate?: {
    id: string;
    amount?: string;
    currency?: string;
    source: 'MOCK' | 'EBAY_RESPONSE' | 'UNAVAILABLE';
    expiresAt: string;
  };
  remoteSnapshot: unknown;
  lastApprovedPayloadHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: Id;
  sellerId: Id;
  itemId?: Id;
  actorId: string;
  action: string;
  outcome: 'SUCCEEDED' | 'REJECTED' | 'FAILED';
  payloadHash?: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface SellerConnection {
  sellerId: Id;
  ebayUserId?: string;
  tokenCiphertext?: string;
  scopes: string[];
  status: 'NOT_CONNECTED' | 'CONNECTED' | 'AUTHORIZATION_REQUIRED';
  updatedAt: string;
}

export interface SellerAcknowledgement {
  sellerId: Id;
  type: 'INVENTORY_API_OWNERSHIP_V1';
  version: 1;
  actorId: string;
  statement: string;
  createdAt: string;
}

export interface StoredImage {
  id: Id;
  sellerId: Id;
  itemId: Id;
  kind: 'ORIGINAL' | 'DETERMINISTIC_DERIVATIVE' | 'GENERATIVE_DERIVATIVE';
  sha256: string;
  mediaType: string;
  bytes: Uint8Array;
  originalImageId?: Id;
  rightsBasis: 'SELLER_PHOTOGRAPH' | 'BUSINESS_OWNED' | 'WRITTEN_PERMISSION';
  watermarkStatus: 'NONE' | 'SELLER_OWNED' | 'AUTHORIZED_SUPPLIER' | 'SUSPECTED_THIRD_PARTY';
  itemPixelsPreserved?: boolean;
  createdAt: string;
}
