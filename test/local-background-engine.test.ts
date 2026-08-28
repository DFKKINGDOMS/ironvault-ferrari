import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ConservativeBackgroundEngine } from '../src/image-studio/local-background-engine.js';
import type { EditResult, QaResult } from '../src/image-studio/types.js';

const passedQa: QaResult = {
  passed: true,
  reason: 'source and result match',
  model: 'test-review'
};

describe('conservative local background editor', () => {
  it('preserves foreground pixels and places the part on a pure-white 1600px canvas', async () => {
    let compared = false;
    const engine = new ConservativeBackgroundEngine({
      available: true,
      compare: async (_source: Uint8Array, _mediaType: string, _candidate: EditResult) => {
        compared = true;
        return passedQa;
      }
    });
    const source = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 218, g: 222, b: 226 } }
    }).composite([{
      input: {
        create: { width: 180, height: 100, channels: 3, background: { r: 190, g: 24, b: 34 } }
      },
      left: 110,
      top: 100
    }]).png().toBuffer();

    const result = await engine.edit({
      source,
      mediaType: 'image/png',
      filename: '5455055.png',
      background: 'PURE_WHITE',
      watermarkStatus: 'NONE',
      route: 'HERO_PREMIUM'
    });
    const decoded = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const offset = (y * decoded.info.width + x) * decoded.info.channels;
      return Array.from(decoded.data.subarray(offset, offset + 3));
    };
    expect(decoded.info.width).toBe(1_600);
    expect(decoded.info.height).toBe(1_600);
    expect(pixel(0, 0)).toEqual([255, 255, 255]);
    expect(pixel(800, 800)[0]).toBeGreaterThan(170);
    expect(pixel(800, 800)[1]).toBeLessThan(50);
    expect(result.model).toBe('partquill-local-background-v1');
    expect(result.quality).toBe('pixel-preserving');
    await engine.compare(source, 'image/png', result);
    expect(compared).toBe(true);
  });

  it('rejects a complex edge instead of guessing at the background', async () => {
    const tile = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#ffffff' }
    }).composite([{ input: { create: { width: 20, height: 40, channels: 3, background: '#111111' } }, left: 0, top: 0 }])
      .png()
      .toBuffer();
    const source = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#ffffff' }
    }).composite(Array.from({ length: 100 }, (_, index) => ({
      input: tile,
      left: (index % 10) * 40,
      top: Math.floor(index / 10) * 40
    }))).png().toBuffer();
    const engine = new ConservativeBackgroundEngine({ available: true, compare: async () => passedQa });

    await expect(engine.edit({
      source,
      mediaType: 'image/png',
      filename: 'complex.png',
      background: 'PURE_WHITE',
      watermarkStatus: 'NONE',
      route: 'HERO_PREMIUM'
    })).rejects.toThrow('background is too complex');
  });
});
