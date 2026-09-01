import { ContainerClient } from '@azure/storage-blob';
import { extname, posix } from 'node:path';
import type { ImageJobManifest, ImageJobStore } from './file-store.js';

function safeExtension(mediaType: string): string {
  if (mediaType === 'image/png') return '.png';
  if (mediaType === 'image/webp') return '.webp';
  return '.jpg';
}

export class AzureBlobImageJobStore implements ImageJobStore {
  private readonly container: ContainerClient;
  private readonly saveChains = new Map<string, Promise<void>>();

  constructor(accountUrl: string, containerName: string, sas: string, private readonly prefix = 'image-studio') {
    const base = `${accountUrl.replace(/\/$/, '')}/${containerName}`;
    this.container = new ContainerClient(`${base}?${sas.replace(/^\?/, '')}`);
  }

  async initialize(): Promise<void> {
    await this.container.createIfNotExists();
  }

  jobDirectory(jobId: string): string {
    return posix.join(this.prefix, jobId);
  }

  artifactPath(jobId: string, group: string, filename: string): string {
    return posix.join(this.jobDirectory(jobId), group, filename);
  }

  originalPath(jobId: string, imageId: string, mediaType: string): string {
    return this.artifactPath(jobId, 'originals', `${imageId}${safeExtension(mediaType)}`);
  }

  resultPath(jobId: string, imageId: string, mediaType: string): string {
    return this.artifactPath(jobId, 'results', `${imageId}${safeExtension(mediaType)}`);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.container.getBlockBlobClient(path).uploadData(bytes, {
      conditions: { ifNoneMatch: '*' },
      blobHTTPHeaders: { blobContentType: this.resultMediaType(path) }
    });
  }

  async replaceBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.container.getBlockBlobClient(path).uploadData(bytes, {
      blobHTTPHeaders: { blobContentType: this.resultMediaType(path) }
    });
  }

  async saveJob<T extends ImageJobManifest>(job: T): Promise<void> {
    const previous = this.saveChains.get(job.id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const client = this.container.getBlockBlobClient(this.artifactPath(job.id, '', 'manifest.json'));
      await client.uploadData(Buffer.from(`${JSON.stringify(job, null, 2)}\n`), {
        blobHTTPHeaders: { blobContentType: 'application/json; charset=utf-8' }
      });
    });
    this.saveChains.set(job.id, next);
    try {
      await next;
    } finally {
      if (this.saveChains.get(job.id) === next) this.saveChains.delete(job.id);
    }
  }

  async getJob<T extends ImageJobManifest>(jobId: string): Promise<T | undefined> {
    try {
      const response = await this.container
        .getBlobClient(this.artifactPath(jobId, '', 'manifest.json'))
        .download();
      const bytes = await this.streamBytes(response.readableStreamBody);
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode === 404) return undefined;
      throw error;
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const response = await this.container.getBlobClient(path).download();
    return this.streamBytes(response.readableStreamBody);
  }

  resultMediaType(path: string): string {
    const extension = extname(path).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    if (extension === '.json') return 'application/json';
    return 'image/jpeg';
  }

  private async streamBytes(stream: NodeJS.ReadableStream | undefined): Promise<Uint8Array> {
    if (!stream) return new Uint8Array();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
}
