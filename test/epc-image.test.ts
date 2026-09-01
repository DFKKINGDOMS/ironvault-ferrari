import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { renderEpcDiagram } from '../src/epc-image/renderer.js';
import { EpcImageService } from '../src/epc-image/service.js';
import type { EpcQaEngine } from '../src/epc-image/types.js';
import { StudioFileStore } from '../src/image-studio/file-store.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sourceDiagram() {
  return sharp({
    create: { width: 1470, height: 1070, channels: 3, background: { r: 239, g: 245, b: 240 } }
  }).composite([
    { input: { create: { width: 500, height: 6, channels: 3, background: '#111111' } }, left: 300, top: 350 },
    { input: { create: { width: 6, height: 300, channels: 3, background: '#111111' } }, left: 550, top: 350 },
    { input: { create: { width: 260, height: 24, channels: 3, background: '#e5e5e5' } }, left: 900, top: 850 }
  ]).png().toBuffer();
}

describe('Eurospares EPC image pipeline', () => {
  it('creates the locked clean base, orange-callout image, clean thumbnail and hotspot map', async () => {
    const result = await renderEpcDiagram(await sourceDiagram(), [{ ref: '12', x: 200, y: 200, radius: 16, sku: 'ABC-12' }]);
    const clean = await sharp(result.cleanBase).raw().toBuffer({ resolveWithObject: true });
    const interactive = await sharp(result.interactive).raw().toBuffer({ resolveWithObject: true });
    expect(clean.info.width).toBe(1470);
    expect(clean.info.height).toBe(1070);
    expect(Array.from(clean.data.subarray(0, 3))).toEqual([255, 255, 255]);
    expect(result.callouts).toMatchObject([{ ref: '12', outputX: 200, outputY: 200, outputRadius: 16 }]);
    const ringOffset = (200 * interactive.info.width + 216) * interactive.info.channels;
    expect(interactive.data[ringOffset]).toBeGreaterThan(220);
    expect(interactive.data[ringOffset + 1]).toBeLessThan(150);
    expect(JSON.parse(Buffer.from(result.calloutMap).toString('utf8')).callouts).toEqual([
      { ref: '12', sku: 'ABC-12', x: 200, y: 200, radius: 16 }
    ]);
    const thumb = await sharp(result.thumbnail).metadata();
    expect(thumb.width).toBe(420);
    expect(thumb.height).toBe(306);
  });

  it('persists immutable source and all approved EPC artifact hashes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'partquill-epc-'));
    roots.push(root);
    const qa: EpcQaEngine = {
      available: true,
      compare: async () => ({ passed: true, reason: 'all geometry and callouts preserved', model: 'gpt-5-mini' })
    };
    const service = new EpcImageService(new StudioFileStore(root), qa, false);
    await service.initialize();
    const job = await service.createJob({
      brand: 'FERRARI',
      diagramId: '244-80-864-00/B',
      filename: 'source.png',
      mediaType: 'image/png',
      source: await sourceDiagram(),
      callouts: [{ ref: '12', x: 200, y: 200, sku: 'ABC-12' }],
      rightsConfirmed: true,
      watermarkStatus: 'OWNED_OR_AUTHORIZED'
    });
    await service.processJob(job.id);
    const completed = await service.getJob(job.id);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.imageRuleVersion).toBe('eurospares-clean-epc-v1.0');
    expect(completed.qa?.model).toBe('gpt-5-mini');
    expect(completed.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(completed.cleanBaseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(completed.interactiveSha256).toBe(completed.diagramSha256);
    expect((await service.readArtifact(job.id, 'callout-map')).mediaType).toBe('application/json');
  });

  it('blocks unconfirmed or suspected third-party watermark removal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'partquill-epc-block-'));
    roots.push(root);
    const qa: EpcQaEngine = { available: true, compare: async () => ({ passed: true, reason: 'ok', model: 'test' }) };
    const service = new EpcImageService(new StudioFileStore(root), qa, false);
    await service.initialize();
    await expect(service.createJob({
      brand: 'FERRARI', diagramId: 'x', filename: 'x.png', mediaType: 'image/png', source: await sourceDiagram(),
      callouts: [{ ref: '1', x: 10, y: 10 }], rightsConfirmed: false, watermarkStatus: 'NONE'
    })).rejects.toMatchObject({ code: 'EPC_IMAGE_RIGHTS_REQUIRED' });
    const blocked = await service.createJob({
      brand: 'FERRARI', diagramId: 'x', filename: 'x.png', mediaType: 'image/png', source: await sourceDiagram(),
      callouts: [{ ref: '1', x: 10, y: 10 }], rightsConfirmed: true, watermarkStatus: 'SUSPECTED_THIRD_PARTY'
    });
    expect(blocked.status).toBe('BLOCKED');
  });
});
