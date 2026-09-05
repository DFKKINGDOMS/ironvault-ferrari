export const SHOPIFY_MEDIA_JOB_ID = 'shopify-media-v1';
export const SHOPIFY_MEDIA_PROFILE = 'ferrari-product-photo-v1';
export const SHOPIFY_MEDIA_SOURCE_STORE = 'Import Export Auto Parts Inc';
export const SHOPIFY_MEDIA_SOURCE_DOMAIN = 'discontinued-auto-parts.myshopify.com';
export const SHOPIFY_MEDIA_PUBLIC_SOURCE = 'Authorized merchant archive';

export type ShopifyMediaSource = 'SHOPIFY_PRODUCT_MEDIA' | 'SHOPIFY_CONTENT_FILE_EXACT_KEY';

export interface ShopifyMediaQaEvidence {
  status: 'PASSED';
  profile: typeof SHOPIFY_MEDIA_PROFILE;
  classifierModel: string;
  comparisonModel: string;
  editModel: string;
  reason: string;
  checkedAt: string;
  output: {
    width: 2000;
    height: 2000;
    mediaType: 'image/jpeg';
    colorSpace: 'srgb';
    metadataStripped: true;
    background: '#FFFFFF';
  };
}

export interface ShopifyMediaAssetRecord {
  id: string;
  source: ShopifyMediaSource;
  sourceStore: string;
  shopifyFileId: string;
  shopifyProductId?: string;
  shopifyMediaId?: string;
  filename: string;
  alt: string | null;
  partNumbers: string[];
  sourceUrl: string;
  sourceSha256: string;
  originalPath: string;
  derivativePath: string;
  derivativeSha256: string;
  width: number;
  height: number;
  qa: ShopifyMediaQaEvidence;
  createdAt: string;
  updatedAt: string;
}

export interface ShopifyPartMediaIndex {
  id: string;
  schemaVersion: 1;
  partNumber: string;
  sourceStore: string;
  profile: typeof SHOPIFY_MEDIA_PROFILE;
  assets: ShopifyMediaAssetRecord[];
  updatedAt: string;
}

export interface PublicShopifyMediaAsset {
  id: string;
  filename: string;
  alt: string;
  width: number;
  height: number;
  viewUrl: string;
  source: ShopifyMediaSource;
  rightsState: 'MERCHANT_OWNED_OR_AUTHORIZED';
  mappingState: 'EXACT_SHOPIFY_SKU' | 'EXACT_FILE_KEY';
  qaState: 'FERRARI_RULES_PASSED';
  sourceSha256: string;
  derivativeSha256: string;
  requiresActualItemConfirmation: true;
}

export interface PublicShopifyMediaMatch {
  partNumber: string;
  sourceStore: typeof SHOPIFY_MEDIA_PUBLIC_SOURCE;
  assets: PublicShopifyMediaAsset[];
  updatedAt: string;
}

export interface ShopifyMediaPipelineStatus {
  id: typeof SHOPIFY_MEDIA_JOB_ID;
  schemaVersion: 1;
  sourceStore: string;
  phase: 'AWAITING_EXPORT' | 'CANARY' | 'PROCESSING' | 'COMPLETE' | 'CONFIGURATION_HOLD';
  canaryPartNumber: string;
  canaryPassed: boolean;
  exportOperationId?: string;
  exportObjectCount?: number;
  discovered: number;
  processed: number;
  passed: number;
  duplicates: number;
  quarantinedLogos: number;
  quarantinedNonProduct: number;
  unmapped: number;
  retrying: number;
  held: number;
  lastError?: string;
  updatedAt: string;
}

export type PublicShopifyMediaPipelineStatus = Omit<
  ShopifyMediaPipelineStatus,
  'sourceStore' | 'exportOperationId' | 'lastError'
> & {
  sourceStore: typeof SHOPIFY_MEDIA_PUBLIC_SOURCE;
  configurationBlocked: boolean;
};
