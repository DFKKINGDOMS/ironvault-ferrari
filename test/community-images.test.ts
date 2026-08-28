import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { CommunityImageService } from '../src/community/service.js';
import type {
  CommunityArchivePublisher,
  CommunityModerationEngine,
  CommunityModerationResult
} from '../src/community/types.js';
import type { EditRequest, EditResult, ImageEditEngine, QaResult } from '../src/image-studio/types.js';
import { MemoryStore } from '../src/store/memory-store.js';

class AcceptModerator implements CommunityModerationEngine {
  readonly available = true;
  async review(): Promise<CommunityModerationResult> {
    return {
      decision: 'ACCEPT_PART_ONLY', containsPerson: false, containsFace: false, containsHand: false,
      containsBodyPart: false, containsPromotionalGraphic: false, containsWatermarkOrOverlay: false,
      containsExplicitOrIllegalContent: false, unrelatedToAutomotiveOrMachineryPart: false,
      visiblePartNumberConflict: false, visiblePartNumber: 'ABC-123', reason: 'part-only image',
      model: 'test-moderator', checkedAt: '2026-08-28T12:00:00.000Z'
    };
  }
}

class RejectPersonModerator extends AcceptModerator {
  override async review(): Promise<CommunityModerationResult> {
    return { ...(await super.review()), decision: 'REJECT', containsHand: true, reason: 'hand visible' };
  }
}

class FakeEditor implements ImageEditEngine {
  readonly available = true;
  constructor(private readonly result: Uint8Array) {}
  async edit(_input: EditRequest): Promise<EditResult> {
    return { bytes: this.result, mediaType: 'image/png', model: 'test-image', quality: 'high' };
  }
  async compare(): Promise<QaResult> { return { passed: true, reason: 'preserved', model: 'test-qa' }; }
}

class FakeArchive implements CommunityArchivePublisher {
  readonly available = true;
  files: Array<{ path: string; bytes: Uint8Array }> = [];
  async publish(input: { files: Array<{ path: string; bytes: Uint8Array }> }): Promise<{ commitSha: string }> {
    this.files = input.files;
    return { commitSha: 'a'.repeat(40) };
  }
}

async function png(red: number): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 100, channels: 3, background: { r: red, g: 80, b: 30 } } }).png().toBuffer();
}

describe('community image archive', () => {
  it('requires per-image part numbers, screens, human-approves, edits, names and publishes by SKU', async () => {
    const store = new MemoryStore();
    const archive = new FakeArchive();
    const source = await png(180);
    const service = new CommunityImageService(store, new AcceptModerator(), new FakeEditor(await png(200)), archive, 50, false);
    const created = await service.createSubmission({
      contributorCredit: 'Valley Parts Club', ownershipConfirmed: true, licenseConfirmed: true,
      contentRulesConfirmed: true, attestationFingerprint: '127.0.0.1|test',
      files: [{ filename: 'view-one.png', mediaType: 'image/png', partNumber: 'abc-123', bytes: source }]
    });

    await service.screenSubmission(created.submission.id);
    expect((await service.listReviewQueue())[0]?.images[0]?.status).toBe('PENDING_HUMAN_REVIEW');
    await service.approveSubmission(created.submission.id, 'reviewer-1');
    await service.processApproved(created.submission.id);

    const receipt = await service.getPublicSubmission(created.submission.id, created.statusToken);
    expect(receipt.submission.status).toBe('PUBLISHED');
    expect(receipt.images[0]).toMatchObject({ partNumber: 'ABC123', status: 'PUBLISHED', archiveFilename: 'ABC123.png' });
    expect(archive.files.map((file) => file.path)).toEqual(['data/reference-assets/ABC123.png']);
    expect((await store.getEbayReferenceCache('ABC123'))).toMatchObject({
      status: 'RIGHTS_CLEARED_ARCHIVE', rightsState: 'RIGHTS_CLEARED', listingPayloadEligible: false,
      images: [{ contributorCredit: 'Valley Parts Club', url: '/v1/community-assets/ABC123.png' }]
    });
    await expect(service.getPublicSubmission(created.submission.id, 'wrong-token-that-is-long-enough')).rejects.toMatchObject({ code: 'COMMUNITY_RECEIPT_INVALID' });
  });

  it('rejects any image containing a hand before human approval or editing', async () => {
    const service = new CommunityImageService(new MemoryStore(), new RejectPersonModerator(), new FakeEditor(await png(210)), new FakeArchive(), 50, false);
    const created = await service.createSubmission({
      contributorCredit: 'Authorized Owner', ownershipConfirmed: true, licenseConfirmed: true,
      contentRulesConfirmed: true, attestationFingerprint: 'test',
      files: [{ filename: 'hand.png', mediaType: 'image/png', partNumber: '5455055', bytes: await png(120) }]
    });
    await service.screenSubmission(created.submission.id);
    const receipt = await service.getPublicSubmission(created.submission.id, created.statusToken);
    expect(receipt.submission.status).toBe('REJECTED');
    expect(receipt.images[0]).toMatchObject({ status: 'REJECTED', error: 'hand visible' });
    await expect(service.approveSubmission(created.submission.id, 'reviewer')).rejects.toMatchObject({ code: 'COMMUNITY_NOT_REVIEWABLE' });
  });

  it('blocks an exact duplicate image in the same contribution', async () => {
    const source = await png(150);
    const service = new CommunityImageService(new MemoryStore(), new AcceptModerator(), new FakeEditor(source), new FakeArchive(), 50, false);
    await expect(service.createSubmission({
      contributorCredit: 'Owner', ownershipConfirmed: true, licenseConfirmed: true, contentRulesConfirmed: true,
      attestationFingerprint: 'test', files: [
        { filename: 'one.png', mediaType: 'image/png', partNumber: 'A-1', bytes: source },
        { filename: 'two.png', mediaType: 'image/png', partNumber: 'A-1', bytes: source }
      ]
    })).rejects.toMatchObject({ code: 'COMMUNITY_DUPLICATE_IMAGE' });
  });
});
