export type EpcBrand = 'FERRARI' | 'LAMBORGHINI' | 'ASTON_MARTIN' | 'OTHER';
export type EpcJobStatus = 'AWAITING_ACTIVATION' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'REVIEW_REQUIRED' | 'FAILED' | 'BLOCKED';
export type EpcWatermarkStatus = 'NONE' | 'OWNED_OR_AUTHORIZED' | 'SUSPECTED_THIRD_PARTY';
export type EpcArtifactKind = 'source' | 'clean-base' | 'interactive' | 'thumbnail' | 'callout-map';

export interface EpcSourceCallout {
  ref: string;
  x: number;
  y: number;
  radius?: number;
  sku?: string;
}

export interface EpcRenderedCallout extends EpcSourceCallout {
  outputX: number;
  outputY: number;
  outputRadius: number;
}

export interface EpcQaResult {
  passed: boolean;
  reason: string;
  model: string;
}

export interface EpcQaEngine {
  readonly available: boolean;
  compare(source: Uint8Array, cleanBase: Uint8Array, interactive: Uint8Array, calloutCount: number): Promise<EpcQaResult>;
}

export interface EpcJobRecord {
  id: string;
  brand: EpcBrand;
  diagramId: string;
  status: EpcJobStatus;
  rightsConfirmed: boolean;
  watermarkStatus: EpcWatermarkStatus;
  imageRuleVersion: 'eurospares-clean-epc-v1.0';
  canonicalReferenceSha256: 'a5ccd78f88e8992bdbcfe26581fd533d19efbb3ee8da1f7b53a89cebcda7be8b';
  sourceFilename: string;
  sourceMediaType: string;
  sourceSha256: string;
  sourceImagePath: string;
  cleanBaseImagePath?: string;
  interactiveImagePath?: string;
  thumbnailImagePath?: string;
  calloutMapPath?: string;
  cleanBaseSha256?: string;
  interactiveSha256?: string;
  thumbnailSha256?: string;
  diagramSha256?: string;
  callouts: EpcRenderedCallout[];
  lineThreshold: number;
  qa?: EpcQaResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface EpcRenderResult {
  cleanBase: Uint8Array;
  interactive: Uint8Array;
  thumbnail: Uint8Array;
  calloutMap: Uint8Array;
  callouts: EpcRenderedCallout[];
}
