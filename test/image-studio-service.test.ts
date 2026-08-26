import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StudioFileStore } from '../src/image-studio/file-store.js';
import { ImageStudioService } from '../src/image-studio/service.js';
import type { EditRequest, EditResult, ImageEditEngine, QaResult } from '../src/image-studio/types.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

class FakeEngine implements ImageEditEngine {
  readonly available = true;
  readonly routes: string[] = [];

  async edit(input: EditRequest): Promise<EditResult> {
    this.routes.push(input.route);
    return {
      bytes: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2_000, 7)]),
      mediaType: 'image/png',
      model: input.route === 'SECONDARY_ECONOMY' ? 'gpt-image-1-mini' : 'gpt-image-2',
      quality: 'high'
    };
  }

  async compare(): Promise<QaResult> {
    return { passed: true, reason: 'source geometry and markings preserved', model: 'gpt-5.4-mini' };
  }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'partquill-studio-'));
  roots.push(root);
  const files = new StudioFileStore(root);
  const engine = new FakeEngine();
  const service = new ImageStudioService(files, engine, 24, 3, false);
  await service.initialize();
  return { root, files, engine, service };
}

describe('Image Studio job service', () => {
  it('retains immutable originals and completes a hero plus secondary batch', async () => {
    const { service, engine } = await setup();
    const sourceOne = Buffer.from('seller-owned-source-one');
    const sourceTwo = Buffer.from('seller-owned-source-two');
    const job = await service.createJob({
      sellerId: 'seller-one',
      background: 'PURE_WHITE',
      rightsConfirmed: true,
      watermarkStatus: 'NONE',
      files: [
        { filename: 'hero.jpg', mediaType: 'image/jpeg', bytes: sourceOne },
        { filename: 'detail.jpg', mediaType: 'image/jpeg', bytes: sourceTwo }
      ]
    });

    await service.processJob(job.id);
    const completed = await service.getJob(job.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.images.map((image) => image.route)).toEqual(['HERO_PREMIUM', 'SECONDARY_ECONOMY']);
    expect(engine.routes).toEqual(['HERO_PREMIUM', 'SECONDARY_ECONOMY']);
    expect(await readFile(completed.images[0]!.originalPath)).toEqual(sourceOne);
    expect(await readFile(completed.images[1]!.originalPath)).toEqual(sourceTwo);
    expect(completed.images.every((image) => image.resultSha256 && image.qa?.passed)).toBe(true);
  });

  it('blocks suspected third-party watermark removal before processing', async () => {
    const { service, engine } = await setup();
    const job = await service.createJob({
      sellerId: 'seller-one',
      background: 'PURE_WHITE',
      rightsConfirmed: true,
      watermarkStatus: 'SUSPECTED_THIRD_PARTY',
      files: [{ filename: 'watermarked.jpg', mediaType: 'image/jpeg', bytes: Buffer.from('source') }]
    });
    expect(job.status).toBe('BLOCKED');
    expect(engine.routes).toHaveLength(0);
  });

  it('requires seller rights and rejects duplicate images', async () => {
    const { service } = await setup();
    await expect(
      service.createJob({
        sellerId: 'seller-one',
        background: 'PURE_WHITE',
        rightsConfirmed: false,
        watermarkStatus: 'NONE',
        files: [{ filename: 'one.jpg', mediaType: 'image/jpeg', bytes: Buffer.from('source') }]
      })
    ).rejects.toMatchObject({ code: 'IMAGE_RIGHTS_REQUIRED' });
    const duplicate = Buffer.from('same-source');
    await expect(
      service.createJob({
        sellerId: 'seller-one',
        background: 'PURE_WHITE',
        rightsConfirmed: true,
        watermarkStatus: 'NONE',
        files: [
          { filename: 'one.jpg', mediaType: 'image/jpeg', bytes: duplicate },
          { filename: 'two.jpg', mediaType: 'image/jpeg', bytes: duplicate }
        ]
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_IMAGE' });
  });
});
