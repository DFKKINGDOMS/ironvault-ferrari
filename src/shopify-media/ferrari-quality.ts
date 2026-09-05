import { createHash } from 'node:crypto';
import sharp from 'sharp';

const EDGE = 2000;
const MAX_INPUT_PIXELS = 80_000_000;

export interface FerrariDerivativeQa {
  width: 2000;
  height: 2000;
  mediaType: 'image/jpeg';
  colorSpace: 'srgb';
  metadataStripped: true;
  background: '#FFFFFF';
  nonWhiteRatio: number;
}

export async function decodedPixelSha256(bytes: Uint8Array): Promise<string> {
  const decoded = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .removeAlpha()
    .toColorspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return createHash('sha256')
    .update(`${decoded.info.width}x${decoded.info.height}x${decoded.info.channels}:`)
    .update(decoded.data)
    .digest('hex');
}

export async function normalizeFerrariDerivative(bytes: Uint8Array): Promise<Uint8Array> {
  return sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColorspace('srgb')
    .resize({
      width: EDGE,
      height: EDGE,
      fit: 'contain',
      position: 'centre',
      background: '#ffffff',
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false
    })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
}

export async function validateFerrariDerivative(bytes: Uint8Array): Promise<FerrariDerivativeQa> {
  if (bytes.length < 8_000) throw new Error('QA: derivative is unexpectedly small');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('QA: derivative is not a JPEG');
  const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
  const metadata = await image.metadata();
  if (metadata.width !== EDGE || metadata.height !== EDGE) throw new Error('QA: derivative is not 2000x2000');
  if (metadata.space !== 'srgb') throw new Error(`QA: derivative color space is ${metadata.space ?? 'unknown'}, not sRGB`);
  if (metadata.exif || metadata.iptc || metadata.xmp) throw new Error('QA: derivative still contains embedded metadata');

  const sample = await image.resize({ width: 250, height: 250, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let nonWhite = 0;
  let perimeterNonWhite = 0;
  let perimeter = 0;
  const channels = sample.info.channels;
  for (let y = 0; y < sample.info.height; y += 1) {
    for (let x = 0; x < sample.info.width; x += 1) {
      const offset = (y * sample.info.width + x) * channels;
      const r = sample.data[offset] ?? 0;
      const g = sample.data[offset + 1] ?? r;
      const b = sample.data[offset + 2] ?? r;
      const colored = r < 248 || g < 248 || b < 248;
      if (colored) nonWhite += 1;
      if (x < 2 || y < 2 || x >= sample.info.width - 2 || y >= sample.info.height - 2) {
        perimeter += 1;
        if (colored) perimeterNonWhite += 1;
      }
    }
  }
  const nonWhiteRatio = nonWhite / (sample.info.width * sample.info.height);
  if (nonWhiteRatio < 0.002) throw new Error('QA: derivative is effectively blank');
  if (nonWhiteRatio > 0.86) throw new Error('QA: derivative does not retain comfortable white margins');
  if (perimeterNonWhite / perimeter > 0.01) throw new Error('QA: product or residue reaches the canvas edge');
  return {
    width: 2000,
    height: 2000,
    mediaType: 'image/jpeg',
    colorSpace: 'srgb',
    metadataStripped: true,
    background: '#FFFFFF',
    nonWhiteRatio
  };
}
