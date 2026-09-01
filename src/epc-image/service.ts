import { createHash, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { DomainError } from '../domain/errors.js';
import type { ImageJobStore } from '../image-studio/file-store.js';
import { renderEpcDiagram } from './renderer.js';
import type { EpcArtifactKind, EpcBrand, EpcJobRecord, EpcQaEngine, EpcSourceCallout, EpcWatermarkStatus } from './types.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const RULE_VERSION = 'eurospares-clean-epc-v1.0' as const;
const REFERENCE_SHA = 'a5ccd78f88e8992bdbcfe26581fd533d19efbb3ee8da1f7b53a89cebcda7be8b' as const;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function now(): string {
  return new Date().toISOString();
}

export interface CreateEpcJobInput {
  brand: EpcBrand;
  diagramId: string;
  filename: string;
  mediaType: string;
  source: Uint8Array;
  callouts: EpcSourceCallout[];
  rightsConfirmed: boolean;
  watermarkStatus: EpcWatermarkStatus;
  lineThreshold?: number;
}

export class EpcImageService {
  constructor(
    private readonly store: ImageJobStore,
    private readonly qa: EpcQaEngine,
    private readonly autoStart = true
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  get activated(): boolean {
    return this.qa.available;
  }

  async createJob(input: CreateEpcJobInput): Promise<EpcJobRecord> {
    if (!input.rightsConfirmed) throw new DomainError('EPC image rights confirmation is required', 'EPC_IMAGE_RIGHTS_REQUIRED', 409);
    if (!MEDIA_TYPES.has(input.mediaType)) throw new DomainError('only JPEG, PNG and WebP EPC images are accepted', 'EPC_IMAGE_TYPE_UNSUPPORTED', 400);
    if (!input.source.length || input.source.length > MAX_FILE_BYTES) throw new DomainError('EPC source must be between 1 byte and 20 MB', 'EPC_IMAGE_SIZE_INVALID', 400);
    if (!input.callouts.length || input.callouts.length > 500) throw new DomainError('provide between 1 and 500 EPC callout hotspots', 'EPC_CALLOUT_COUNT_INVALID', 400);
    const seen = new Set<string>();
    for (const callout of input.callouts) {
      const ref = callout.ref.trim();
      if (!ref || ref.length > 24 || seen.has(ref)) throw new DomainError('EPC callout refs must be unique and 1-24 characters', 'EPC_CALLOUT_INVALID', 400);
      if (!Number.isFinite(callout.x) || !Number.isFinite(callout.y)) throw new DomainError('EPC callout coordinates must be finite numbers', 'EPC_CALLOUT_INVALID', 400);
      seen.add(ref);
    }
    const id = randomUUID();
    const createdAt = now();
    const extension = input.mediaType === 'image/png' ? '.png' : input.mediaType === 'image/webp' ? '.webp' : '.jpg';
    const sourceImagePath = this.store.artifactPath(id, 'source', `source${extension}`);
    await this.store.writeBytes(sourceImagePath, input.source);
    const blocked = input.watermarkStatus === 'SUSPECTED_THIRD_PARTY';
    const job: EpcJobRecord = {
      id,
      brand: input.brand,
      diagramId: input.diagramId.trim().slice(0, 160),
      status: blocked ? 'BLOCKED' : this.qa.available ? 'QUEUED' : 'AWAITING_ACTIVATION',
      rightsConfirmed: input.rightsConfirmed,
      watermarkStatus: input.watermarkStatus,
      imageRuleVersion: RULE_VERSION,
      canonicalReferenceSha256: REFERENCE_SHA,
      sourceFilename: basename(input.filename).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180),
      sourceMediaType: input.mediaType,
      sourceSha256: sha256(input.source),
      sourceImagePath,
      callouts: input.callouts.map((callout) => ({ ...callout, ref: callout.ref.trim(), outputX: 0, outputY: 0, outputRadius: 0 })),
      lineThreshold: input.lineThreshold ?? 190,
      createdAt,
      updatedAt: createdAt,
      ...(blocked ? { error: 'Suspected third-party watermark removal is not permitted.' } : {})
    };
    await this.store.saveJob(job);
    if (job.status === 'QUEUED' && this.autoStart) queueMicrotask(() => void this.processJob(id).catch(() => undefined));
    return job;
  }

  async getJob(jobId: string): Promise<EpcJobRecord> {
    const job = await this.store.getJob<EpcJobRecord>(jobId);
    if (!job) throw new DomainError('EPC image job not found', 'EPC_IMAGE_JOB_NOT_FOUND', 404);
    return job;
  }

  async processJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (!this.qa.available || job.status === 'BLOCKED') return;
    job.status = 'RUNNING';
    job.updatedAt = now();
    await this.store.saveJob(job);
    try {
      const source = await this.store.readBytes(job.sourceImagePath);
      const rendered = await renderEpcDiagram(source, job.callouts, job.lineThreshold);
      const paths = {
        clean: this.store.artifactPath(job.id, 'results', 'clean-base.png'),
        interactive: this.store.artifactPath(job.id, 'results', 'interactive.png'),
        thumbnail: this.store.artifactPath(job.id, 'results', 'thumbnail.png'),
        map: this.store.artifactPath(job.id, 'results', 'callout-map.json')
      };
      await Promise.all([
        this.store.replaceBytes(paths.clean, rendered.cleanBase),
        this.store.replaceBytes(paths.interactive, rendered.interactive),
        this.store.replaceBytes(paths.thumbnail, rendered.thumbnail),
        this.store.replaceBytes(paths.map, rendered.calloutMap)
      ]);
      job.cleanBaseImagePath = paths.clean;
      job.interactiveImagePath = paths.interactive;
      job.thumbnailImagePath = paths.thumbnail;
      job.calloutMapPath = paths.map;
      job.cleanBaseSha256 = sha256(rendered.cleanBase);
      job.interactiveSha256 = sha256(rendered.interactive);
      job.thumbnailSha256 = sha256(rendered.thumbnail);
      job.diagramSha256 = job.interactiveSha256;
      job.callouts = rendered.callouts;
      job.qa = await this.qa.compare(source, rendered.cleanBase, rendered.interactive, rendered.callouts.length);
      job.status = job.qa.passed ? 'COMPLETED' : 'REVIEW_REQUIRED';
      if (!job.qa.passed) job.error = `EPC source comparison failed: ${job.qa.reason}`;
    } catch (error) {
      job.status = 'FAILED';
      job.error = error instanceof Error ? error.message.slice(0, 1_000) : 'EPC image processing failed';
    }
    job.completedAt = now();
    job.updatedAt = job.completedAt;
    await this.store.saveJob(job);
  }

  async readArtifact(jobId: string, kind: EpcArtifactKind): Promise<{ bytes: Uint8Array; mediaType: string }> {
    const job = await this.getJob(jobId);
    const path = kind === 'source' ? job.sourceImagePath
      : kind === 'clean-base' ? job.cleanBaseImagePath
      : kind === 'interactive' ? job.interactiveImagePath
      : kind === 'thumbnail' ? job.thumbnailImagePath
      : job.calloutMapPath;
    if (!path) throw new DomainError('EPC artifact is not available', 'EPC_IMAGE_ARTIFACT_NOT_AVAILABLE', 404);
    return { bytes: await this.store.readBytes(path), mediaType: kind === 'callout-map' ? 'application/json' : this.store.resultMediaType(path) };
  }
}
