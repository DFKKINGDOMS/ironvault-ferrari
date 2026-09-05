import sharp from 'sharp';

type JsonObject = Record<string, unknown>;

const REVIEW_MAX_EDGE = 1_280;
const REVIEW_MAX_INPUT_PIXELS = 80_000_000;

/**
 * Build a metadata-free, bounded visual-review payload. The production source
 * and derivative remain untouched; only the copy sent to the review model is
 * resized and re-encoded.
 */
export async function reviewImageDataUrl(bytes: Uint8Array): Promise<string> {
  const preview = await sharp(bytes, { limitInputPixels: REVIEW_MAX_INPUT_PIXELS })
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColorspace('srgb')
    .resize({
      width: REVIEW_MAX_EDGE,
      height: REVIEW_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3
    })
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${preview.toString('base64')}`;
}

export function responseOutputText(payload: JsonObject): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const row of output) {
    if (!row || typeof row !== 'object') continue;
    const content = Array.isArray((row as JsonObject).content) ? (row as JsonObject).content as unknown[] : [];
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as JsonObject).text === 'string') {
        return String((part as JsonObject).text);
      }
    }
  }
  return '';
}
