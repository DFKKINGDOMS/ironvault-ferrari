import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { StudioJobRecord } from './types.js';

function safeExtension(mediaType: string): string {
  if (mediaType === 'image/png') return '.png';
  if (mediaType === 'image/webp') return '.webp';
  return '.jpg';
}

export class StudioFileStore {
  readonly root: string;
  private readonly saveChains = new Map<string, Promise<void>>();

  constructor(root: string) {
    this.root = resolve(root);
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  jobDirectory(jobId: string): string {
    return join(this.root, jobId);
  }

  originalPath(jobId: string, imageId: string, mediaType: string): string {
    return join(this.jobDirectory(jobId), 'originals', `${imageId}${safeExtension(mediaType)}`);
  }

  resultPath(jobId: string, imageId: string, mediaType: string): string {
    return join(this.jobDirectory(jobId), 'results', `${imageId}${safeExtension(mediaType)}`);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: 'wx' });
  }

  async replaceBytes(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  }

  async saveJob(job: StudioJobRecord): Promise<void> {
    const previous = this.saveChains.get(job.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const path = join(this.jobDirectory(job.id), 'manifest.json');
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
      await rename(temporary, path);
    });
    this.saveChains.set(job.id, next);
    try {
      await next;
    } finally {
      if (this.saveChains.get(job.id) === next) this.saveChains.delete(job.id);
    }
  }

  async getJob(jobId: string): Promise<StudioJobRecord | undefined> {
    try {
      const raw = await readFile(join(this.jobDirectory(jobId), 'manifest.json'), 'utf8');
      return JSON.parse(raw) as StudioJobRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  resultMediaType(path: string): string {
    const extension = extname(path).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    return 'image/jpeg';
  }
}
