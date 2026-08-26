export type StudioBackground = 'PURE_WHITE' | 'TRANSPARENT' | 'SOFT_GRAY';

export type StudioWatermarkStatus = 'NONE' | 'OWNED_OR_AUTHORIZED' | 'SUSPECTED_THIRD_PARTY';

export type StudioJobStatus =
  | 'AWAITING_ACTIVATION'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'REVIEW_REQUIRED'
  | 'FAILED'
  | 'BLOCKED';

export type StudioImageStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'REVIEW_REQUIRED' | 'FAILED';

export type StudioRoute = 'HERO_PREMIUM' | 'SECONDARY_ECONOMY' | 'QA_ESCALATION';

export interface StudioQuote {
  imageCount: number;
  customerPriceUsd: string;
  estimatedDirectCostUsd: string;
  estimatedGrossMarginUsd: string;
  estimatedGrossMarginPercent: number;
  includes: {
    heroPremiumImages: number;
    economyHighFidelityImages: number;
    qaComparisons: number;
    retryReservePercent: number;
  };
  pricingVersion: string;
  caveat: string;
}

export interface StudioSourceUpload {
  filename: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
}

export interface StudioImageRecord {
  id: string;
  order: number;
  isPrimary: boolean;
  filename: string;
  mediaType: string;
  sha256: string;
  byteLength: number;
  originalPath: string;
  resultPath?: string;
  resultMediaType?: string;
  resultSha256?: string;
  route?: StudioRoute;
  attempts: number;
  status: StudioImageStatus;
  qa?: {
    passed: boolean;
    reason: string;
    model: string;
  };
  error?: string;
}

export interface StudioJobRecord {
  id: string;
  sellerId: string;
  status: StudioJobStatus;
  background: StudioBackground;
  rightsConfirmed: boolean;
  watermarkStatus: StudioWatermarkStatus;
  originalRetention: 'IMMUTABLE';
  imageCount: number;
  quote: StudioQuote;
  images: StudioImageRecord[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
}

export interface EditRequest {
  source: Uint8Array;
  mediaType: string;
  filename: string;
  route: StudioRoute;
  background: StudioBackground;
  watermarkStatus: StudioWatermarkStatus;
}

export interface EditResult {
  bytes: Uint8Array;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  model: string;
  quality: string;
}

export interface QaResult {
  passed: boolean;
  reason: string;
  model: string;
}

export interface ImageEditEngine {
  readonly available: boolean;
  edit(input: EditRequest): Promise<EditResult>;
  compare(source: Uint8Array, sourceMediaType: string, candidate: EditResult): Promise<QaResult>;
}
