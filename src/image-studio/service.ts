import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { DomainError } from '../domain/errors.js';
import { quoteStudioBatch } from './cost-model.js';
import type { StudioFileStore } from './file-store.js';
import type {
  EditResult,
  ImageEditEngine,
  StudioBackground,
  StudioImageRecord,
  StudioJobRecord,
  StudioSourceUpload,
  StudioWatermarkStatus
} from './types.js';

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const SUPPORTED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

function timestamp(): string {
  return new Date().toISOString();
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function cleanFilename(value: string): string {
  const safe = basename(value || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  return safe.slice(0, 180) || 'image';
}

function validateResult(result: EditResult): void {
  const bytes = Buffer.from(result.bytes);
  if (bytes.length < 1_000) throw new Error('generated result is unexpectedly small');
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const webp = bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('generated result is not a recognized PNG, JPEG or WebP image');
}

async function runPool<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await task(items[index]!);
    }
  });
  await Promise.all(workers);
}

export interface CreateStudioJobInput {
  sellerId: string;
  files: StudioSourceUpload[];
  background: StudioBackground;
  rightsConfirmed: boolean;
  watermarkStatus: StudioWatermarkStatus;
}

export class ImageStudioService {
  constructor(
    private readonly files: StudioFileStore,
    private readonly engine: ImageEditEngine,
    private readonly maxImages = 24,
    private readonly concurrency = 3,
    private readonly autoStart = true
  ) {}

  async initialize(): Promise<void> {
    await this.files.initialize();
  }

  get activated(): boolean {
    return this.engine.available;
  }

  async createJob(input: CreateStudioJobInput): Promise<StudioJobRecord> {
    if (!input.rightsConfirmed) {
      throw new DomainError('photograph ownership or written permission is required', 'IMAGE_RIGHTS_REQUIRED', 409);
    }
    if (!input.files.length || input.files.length > this.maxImages) {
      throw new DomainError(`upload between 1 and ${this.maxImages} images`, 'IMAGE_COUNT_INVALID', 400);
    }
    const hashes = new Set<string>();
    const prepared = input.files.map((file) => {
      if (!SUPPORTED_MEDIA.has(file.mediaType)) {
        throw new DomainError('only JPEG, PNG and WebP images are accepted', 'IMAGE_TYPE_UNSUPPORTED', 400);
      }
      if (!file.bytes.length || file.bytes.length > MAX_FILE_BYTES) {
        throw new DomainError('each image must be between 1 byte and 12 MB', 'IMAGE_SIZE_INVALID', 400);
      }
      const hash = sha256(file.bytes);
      if (hashes.has(hash)) throw new DomainError('duplicate source image in batch', 'DUPLICATE_IMAGE', 400);
      hashes.add(hash);
      return { ...file, filename: cleanFilename(file.filename), sha256: hash };
    });

    const id = randomUUID();
    const createdAt = timestamp();
    const images: StudioImageRecord[] = [];
    for (const [order, source] of prepared.entries()) {
      const imageId = randomUUID();
      const originalPath = this.files.originalPath(id, imageId, source.mediaType);
      await this.files.writeBytes(originalPath, source.bytes);
      images.push({
        id: imageId,
        order,
        isPrimary: order === 0,
        filename: source.filename,
        mediaType: source.mediaType,
        sha256: source.sha256,
        byteLength: source.bytes.length,
        originalPath,
        attempts: 0,
        status: 'QUEUED'
      });
    }

    const blocked = input.watermarkStatus === 'SUSPECTED_THIRD_PARTY';
    const job: StudioJobRecord = {
      id,
      sellerId: input.sellerId,
      status: blocked ? 'BLOCKED' : this.engine.available ? 'QUEUED' : 'AWAITING_ACTIVATION',
      background: input.background,
      rightsConfirmed: input.rightsConfirmed,
      watermarkStatus: input.watermarkStatus,
      originalRetention: 'IMMUTABLE',
      imageCount: images.length,
      quote: quoteStudioBatch(images.length),
      images,
      createdAt,
      updatedAt: createdAt,
      ...(blocked ? { blockedReason: 'Suspected third-party watermark removal is not permitted.' } : {})
    };
    await this.files.saveJob(job);
    if (job.status === 'QUEUED' && this.autoStart) {
      queueMicrotask(() => void this.processJob(job.id).catch(() => undefined));
    }
    return job;
  }

  async getJob(jobId: string): Promise<StudioJobRecord> {
    const job = await this.files.getJob(jobId);
    if (!job) throw new DomainError('Image Studio job not found', 'STUDIO_JOB_NOT_FOUND', 404);
    return job;
  }

  async readImage(jobId: string, imageId: string, kind: 'original' | 'result'): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const job = await this.getJob(jobId);
    const image = job.images.find((row) => row.id === imageId);
    if (!image) throw new DomainError('Image Studio image not found', 'STUDIO_IMAGE_NOT_FOUND', 404);
    const path = kind === 'original' ? image.originalPath : image.resultPath;
    if (!path) throw new DomainError('edited result is not available', 'STUDIO_RESULT_NOT_AVAILABLE', 404);
    return { bytes: await this.files.readBytes(path), mediaType: kind === 'original' ? image.mediaType : this.files.resultMediaType(path) };
  }

  async retry(jobId: string): Promise<StudioJobRecord> {
    const job = await this.getJob(jobId);
    if (!this.engine.available) throw new DomainError('Image Studio is awaiting API activation', 'STUDIO_NOT_ACTIVATED', 503);
    if (!['FAILED', 'REVIEW_REQUIRED', 'AWAITING_ACTIVATION'].includes(job.status)) {
      throw new DomainError('only failed, review or activation-held jobs can be retried', 'STUDIO_RETRY_NOT_ALLOWED', 409);
    }
    for (const image of job.images) {
      if (image.status !== 'COMPLETED') {
        image.status = 'QUEUED';
        image.error = undefined;
      }
    }
    job.status = 'QUEUED';
    job.updatedAt = timestamp();
    await this.files.saveJob(job);
    queueMicrotask(() => void this.processJob(job.id).catch(() => undefined));
    return job;
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!this.engine.available || job.status === 'BLOCKED') return;
    job.status = 'RUNNING';
    job.startedAt ??= timestamp();
    job.updatedAt = timestamp();
    await this.files.saveJob(job);

    await runPool(
      job.images.filter((image) => image.status !== 'COMPLETED'),
      this.concurrency,
      async (image) => {
        image.status = 'RUNNING';
        image.route = image.isPrimary ? 'HERO_PREMIUM' : 'SECONDARY_ECONOMY';
        image.attempts += 1;
        job.updatedAt = timestamp();
        await this.files.saveJob(job);
        try {
          const source = await this.files.readBytes(image.originalPath);
          let result = await this.engine.edit({
            source,
            mediaType: image.mediaType,
            filename: image.filename,
            route: image.route,
            background: job.background,
            watermarkStatus: job.watermarkStatus
          });
          validateResult(result);
          let qa = await this.engine.compare(source, image.mediaType, result);
          if (!qa.passed && !image.isPrimary) {
            image.route = 'QA_ESCALATION';
            image.attempts += 1;
            result = await this.engine.edit({
              source,
              mediaType: image.mediaType,
              filename: image.filename,
              route: 'QA_ESCALATION',
              background: job.background,
              watermarkStatus: job.watermarkStatus
            });
            validateResult(result);
            qa = await this.engine.compare(source, image.mediaType, result);
          }
          image.qa = qa;
          if (!qa.passed) {
            image.status = 'REVIEW_REQUIRED';
            image.error = `Source comparison failed: ${qa.reason}`;
            return;
          }
          const resultPath = this.files.resultPath(job.id, image.id, result.mediaType);
          await this.files.replaceBytes(resultPath, result.bytes);
          image.resultPath = resultPath;
          image.resultMediaType = result.mediaType;
          image.resultSha256 = sha256(result.bytes);
          image.status = 'COMPLETED';
          image.error = undefined;
        } catch (error) {
          image.status = 'FAILED';
          image.error = error instanceof Error ? error.message.slice(0, 1_000) : 'image processing failed';
        } finally {
          job.updatedAt = timestamp();
          await this.files.saveJob(job);
        }
      }
    );

    const review = job.images.some((image) => image.status === 'REVIEW_REQUIRED');
    const failed = job.images.some((image) => image.status === 'FAILED');
    job.status = review ? 'REVIEW_REQUIRED' : failed ? 'FAILED' : 'COMPLETED';
    job.completedAt = timestamp();
    job.updatedAt = job.completedAt;
    await this.files.saveJob(job);
  }
}
