export type CommunitySubmissionStatus =
  | 'SCREENING'
  | 'PENDING_HUMAN_REVIEW'
  | 'PROCESSING'
  | 'READY_FOR_ARCHIVE'
  | 'PUBLISHED'
  | 'PARTIALLY_PUBLISHED'
  | 'REJECTED'
  | 'FAILED';

export type CommunityImageStatus =
  | 'QUARANTINED'
  | 'AWAITING_AUTOMATED_REVIEW'
  | 'PENDING_HUMAN_REVIEW'
  | 'APPROVED_FOR_EDIT'
  | 'AWAITING_CHATGPT_EDIT'
  | 'EDITING'
  | 'PENDING_DERIVATIVE_REVIEW'
  | 'READY_FOR_ARCHIVE'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'FAILED';

export interface CommunityModerationResult {
  decision: 'ACCEPT_PART_ONLY' | 'REJECT' | 'UNAVAILABLE';
  containsPerson: boolean;
  containsFace: boolean;
  containsHand: boolean;
  containsBodyPart: boolean;
  containsPromotionalGraphic: boolean;
  containsWatermarkOrOverlay: boolean;
  containsExplicitOrIllegalContent: boolean;
  unrelatedToAutomotiveOrMachineryPart: boolean;
  visiblePartNumberConflict: boolean;
  visiblePartNumber: string | null;
  reason: string;
  model: string;
  checkedAt: string;
}

export interface CommunitySubmissionRecord {
  id: string;
  contributorCredit: string;
  statusTokenHash: string;
  status: CommunitySubmissionStatus;
  imageCount: number;
  acceptedCount: number;
  rejectedCount: number;
  termsVersion: '2026-08-28';
  ownershipConfirmed: true;
  licenseConfirmed: true;
  contentRulesConfirmed: true;
  attestationFingerprint: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  archiveCommitSha?: string;
  error?: string;
}

export interface CommunityImageRecord {
  id: string;
  submissionId: string;
  order: number;
  partNumber: string;
  sourceFilename: string;
  sourceMediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  sourceSha256: string;
  sourceByteLength: number;
  visualHash: string;
  status: CommunityImageStatus;
  moderation?: CommunityModerationResult;
  humanReview?: {
    decision: 'APPROVE' | 'REJECT';
    reviewer: string;
    note: string;
    reviewedAt: string;
  };
  derivativeMediaType?: 'image/png';
  derivativeSha256?: string;
  derivativeByteLength?: number;
  archiveFilename?: string;
  archivePath?: string;
  qa?: { passed: boolean; reason: string; model: string };
  editMethod?: 'CHATGPT_INTERNAL' | 'CONFIGURED_PROVIDER';
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  error?: string;
  /** Added by published-image queries; never copied from an upload field. */
  contributorCredit?: string;
}

export interface StoredCommunityImage extends CommunityImageRecord {
  sourceBytes: Uint8Array;
  derivativeBytes?: Uint8Array;
}

export interface CommunitySourceUpload {
  filename: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  partNumber: string;
  bytes: Uint8Array;
}

export interface CommunityModerationEngine {
  readonly available: boolean;
  review(input: { bytes: Uint8Array; mediaType: string; partNumber: string }): Promise<CommunityModerationResult>;
}

export interface CommunityArchivePublisher {
  readonly available: boolean;
  publish(input: {
    submissionId: string;
    contributorCredit: string;
    files: Array<{ path: string; bytes: Uint8Array }>;
  }): Promise<{ commitSha: string }>;
}
