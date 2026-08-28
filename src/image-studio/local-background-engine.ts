import sharp from 'sharp';
import type { EditRequest, EditResult, ImageEditEngine, QaResult } from './types.js';

const ANALYSIS_EDGE = 1_600;
const CANVAS_EDGE = 1_600;
const OBJECT_EDGE = 1_440;
const MAX_INPUT_PIXELS = 60_000_000;

type Rgb = { r: number; g: number; b: number };

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 255;
}

function distance(data: Buffer, offset: number, background: Rgb): number {
  const red = data[offset] ?? 0;
  const green = data[offset + 1] ?? 0;
  const blue = data[offset + 2] ?? 0;
  return Math.sqrt((red - background.r) ** 2 + (green - background.g) ** 2 + (blue - background.b) ** 2);
}

function edgeSamples(data: Buffer, width: number, height: number): Array<{ offset: number; color: Rgb }> {
  const samples: Array<{ offset: number; color: Rgb }> = [];
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 160));
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    if ((data[offset + 3] ?? 255) < 16) return;
    samples.push({ offset, color: { r: data[offset] ?? 0, g: data[offset + 1] ?? 0, b: data[offset + 2] ?? 0 } });
  };
  for (let x = 0; x < width; x += stride) { add(x, 0); add(x, height - 1); }
  for (let y = stride; y < height - 1; y += stride) { add(0, y); add(width - 1, y); }
  return samples;
}

function backgroundMask(data: Buffer, width: number, height: number): Buffer {
  const samples = edgeSamples(data, width, height);
  if (samples.length < 8) throw new Error('The image edge does not provide a usable background sample.');
  const background = {
    r: median(samples.map((sample) => sample.color.r)),
    g: median(samples.map((sample) => sample.color.g)),
    b: median(samples.map((sample) => sample.color.b))
  };
  const variation = samples.map((sample) => distance(data, sample.offset, background)).sort((a, b) => a - b);
  const edgeP90 = variation[Math.floor(variation.length * 0.9)] ?? 0;
  if (edgeP90 > 58) throw new Error('The background is too complex for the conservative local editor.');
  const threshold = Math.max(18, Math.min(58, edgeP90 + 16));
  const pixels = width * height;
  const removed = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let head = 0;
  let tail = 0;

  const qualifies = (index: number) => {
    const offset = index * 4;
    return (data[offset + 3] ?? 255) < 16 || distance(data, offset, background) <= threshold;
  };
  const enqueue = (index: number) => {
    if (removed[index] || !qualifies(index)) return;
    removed[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) { enqueue(x); enqueue((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y += 1) { enqueue(y * width); enqueue(y * width + width - 1); }

  while (head < tail) {
    const index = queue[head++]!;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }

  const foregroundPixels = pixels - tail;
  const ratio = foregroundPixels / pixels;
  if (ratio < 0.015 || ratio > 0.92) throw new Error('The local editor could not isolate one clear foreground part.');
  const alpha = Buffer.allocUnsafe(pixels);
  for (let index = 0; index < pixels; index += 1) alpha[index] = removed[index] ? 0 : 255;
  return alpha;
}

export class ConservativeBackgroundEngine implements ImageEditEngine {
  readonly available: boolean;

  constructor(private readonly comparator: Pick<ImageEditEngine, 'available' | 'compare'>) {
    this.available = comparator.available;
  }

  async edit(input: EditRequest): Promise<EditResult> {
    const prepared = await sharp(input.source, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: ANALYSIS_EDGE, height: ANALYSIS_EDGE, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = prepared.info;
    const alpha = backgroundMask(prepared.data, width, height);
    const feathered = await sharp(alpha, { raw: { width, height, channels: 1 } })
      .blur(0.65)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const rgba = Buffer.from(prepared.data);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      const alphaValue = feathered.data[index * feathered.info.channels]!;
      rgba[offset + 3] = alphaValue;
      if (alphaValue === 0) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
      }
    }

    const foreground = await sharp(rgba, { raw: { width, height, channels: 4 } })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize({ width: OBJECT_EDGE, height: OBJECT_EDGE, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    const left = Math.floor((CANVAS_EDGE - foreground.info.width) / 2);
    const top = Math.floor((CANVAS_EDGE - foreground.info.height) / 2);
    const bytes = await sharp({
      create: { width: CANVAS_EDGE, height: CANVAS_EDGE, channels: 3, background: '#ffffff' }
    })
      .composite([{ input: foreground.data, left, top }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    return { bytes, mediaType: 'image/png', model: 'partquill-local-background-v1', quality: 'pixel-preserving' };
  }

  compare(source: Uint8Array, sourceMediaType: string, candidate: EditResult): Promise<QaResult> {
    return this.comparator.compare(source, sourceMediaType, candidate);
  }
}
