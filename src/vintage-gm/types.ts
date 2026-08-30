import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import type { GmCatalogMappingState } from '../catalog/gm-catalog-quality.js';

export const VINTAGE_GM_BRANDS = [
  'GM NA',
  'GM FACTORY MOTOR PARTS',
  'GM DIRECT ACCOUNTS'
] as const;

export type VintageGmNormalizationState =
  | 'NORMALIZED_EXACT_KEY'
  | 'REJECTED_SCIENTIFIC_NOTATION'
  | 'REJECTED_EMPTY_SKU'
  | 'REJECTED_NO_DIGIT';

export interface VintageGmInventoryRecord {
  sourceRow: number;
  productName: string;
  sku: string;
  partNumber: string | null;
  brand: string;
  description: string;
  quantity: number;
  sourcePrice: string;
  sourceWeight: string;
  normalizationState: VintageGmNormalizationState;
  normalizationIssue: string | null;
}

export interface VintageGmImportOptions {
  datasetId: string;
  sourceSha256: string;
  sourceFileName: string;
  sourceTotalRows: number;
  expectedGmRows: number;
  complete?: boolean;
}

export interface VintageGmDatasetStatus {
  datasetId: string | null;
  status: 'not_started' | 'running' | 'completed' | 'failed';
  active: boolean;
  sourceSha256: string | null;
  sourceFileName: string | null;
  sourceTotalRows: number;
  expectedGmRows: number;
  importedRows: number;
  normalizedRows: number;
  rejectedRows: number;
  distinctPartNumbers: number;
  catalogKeyMatches: number;
  completedAt: string | null;
  updatedAt: string | null;
}

export interface VintageGmCatalogInventory {
  partNumber: string;
  productName: string;
  sku: string;
  brands: string[];
  descriptions: string[];
  quantity: number;
  sourcePriceMin: string;
  sourcePriceMax: string;
  sourceWeightMin: string;
  sourceWeightMax: string;
  sourceRows: number[];
  recordCount: number;
}

export interface VintageGmCatalogMatch {
  inventory: VintageGmCatalogInventory;
  catalog: GmCatalogPart;
}

export interface VintageGmCatalogMatchPool {
  dataset: VintageGmDatasetStatus | null;
  matches: VintageGmCatalogMatch[];
}

export type VintageGmShortlistStatus =
  | 'READY'
  | 'PARTIAL'
  | 'DATA_NOT_LOADED'
  | 'NO_EXACT_MATCHES';

export interface VintageGmShortlistCandidate {
  rank: number;
  partNumber: string;
  inventory: {
    brands: string[];
    description: string;
    alternateDescriptions: string[];
    quantity: number;
    sourcePriceMin: string;
    sourcePriceMax: string;
    sourceWeightMin: string;
    sourceWeightMax: string;
    sourceRows: number[];
    recordCount: number;
    scarcityBand: 'ONE_IN_SOURCE' | 'LOW_SOURCE_STOCK' | 'AVAILABLE_SOURCE_STOCK';
  };
  catalog: {
    manufacturer: string;
    productType: string;
    description: string;
    identityState: 'CATALOG_AND_INVENTORY_ALIGNED' | 'INVENTORY_IDENTITY_HELD_FOR_CALLOUT';
    divisions: string[];
    catalogGroup: string | null;
    mappingState: Extract<GmCatalogMappingState, 'CURATED_EXACT' | 'CATALOG_LINKED_EXACT' | 'CATALOG_STATED_EXACT'>;
    sourcePages: number[];
    occurrenceCount: number;
    pageCount: number;
    applicationCount: number;
    evidenceViewUrl: string | null;
    category: {
      state: 'EBAY_TAXONOMY_VERIFIED' | 'EBAY_OFFICIAL_LEAF_REQUIRES_REVIEW' | 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION' | 'NOT_CLASSIFIED';
      categoryId: string | null;
      categoryName: string | null;
      categoryPath: string | null;
    };
  };
  listing: {
    state: 'DRAFT_CANDIDATE_REVIEW_REQUIRED';
    suggestedTitle: string;
    reviewCommand: string;
    reviewRequirements: string[];
  };
}

export interface VintageGmShortlist {
  schemaVersion: '2026-08-30';
  kind: 'VINTAGE_GM_SHORTLIST';
  status: VintageGmShortlistStatus;
  command: string;
  requestedCount: number;
  returnedCount: number;
  dataset: VintageGmDatasetStatus | null;
  candidates: VintageGmShortlistCandidate[];
  ranking: {
    label: 'Vintage source-inventory scarcity + exact GM catalog evidence';
    marketRarityClaimed: false;
    ebayMarketDataUsed: false;
    explanation: string;
  };
  gates: {
    actualItemPhotoRequired: true;
    conditionConfirmationRequired: true;
    categoryReviewRequired: true;
    publicEbayWrite: 'DISABLED';
  };
  noExternalRequestMade: true;
}
