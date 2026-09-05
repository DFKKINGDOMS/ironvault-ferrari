import { DomainError } from './errors.js';
import type { ApprovalRecord, ItemRecord, ListingRecord } from './types.js';

export function hasCurrentApproval(
  item: ItemRecord,
  approvals: ApprovalRecord[],
  stage: ApprovalRecord['stage'],
  feeEstimateId?: string
): boolean {
  return approvals.some((approval) =>
    approval.itemId === item.id && approval.stage === stage &&
    approval.payloadHash === item.payloadHash && approval.payloadVersion === item.payloadVersion &&
    (stage !== 'PUBLIC' || (Boolean(feeEstimateId) && approval.feeEstimateId === feeEstimateId))
  );
}

export function requireCurrentPreflight(item: ItemRecord, approvals: ApprovalRecord[]): void {
  if (!hasCurrentApproval(item, approvals, 'PREFLIGHT')) {
    throw new DomainError('Review and approve this payload version before staging.', 'PREFLIGHT_APPROVAL_REQUIRED');
  }
}

export function requireCurrentStage(item: ItemRecord, listing: ListingRecord | undefined): asserts listing is ListingRecord {
  if (!listing || listing.status !== 'STAGED' || listing.itemId !== item.id || listing.sellerId !== item.sellerId) {
    throw new DomainError('A staged offer for this item is required.', 'STAGED_OFFER_REQUIRED');
  }
  if (listing.lastApprovedPayloadHash !== item.payloadHash) {
    throw new DomainError('The payload changed. Repeat preflight and stage the reviewed payload.', 'PAYLOAD_HASH_MISMATCH');
  }
  if (listing.stagedPayloadVersion !== item.payloadVersion) {
    throw new DomainError('Stage this payload version again; prior or unversioned offers cannot be approved.', 'STAGED_PAYLOAD_VERSION_MISMATCH');
  }
}

export function requireFreshFee(listing: ListingRecord, mode: 'mock' | 'live'): void {
  const fee = listing.feeEstimate;
  if (!fee || typeof fee.id !== 'string' || !fee.id.trim() || fee.id.length > 200 ||
      fee.source !== (mode === 'mock' ? 'MOCK' : 'EBAY_RESPONSE')) {
    throw new DomainError('A usable fee estimate is unavailable. Refresh fees before public approval.', 'FEE_ESTIMATE_UNAVAILABLE');
  }
  if (typeof fee.amount !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(fee.amount) ||
      !Number.isFinite(Number(fee.amount)) || fee.currency !== 'USD') {
    throw new DomainError('The USD fee amount is missing or invalid. Refresh fees before public approval.', 'FEE_ESTIMATE_INVALID');
  }
  const expiresAt = typeof fee.expiresAt === 'string' ? Date.parse(fee.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt)) {
    throw new DomainError('Fee expiry is invalid. Refresh fees before public approval.', 'FEE_ESTIMATE_INVALID');
  }
  if (expiresAt <= Date.now()) {
    throw new DomainError('Fees expired. Refresh fees, review them and approve publicly again.', 'FEE_ESTIMATE_EXPIRED');
  }
}
