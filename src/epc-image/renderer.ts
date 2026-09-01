import sharp from 'sharp';
import type { EpcRenderResult, EpcRenderedCallout, EpcSourceCallout } from './types.js';

export const EPC_CANVAS_WIDTH = 1470;
export const EPC_CANVAS_HEIGHT = 1070;
const ORANGE = '#ff6a00';

function ringSvg(callouts: EpcRenderedCallout[]): Buffer {
  const circles = callouts
    .map((callout) => `<circle cx="${callout.outputX}" cy="${callout.outputY}" r="${callout.outputRadius}"/>`)
    .join('');
  return Buffer.from(
    `<svg width="${EPC_CANVAS_WIDTH}" height="${EPC_CANVAS_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><g fill="none" stroke="${ORANGE}" stroke-width="3">${circles}</g></svg>`
  );
}

function transformCallouts(callouts: EpcSourceCallout[], sourceWidth: number, sourceHeight: number): EpcRenderedCallout[] {
  const scale = Math.min(EPC_CANVAS_WIDTH / sourceWidth, EPC_CANVAS_HEIGHT / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (EPC_CANVAS_WIDTH - renderedWidth) / 2;
  const offsetY = (EPC_CANVAS_HEIGHT - renderedHeight) / 2;
  return callouts.map((callout) => ({
    ...callout,
    outputX: Math.round(offsetX + callout.x * scale),
    outputY: Math.round(offsetY + callout.y * scale),
    outputRadius: Math.max(11, Math.round((callout.radius ?? 16) * scale))
  }));
}

export async function renderEpcDiagram(
  source: Uint8Array,
  callouts: EpcSourceCallout[],
  lineThreshold = 190
): Promise<EpcRenderResult> {
  const rotated = await sharp(source, { limitInputPixels: 80_000_000 }).rotate().png().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (!sourceWidth || !sourceHeight) throw new Error('EPC source dimensions are unavailable');
  for (const callout of callouts) {
    if (callout.x < 0 || callout.y < 0 || callout.x > sourceWidth || callout.y > sourceHeight) {
      throw new Error(`Callout ${callout.ref} is outside the EPC source image`);
    }
  }

  const cleanBase = await sharp(rotated)
    .resize({
      width: EPC_CANVAS_WIDTH,
      height: EPC_CANVAS_HEIGHT,
      fit: 'contain',
      background: '#ffffff',
      withoutEnlargement: false
    })
    .flatten({ background: '#ffffff' })
    .greyscale()
    .normalise({ lower: 1, upper: 99 })
    .threshold(lineThreshold)
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();

  const renderedCallouts = transformCallouts(callouts, sourceWidth, sourceHeight);
  const interactive = await sharp(cleanBase)
    .composite([{ input: ringSvg(renderedCallouts), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  const thumbnail = await sharp(cleanBase)
    .resize({ width: 420, height: 306, fit: 'contain', background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const calloutMap = Buffer.from(`${JSON.stringify({
    version: 1,
    width: EPC_CANVAS_WIDTH,
    height: EPC_CANVAS_HEIGHT,
    callouts: renderedCallouts.map(({ ref, sku, outputX: x, outputY: y, outputRadius: radius }) => ({ ref, ...(sku ? { sku } : {}), x, y, radius }))
  }, null, 2)}\n`);
  return { cleanBase, interactive, thumbnail, calloutMap, callouts: renderedCallouts };
}
