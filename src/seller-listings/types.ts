import type { VintageGmInventoryQuestionIntent } from '../vintage-gm/types.js';

export type SellerListingNormalizationState =
  | 'NORMALIZED_EXACT_KEY'
  | 'REJECTED_EMPTY_SKU'
  | 'REJECTED_SCIENTIFIC_NOTATION'
  | 'REJECTED_NO_DIGIT';

export interface SellerListingRecord {
  sourceRow: number;
  sku: string;
  partNumber: string | null;
  title: string;
  availableQuantity: number;
  soldQuantity: number;
  currency: string;
  askingPrice: string;
  condition: string;
  normalizationState: SellerListingNormalizationState;
  normalizationIssue: string | null;
}

export interface SellerListingImportOptions {
  datasetId: string;
  sourceSha256: string;
  sourceFileName: string;
  snapshotDate: string;
  sourceTotalRows: number;
  expectedRows: number;
  complete?: boolean;
}

export interface SellerListingDatasetStatus {
  datasetId: string | null;
  status: 'not_started' | 'running' | 'completed' | 'failed';
  active: boolean;
  sourceSha256: string | null;
  sourceFileName: string | null;
  snapshotDate: string | null;
  sourceTotalRows: number;
  expectedRows: number;
  importedRows: number;
  normalizedRows: number;
  rejectedRows: number;
  distinctPartNumbers: number;
  completedAt: string | null;
  updatedAt: string | null;
}

export interface SellerListingCandidate {
  partNumber: string;
  sku: string;
  title: string;
  listedQuantity: number;
  soldQuantity: number;
  currency: string;
  askingPrice: string;
  condition: string;
  snapshotDate: string;
  evidenceState: 'SELLER_AUTHORED_LISTING';
  physicalInventoryVerified: false;
  identityVerified: false;
  fitmentVerified: false;
}

export interface SellerListingQueryPool {
  dataset: SellerListingDatasetStatus | null;
  candidates: SellerListingCandidate[];
  truncated: boolean;
}

export const MAX_SELLER_LISTING_CANDIDATES = 100;

function normalizedWords(value: string): string[] {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function containsWholePhrase(haystack: string, value: string): boolean {
  const normalized = ` ${normalizedWords(haystack).join(' ')} `;
  const phrase = normalizedWords(value).join(' ');
  return Boolean(phrase) && normalized.includes(` ${phrase} `);
}

/**
 * Seller-authored listing text can select review candidates, but this match must
 * never be promoted to catalog identity, fitment, or physical inventory proof.
 */
export function matchesSellerListingIntent(record: SellerListingRecord, intent: VintageGmInventoryQuestionIntent): boolean {
  if (!record.partNumber || record.availableQuantity <= 0) return false;
  if (intent.partNumber) return record.partNumber === intent.partNumber;
  if (intent.year && !containsWholePhrase(record.title, String(intent.year))) return false;
  if (intent.model && !containsWholePhrase(record.title, intent.model)) return false;
  if (intent.make && !intent.model && !containsWholePhrase(record.title, intent.make)) return false;
  if (intent.partSearchGroups.length && intent.partSearchGroups.some((group) =>
    !group.some((alternative) => containsWholePhrase(record.title, alternative))
  )) return false;
  return Boolean(intent.year || intent.make || intent.model || intent.partQuery);
}
