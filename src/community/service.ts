import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import { DomainError } from '../domain/errors.js';
import { referenceAssetFilename } from '../ebay/reference-assets.js';
import type { EbayReferenceCacheRecord, EbayReferenceImage } from '../ebay/reference-types.js';
import type { ImageEditEngine } from '../image-studio/types.js';
import type { Store } from '../store/store.js';
import { buildConnectedImagePrompt } from '../mcp/prompt.js';
import type {
  CommunityArchivePublisher,
  CommunityImageRecord,
  CommunityModerationEngine,
  CommunitySourceUpload,
  CommunitySubmissionRecord,
  StoredCommunityImage
} from './types.js';

const SUPPORTED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const MAX_PIXELS = 60_000_000;

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function cleanCredit(value: string): string {
  return value.replace(/[<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function hamming(left: string, right: string): number {
  const a = BigInt(`0x${left}`);
  const b = BigInt(`0x${right}`);
  let value = a ^ b;
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

async function visualHash(bytes: Uint8Array): Promise<string> {
  const { data, info } = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== 9 || info.height !== 8) throw new Error('image fingerprint failed');
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits = (bits << 1n) | BigInt(data[y * 9 + x]! > data[y * 9 + x + 1]! ? 1 : 0);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

export interface CreateCommunitySubmissionInput {
  contributorCredit: string;
  ownershipConfirmed: boolean;
  licenseConfirmed: boolean;
  contentRulesConfirmed: boolean;
  attestationFingerprint: string;
  files: CommunitySourceUpload[];
}

export interface CommunityImageServiceOptions {
  editMode?: 'chatgpt-manual' | 'provider';
  handoffSecret?: string;
}

export interface ChatGptHandoff {
  token: string;
  jobCode: string;
  imageId: string;
  partNumber: string;
  sourceFilename: string;
  sourceSha256: string;
  protectedPrompt: string;
  expiresAt: string;
}

export class CommunityImageService {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly moderator: CommunityModerationEngine,
    private readonly editor: ImageEditEngine,
    private readonly archive: CommunityArchivePublisher,
    readonly maxImages = 50,
    private readonly autoStart = true,
    private readonly options: CommunityImageServiceOptions = {}
  ) {}

  get activated(): boolean { return this.moderator.available && this.editor.available; }
  get automatedReviewActive(): boolean { return this.moderator.available; }
  get editMode(): 'chatgpt-manual' | 'provider' { return this.options.editMode ?? 'provider'; }
  get chatGptManualActive(): boolean { return this.editMode === 'chatgpt-manual' && Boolean(this.options.handoffSecret); }
  get archiveActivated(): boolean { return this.archive.available; }

  async createSubmission(input: CreateCommunitySubmissionInput): Promise<{ submission: CommunitySubmissionRecord; statusToken: string }> {
    if (!input.ownershipConfirmed || !input.licenseConfirmed || !input.contentRulesConfirmed) {
      throw new DomainError('ownership, archive license and content rules must all be confirmed', 'COMMUNITY_RIGHTS_REQUIRED', 409);
    }
    const contributorCredit = cleanCredit(input.contributorCredit);
    if (contributorCredit.length < 2) throw new DomainError('enter the public contributor credit name', 'CONTRIBUTOR_CREDIT_REQUIRED', 400);
    if (!input.files.length || input.files.length > this.maxImages) {
      throw new DomainError(`upload between 1 and ${this.maxImages} images`, 'COMMUNITY_IMAGE_COUNT_INVALID', 400);
    }
    if (input.files.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_BATCH_BYTES) {
      throw new DomainError('the complete contribution must be 100 MB or less', 'COMMUNITY_BATCH_TOO_LARGE', 413);
    }

    const prepared: Array<CommunitySourceUpload & { partNumber: string; sourceSha256: string; visualHash: string }> = [];
    const exactHashes = new Set<string>();
    for (const file of input.files) {
      if (!SUPPORTED_MEDIA.has(file.mediaType)) throw new DomainError('only JPEG, PNG and WebP images are accepted', 'COMMUNITY_IMAGE_TYPE_UNSUPPORTED', 400);
      if (!file.bytes.length || file.bytes.length > MAX_FILE_BYTES) throw new DomainError('each image must be 12 MB or less', 'COMMUNITY_IMAGE_SIZE_INVALID', 400);
      const partNumber = canonicalOemPartNumber(file.partNumber);
      if (!partNumber || partNumber.length > 64) throw new DomainError('every image must have an exact part number', 'COMMUNITY_PART_NUMBER_REQUIRED', 400);
      try {
        const metadata = await sharp(file.bytes, { limitInputPixels: MAX_PIXELS }).metadata();
        if (!metadata.width || !metadata.height) throw new Error('missing dimensions');
      } catch {
        throw new DomainError(`${file.filename} is not a valid supported image`, 'COMMUNITY_IMAGE_INVALID', 400);
      }
      const sourceSha256 = sha256(file.bytes);
      if (exactHashes.has(sourceSha256)) throw new DomainError('the same image was included more than once', 'COMMUNITY_DUPLICATE_IMAGE', 400);
      exactHashes.add(sourceSha256);
      prepared.push({ ...file, partNumber, sourceSha256, visualHash: await visualHash(file.bytes) });
    }
    for (let i = 0; i < prepared.length; i += 1) {
      for (let j = i + 1; j < prepared.length; j += 1) {
        if (prepared[i]!.partNumber === prepared[j]!.partNumber && hamming(prepared[i]!.visualHash, prepared[j]!.visualHash) <= 3) {
          throw new DomainError(`two ${prepared[i]!.partNumber} images appear to be the same view`, 'COMMUNITY_DUPLICATE_VIEW', 400);
        }
      }
    }

    const id = randomUUID();
    const statusToken = randomBytes(32).toString('base64url');
    const createdAt = new Date().toISOString();
    const submission: CommunitySubmissionRecord = {
      id,
      contributorCredit,
      statusTokenHash: sha256(statusToken),
      status: this.editMode === 'chatgpt-manual' ? 'PENDING_HUMAN_REVIEW' : 'SCREENING',
      imageCount: prepared.length,
      acceptedCount: 0,
      rejectedCount: 0,
      termsVersion: '2026-08-28',
      ownershipConfirmed: true,
      licenseConfirmed: true,
      contentRulesConfirmed: true,
      attestationFingerprint: sha256(input.attestationFingerprint),
      createdAt,
      updatedAt: createdAt
    };
    await this.store.saveCommunitySubmission(submission);
    for (const [order, file] of prepared.entries()) {
      await this.store.saveCommunityImage({
        id: randomUUID(), submissionId: id, order, partNumber: file.partNumber,
        sourceFilename: file.filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 180),
        sourceMediaType: file.mediaType, sourceSha256: file.sourceSha256,
        sourceByteLength: file.bytes.length, visualHash: file.visualHash,
        status: this.editMode === 'chatgpt-manual'
          ? 'PENDING_HUMAN_REVIEW'
          : this.moderator.available ? 'QUARANTINED' : 'AWAITING_AUTOMATED_REVIEW',
        sourceBytes: file.bytes, createdAt, updatedAt: createdAt
      });
    }
    if (this.autoStart) queueMicrotask(() => void this.screenSubmission(id));
    return { submission, statusToken };
  }

  async getPublicSubmission(id: string, statusToken: string): Promise<{ submission: Omit<CommunitySubmissionRecord, 'statusTokenHash' | 'attestationFingerprint'>; images: Array<Omit<CommunityImageRecord, 'humanReview'> & { credit: string }> }> {
    const submission = await this.requireSubmission(id);
    const supplied = Buffer.from(sha256(statusToken));
    const expected = Buffer.from(submission.statusTokenHash);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new DomainError('submission receipt is invalid', 'COMMUNITY_RECEIPT_INVALID', 401);
    const { statusTokenHash: _token, attestationFingerprint: _fingerprint, ...safe } = submission;
    const images = (await this.store.listCommunityImages(id)).map(({ sourceBytes: _source, derivativeBytes: _derivative, humanReview: _review, ...image }) => ({ ...image, credit: submission.contributorCredit }));
    return { submission: safe, images };
  }

  async screenSubmission(id: string): Promise<void> {
    if (!this.moderator.available || this.inFlight.has(`screen:${id}`)) return;
    this.inFlight.add(`screen:${id}`);
    try {
      const images = await this.store.listCommunityImages(id);
      for (const image of images.filter((row) => row.status === 'QUARANTINED' || row.status === 'AWAITING_AUTOMATED_REVIEW')) {
        try {
          const moderation = await this.moderator.review({ bytes: image.sourceBytes, mediaType: image.sourceMediaType, partNumber: image.partNumber });
          image.moderation = moderation;
          image.status = moderation.decision === 'ACCEPT_PART_ONLY' ? 'PENDING_HUMAN_REVIEW' : moderation.decision === 'REJECT' ? 'REJECTED' : 'AWAITING_AUTOMATED_REVIEW';
          image.error = moderation.decision === 'REJECT' ? moderation.reason : undefined;
        } catch (error) {
          image.status = 'AWAITING_AUTOMATED_REVIEW';
          image.error = error instanceof Error ? error.message.slice(0, 500) : 'automated review failed';
        }
        image.updatedAt = new Date().toISOString();
        await this.store.saveCommunityImage(image);
      }
      await this.refreshSubmission(id);
    } finally { this.inFlight.delete(`screen:${id}`); }
  }

  async listReviewQueue(limit = 100): Promise<Array<{ submission: CommunitySubmissionRecord; images: CommunityImageRecord[] }>> {
    const submissions = await this.store.listCommunitySubmissionsForReview(limit);
    return Promise.all(submissions.map(async (submission) => ({
      submission,
      images: (await this.store.listCommunityImages(submission.id)).map(({ sourceBytes: _source, derivativeBytes: _derivative, ...image }) => image)
    })));
  }

  async approveSubmission(
    id: string,
    reviewer: string,
    note = '',
    confirmations: { manualSafetyConfirmed?: boolean; partNumberMatchConfirmed?: boolean } = {}
  ): Promise<CommunitySubmissionRecord> {
    const images = await this.store.listCommunityImages(id);
    const reviewable = images.filter((image) => image.status === 'PENDING_HUMAN_REVIEW');
    if (!reviewable.length) throw new DomainError('no screened images are awaiting human approval', 'COMMUNITY_NOT_REVIEWABLE', 409);
    const requiresManualScreen = reviewable.some((image) => image.moderation?.decision !== 'ACCEPT_PART_ONLY');
    if (requiresManualScreen && (!confirmations.manualSafetyConfirmed || !confirmations.partNumberMatchConfirmed)) {
      throw new DomainError(
        'manual review must confirm the prohibited-content rules and exact part-number match',
        'COMMUNITY_MANUAL_REVIEW_CONFIRMATION_REQUIRED',
        409
      );
    }
    const reviewedAt = new Date().toISOString();
    for (const image of reviewable) {
      image.status = this.editMode === 'chatgpt-manual' ? 'AWAITING_CHATGPT_EDIT' : 'APPROVED_FOR_EDIT';
      image.editMethod = this.editMode === 'chatgpt-manual' ? 'CHATGPT_INTERNAL' : 'CONFIGURED_PROVIDER';
      image.humanReview = { decision: 'APPROVE', reviewer: reviewer.slice(0, 120), note: note.slice(0, 500), reviewedAt };
      image.error = undefined;
      image.updatedAt = reviewedAt;
      await this.store.saveCommunityImage(image);
    }
    await this.refreshSubmission(id);
    if (this.autoStart && this.editMode === 'provider') queueMicrotask(() => void this.processApproved(id));
    return this.requireSubmission(id);
  }

  async issueChatGptHandoff(imageId: string): Promise<ChatGptHandoff> {
    const image = await this.store.getCommunityImage(imageId);
    if (!image) throw new DomainError('community image not found', 'COMMUNITY_IMAGE_NOT_FOUND', 404);
    if (!this.chatGptManualActive || !this.options.handoffSecret) {
      throw new DomainError('ChatGPT handoff is not configured', 'COMMUNITY_CHATGPT_HANDOFF_UNAVAILABLE', 503);
    }
    if (image.status !== 'AWAITING_CHATGPT_EDIT') {
      throw new DomainError('image is not awaiting a ChatGPT edit', 'COMMUNITY_CHATGPT_HANDOFF_NOT_READY', 409);
    }
    const expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const payload = Buffer.from(JSON.stringify({ imageId, sourceSha256: image.sourceSha256, expiresAt })).toString('base64url');
    const signature = createHmac('sha256', this.options.handoffSecret).update(`community-chatgpt:${payload}`).digest('base64url');
    const jobCode = `PQ-W-${sha256(image.id).slice(0, 8).toUpperCase()}`;
    return {
      token: `${payload}.${signature}`,
      jobCode,
      imageId,
      partNumber: image.partNumber,
      sourceFilename: image.sourceFilename,
      sourceSha256: image.sourceSha256,
      protectedPrompt: buildConnectedImagePrompt(jobCode, [image.sourceFilename]),
      expiresAt
    };
  }

  async resolveChatGptHandoff(token: string): Promise<{ handoff: ChatGptHandoff; image: StoredCommunityImage }> {
    if (!this.options.handoffSecret) throw new DomainError('ChatGPT handoff is not configured', 'COMMUNITY_CHATGPT_HANDOFF_UNAVAILABLE', 503);
    const [payload, signature] = token.split('.');
    if (!payload || !signature) throw new DomainError('ChatGPT handoff code is invalid', 'COMMUNITY_CHATGPT_HANDOFF_INVALID', 401);
    const expected = createHmac('sha256', this.options.handoffSecret).update(`community-chatgpt:${payload}`).digest('base64url');
    const suppliedBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
      throw new DomainError('ChatGPT handoff code is invalid', 'COMMUNITY_CHATGPT_HANDOFF_INVALID', 401);
    }
    let claims: { imageId?: string; sourceSha256?: string; expiresAt?: string };
    try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof claims; }
    catch { throw new DomainError('ChatGPT handoff code is invalid', 'COMMUNITY_CHATGPT_HANDOFF_INVALID', 401); }
    if (!claims.imageId || !claims.sourceSha256 || !claims.expiresAt || Date.parse(claims.expiresAt) <= Date.now()) {
      throw new DomainError('ChatGPT handoff code expired or is invalid', 'COMMUNITY_CHATGPT_HANDOFF_EXPIRED', 401);
    }
    const image = await this.store.getCommunityImage(claims.imageId);
    if (!image || image.sourceSha256 !== claims.sourceSha256 || image.status !== 'AWAITING_CHATGPT_EDIT') {
      throw new DomainError('ChatGPT handoff is no longer valid', 'COMMUNITY_CHATGPT_HANDOFF_INVALID', 409);
    }
    const handoff = await this.issueChatGptHandoff(image.id);
    return { handoff: { ...handoff, token, expiresAt: claims.expiresAt }, image };
  }

  async acceptChatGptDerivative(token: string, candidate: Uint8Array): Promise<CommunityImageRecord> {
    const { image } = await this.resolveChatGptHandoff(token);
    if (!candidate.length || candidate.length > 20 * 1024 * 1024) {
      throw new DomainError('returned ChatGPT image must be 20 MB or less', 'COMMUNITY_CHATGPT_RESULT_SIZE_INVALID', 413);
    }
    let derivative: Buffer;
    try {
      const metadata = await sharp(candidate, { limitInputPixels: MAX_PIXELS }).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 800 || metadata.height < 800) {
        throw new Error('result resolution is below 800 pixels');
      }
      derivative = await sharp(candidate, { limitInputPixels: MAX_PIXELS }).rotate().png({ compressionLevel: 9 }).toBuffer();
    } catch (error) {
      throw new DomainError(
        error instanceof Error ? `returned ChatGPT image is invalid: ${error.message}` : 'returned ChatGPT image is invalid',
        'COMMUNITY_CHATGPT_RESULT_INVALID',
        400
      );
    }
    image.derivativeBytes = derivative;
    image.derivativeMediaType = 'image/png';
    image.derivativeSha256 = sha256(derivative);
    image.derivativeByteLength = derivative.length;
    image.editMethod = 'CHATGPT_INTERNAL';
    image.qa = { passed: false, reason: 'Awaiting mandatory human source-versus-result comparison.', model: 'chatgpt-internal' };
    image.status = 'PENDING_DERIVATIVE_REVIEW';
    image.error = undefined;
    image.updatedAt = new Date().toISOString();
    await this.store.saveCommunityImage(image);
    await this.refreshSubmission(image.submissionId);
    const { sourceBytes: _source, derivativeBytes: _derivative, ...safe } = image;
    return safe;
  }

  async approveChatGptDerivative(
    imageId: string,
    reviewer: string,
    note: string,
    confirmations: { sourceComparedConfirmed: boolean; contentRulesConfirmed: boolean }
  ): Promise<CommunityImageRecord> {
    const image = await this.store.getCommunityImage(imageId);
    if (!image) throw new DomainError('community image not found', 'COMMUNITY_IMAGE_NOT_FOUND', 404);
    if (image.status !== 'PENDING_DERIVATIVE_REVIEW' || !image.derivativeBytes) {
      throw new DomainError('image is not awaiting derivative review', 'COMMUNITY_DERIVATIVE_NOT_REVIEWABLE', 409);
    }
    if (!confirmations.sourceComparedConfirmed || !confirmations.contentRulesConfirmed) {
      throw new DomainError('source comparison and content rules must both be confirmed', 'COMMUNITY_DERIVATIVE_CONFIRMATION_REQUIRED', 409);
    }
    const resized = await sharp(image.derivativeBytes)
      .resize({ width: 1_600, height: 1_600, fit: 'contain', background: '#ffffff', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .png({ compressionLevel: 9 })
      .toBuffer({ resolveWithObject: true });
    const normalized = await sharp({ create: { width: 1_600, height: 1_600, channels: 3, background: '#ffffff' } })
      .composite([{
        input: resized.data,
        left: Math.floor((1_600 - resized.info.width) / 2),
        top: Math.floor((1_600 - resized.info.height) / 2)
      }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    image.derivativeBytes = normalized;
    image.derivativeSha256 = sha256(normalized);
    image.derivativeByteLength = normalized.length;
    const related = await this.store.listCommunityImagesByPartNumber(image.partNumber);
    const reserved = new Set(related.map((row) => row.archiveFilename).filter((value): value is string => Boolean(value)));
    let index = 0;
    let filename = referenceAssetFilename(image.partNumber, index);
    while (reserved.has(filename)) filename = referenceAssetFilename(image.partNumber, ++index);
    image.archiveFilename = filename;
    image.archivePath = `data/reference-assets/${filename}`;
    image.qa = {
      passed: true,
      reason: `${note.slice(0, 400) || 'Human reviewer confirmed exact source preservation and prohibited-content rules.'}`,
      model: `chatgpt-internal+human:${reviewer.slice(0, 80)}`
    };
    image.status = 'READY_FOR_ARCHIVE';
    image.updatedAt = new Date().toISOString();
    await this.store.saveCommunityImage(image);
    await this.publishReady(image.submissionId);
    const saved = await this.store.getCommunityImage(image.id);
    const { sourceBytes: _source, derivativeBytes: _derivative, ...safe } = saved!;
    return safe;
  }

  async readChatGptDerivative(imageId: string): Promise<{ bytes: Uint8Array; mediaType: 'image/png' }> {
    const image = await this.store.getCommunityImage(imageId);
    if (!image?.derivativeBytes) throw new DomainError('community derivative not found', 'COMMUNITY_DERIVATIVE_NOT_FOUND', 404);
    return { bytes: image.derivativeBytes, mediaType: 'image/png' };
  }

  async retryArchive(submissionId: string): Promise<CommunitySubmissionRecord> {
    await this.requireSubmission(submissionId);
    await this.publishReady(submissionId);
    return this.requireSubmission(submissionId);
  }

  async rejectImage(id: string, reviewer: string, note: string): Promise<CommunityImageRecord> {
    const image = await this.store.getCommunityImage(id);
    if (!image) throw new DomainError('community image not found', 'COMMUNITY_IMAGE_NOT_FOUND', 404);
    image.status = 'REJECTED';
    image.error = note.slice(0, 500) || 'Rejected during human review.';
    image.humanReview = { decision: 'REJECT', reviewer: reviewer.slice(0, 120), note: note.slice(0, 500), reviewedAt: new Date().toISOString() };
    image.updatedAt = new Date().toISOString();
    await this.store.saveCommunityImage(image);
    await this.refreshSubmission(image.submissionId);
    const { sourceBytes: _source, derivativeBytes: _derivative, ...safe } = image;
    return safe;
  }

  async processApproved(id: string): Promise<void> {
    if (!this.editor.available || this.inFlight.has(`process:${id}`)) return;
    this.inFlight.add(`process:${id}`);
    try {
      const submission = await this.requireSubmission(id);
      const images = await this.store.listCommunityImages(id);
      const usedByPart = new Map<string, number>();
      for (const image of images.filter((row) => row.status === 'APPROVED_FOR_EDIT')) {
        try {
          image.status = 'EDITING'; image.updatedAt = new Date().toISOString(); await this.store.saveCommunityImage(image);
          const result = await this.editor.edit({
            source: image.sourceBytes, mediaType: image.sourceMediaType, filename: image.sourceFilename,
            route: image.order === 0 ? 'HERO_PREMIUM' : 'SECONDARY_ECONOMY', background: 'PURE_WHITE', watermarkStatus: 'NONE'
          });
          const qa = await this.editor.compare(image.sourceBytes, image.sourceMediaType, result);
          image.qa = qa;
          if (!qa.passed) { image.status = 'FAILED'; image.error = `Source comparison failed: ${qa.reason}`; }
          else {
            const derivative = await sharp(result.bytes).png({ compressionLevel: 9 }).toBuffer();
            const existing = await this.store.getEbayReferenceCache(image.partNumber);
            const existingCount = existing?.images.length ?? 0;
            const localOffset = usedByPart.get(image.partNumber) ?? 0;
            const filename = referenceAssetFilename(image.partNumber, existingCount + localOffset);
            usedByPart.set(image.partNumber, localOffset + 1);
            image.derivativeBytes = derivative;
            image.derivativeMediaType = 'image/png';
            image.derivativeSha256 = sha256(derivative);
            image.derivativeByteLength = derivative.length;
            image.archiveFilename = filename;
            image.archivePath = `data/reference-assets/${filename}`;
            image.status = 'READY_FOR_ARCHIVE';
            image.error = undefined;
          }
        } catch (error) { image.status = 'FAILED'; image.error = error instanceof Error ? error.message.slice(0, 500) : 'image edit failed'; }
        image.updatedAt = new Date().toISOString();
        await this.store.saveCommunityImage(image);
      }
      await this.publishReady(id, submission);
    } finally { this.inFlight.delete(`process:${id}`); }
  }

  async readPublishedAsset(filename: string): Promise<{ bytes: Uint8Array; mediaType: 'image/png' } | undefined> {
    const image = await this.store.getPublishedCommunityAsset(filename);
    return image?.derivativeBytes ? { bytes: image.derivativeBytes, mediaType: 'image/png' } : undefined;
  }

  private async publishReady(id: string, suppliedSubmission?: CommunitySubmissionRecord): Promise<void> {
    const submission = suppliedSubmission ?? await this.requireSubmission(id);
    const ready = (await this.store.listCommunityImages(id)).filter(
      (image) => image.status === 'READY_FOR_ARCHIVE' && image.derivativeBytes && image.archivePath
    );
    if (ready.length && this.archive.available) {
      const published = await this.archive.publish({
        submissionId: id,
        contributorCredit: submission.contributorCredit,
        files: ready.map((image) => ({ path: image.archivePath!, bytes: image.derivativeBytes! }))
      });
      const publishedAt = new Date().toISOString();
      for (const image of ready) {
        image.status = 'PUBLISHED';
        image.publishedAt = publishedAt;
        image.updatedAt = publishedAt;
        await this.store.saveCommunityImage(image);
      }
      submission.archiveCommitSha = published.commitSha;
      submission.updatedAt = publishedAt;
      await this.store.saveCommunitySubmission(submission);
      for (const partNumber of [...new Set(ready.map((image) => image.partNumber))]) {
        await this.refreshReferenceArchive(partNumber, submission.contributorCredit);
      }
    }
    await this.refreshSubmission(id);
  }

  private async refreshReferenceArchive(partNumber: string, fallbackCredit: string): Promise<void> {
    const images = await this.store.listPublishedCommunityImages(partNumber);
    if (!images.length) return;
    const at = new Date().toISOString();
    const publicImages: EbayReferenceImage[] = images.map((image, index) => ({
      url: `/v1/community-assets/${image.archiveFilename}`,
      alt: `Rights-cleared community reference ${index + 1} for OEM part ${partNumber}`,
      contributorCredit: image.contributorCredit || fallbackCredit,
      contentReview: {
        decision: 'ACCEPT_PART_ONLY', method: 'AUTOMATED_VISUAL_REVIEW',
        containsPerson: false, containsFace: false, containsHand: false, containsBodyPart: false,
        containsMarketplacePromo: false, containsWatermarkOrOverlay: false, checkedAt: image.moderation?.checkedAt ?? at
      }
    }));
    const record: EbayReferenceCacheRecord = {
      partNumber, status: 'RIGHTS_CLEARED_ARCHIVE', source: 'PARTQUILL_RIGHTS_CLEARED', rightsState: 'RIGHTS_CLEARED',
      sourceItemId: null, sourceUrl: null, title: `Rights-cleared community reference set for ${partNumber}`,
      categoryId: null, categoryPath: null, images: publicImages,
      matchEvidence: ['Contributor ownership attestation', 'Automated part-only safety screen', 'Human PartQuill review', 'Source-preservation QA'],
      checkedAt: at, expiresAt: null, retryAfter: null, archiveAllowed: true, listingPayloadEligible: false
    };
    await this.store.saveEbayReferenceCache(record);
  }

  private async refreshSubmission(id: string): Promise<CommunitySubmissionRecord> {
    const submission = await this.requireSubmission(id);
    const images = await this.store.listCommunityImages(id);
    submission.acceptedCount = images.filter((image) => [
      'PENDING_HUMAN_REVIEW','APPROVED_FOR_EDIT','AWAITING_CHATGPT_EDIT','EDITING',
      'PENDING_DERIVATIVE_REVIEW','READY_FOR_ARCHIVE','PUBLISHED'
    ].includes(image.status)).length;
    submission.rejectedCount = images.filter((image) => image.status === 'REJECTED').length;
    if (images.every((image) => image.status === 'REJECTED')) submission.status = 'REJECTED';
    else if (images.every((image) => ['PUBLISHED','REJECTED'].includes(image.status))) submission.status = images.some((image) => image.status === 'REJECTED') ? 'PARTIALLY_PUBLISHED' : 'PUBLISHED';
    else if (images.some((image) => [
      'APPROVED_FOR_EDIT','AWAITING_CHATGPT_EDIT','EDITING','PENDING_DERIVATIVE_REVIEW'
    ].includes(image.status))) submission.status = 'PROCESSING';
    else if (images.some((image) => image.status === 'READY_FOR_ARCHIVE')) submission.status = 'READY_FOR_ARCHIVE';
    else if (images.some((image) => image.status === 'PENDING_HUMAN_REVIEW')) submission.status = 'PENDING_HUMAN_REVIEW';
    else if (images.some((image) => image.status === 'FAILED')) submission.status = 'FAILED';
    else submission.status = 'SCREENING';
    submission.updatedAt = new Date().toISOString();
    if (['PUBLISHED','PARTIALLY_PUBLISHED','REJECTED','FAILED'].includes(submission.status)) submission.completedAt ??= submission.updatedAt;
    await this.store.saveCommunitySubmission(submission);
    return submission;
  }

  private async requireSubmission(id: string): Promise<CommunitySubmissionRecord> {
    const submission = await this.store.getCommunitySubmission(id);
    if (!submission) throw new DomainError('community submission not found', 'COMMUNITY_SUBMISSION_NOT_FOUND', 404);
    return submission;
  }
}
