import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { decodedPixelSha256, normalizeFerrariDerivative, validateFerrariDerivative } from '../src/shopify-media/ferrari-quality.js';

describe('Ferrari Shopify image normalization', () => {
  it('creates a metadata-free 2000px sRGB JPEG with a pure-white perimeter', async () => {
    const source = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#ffffff' }
    }).composite([{
      input: { create: { width: 300, height: 160, channels: 3, background: '#87231f' } },
      left: 150,
      top: 120
    }]).withMetadata({ orientation: 1, density: 300 }).png().toBuffer();

    const derivative = await normalizeFerrariDerivative(source);
    const qa = await validateFerrariDerivative(derivative);
    const metadata = await sharp(derivative).metadata();

    expect(qa).toMatchObject({
      width: 2000,
      height: 2000,
      mediaType: 'image/jpeg',
      colorSpace: 'srgb',
      metadataStripped: true,
      background: '#FFFFFF'
    });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
  });

  it('deduplicates decoded pixels even when source encoding metadata differs', async () => {
    const base = sharp({ create: { width: 80, height: 60, channels: 3, background: '#557799' } });
    const plain = await base.clone().png().toBuffer();
    const tagged = await base.clone().withMetadata({ density: 144 }).png().toBuffer();
    expect(Buffer.compare(plain, tagged)).not.toBe(0);
    expect(await decodedPixelSha256(plain)).toBe(await decodedPixelSha256(tagged));
  });
});
