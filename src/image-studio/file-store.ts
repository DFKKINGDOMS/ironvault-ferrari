import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import type { StudioJobRecord } from './types.js';

export interface ImageJobManifest {
  id: string;
}

export interface ImageJobStore {
  initialize(): Promise<void>;
  jobDirectory(jobId: string): string;
  artifactPath(jobId: string, group: string, filename: string): string;
  originalPath(jobId: string, imageId: string, mediaType: string): string;
  resultPath(jobId: string, imageId: string, mediaType: string): string;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  writeFile(path: string, sourcePath: string): Promise<void>;
  replaceBytes(path: string, bytes: Uint8Array): Promise<void>;
  saveJob<T extends ImageJobManifest>(job: T): Promise<void>;
  getJob<T extends ImageJobManifest>(jobId: string): Promise<T | undefined>;
  readBytes(path: string): Promise<Uint8Array>;
  readToFile(path: string, destinationPath: string): Promise<void>;
  resultMediaType(path: string): string;
}

function safeExtension(mediaType: string): string {
  if (mediaType === 'image/png') return '.png';
  if (mediaType === 'image/webp') return '.webp';
  return '.jpg';
}

export class StudioFileStore implements ImageJobStore {
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

  artifactPath(jobId: string, group: string, filename: string): string {
    return join(this.jobDirectory(jobId), group, filename);
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

  async writeFile(path: string, sourcePath: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await copyFile(sourcePath, path, constants.COPYFILE_EXCL);
  }

  async replaceBytes(path: string, bytes: Uint8Array): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, path);
  }

  async saveJob<T extends ImageJobManifest>(job: T): Promise<void> {
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

  async getJob<T extends ImageJobManifest = StudioJobRecord>(jobId: string): Promise<T | undefined> {
    try {
      const raw = await readFile(join(this.jobDirectory(jobId), 'manifest.json'), 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return readFile(path);
  }

  async readToFile(path: string, destinationPath: string): Promise<void> {
    await mkdir(dirname(destinationPath), { recursive: true });
    await copyFile(path, destinationPath);
  }

  resultMediaType(path: string): string {
    const extension = extname(path).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    return 'image/jpeg';
  }
}
