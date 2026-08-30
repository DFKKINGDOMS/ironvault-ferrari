import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { GmCatalogCalloutEvidence } from '../src/catalog/gm-catalog.js';
import { renderGmCalloutImage } from '../src/catalog/gm-callout.js';

describe('GM catalog callout image renderer', () => {
  it('renders every exact callout in orange while preserving the source scan', async () => {
    const scan = readFileSync(new URL('../data/gm-scans/pages/002145/full_page.png', import.meta.url));
    const evidence: GmCatalogCalloutEvidence = {
      state: 'EXACT_ROW_AND_CALLOUT',
      partNumber: '9438315',
      pageId: 2145,
      calloutId: '9',
      catalogGroup: '8.962',
      description: 'HOSE, FUEL-OIL EVAP',
      rowBox: { left: 100, top: 2100, width: 900, height: 45, image_width: 3300, image_height: 2550 },
      rowConfidence: 0.92,
      calloutBoxes: [
        { left: 400, top: 300, width: 90, height: 90, image_width: 3300, image_height: 2550, confidence: 0.95 },
        { left: 2100, top: 900, width: 90, height: 90, image_width: 3300, image_height: 2550, confidence: 0.91 }
      ],
      sourceImageUrl: '/v1/gm-catalog/pages/2145/image',
      annotatedImageUrl: '/v1/gm-catalog/parts/9438315/callout-image',
      method: 'CERTIFIED_ROW_SPATIAL_OCR'
    };

    const rendered = await renderGmCalloutImage(scan, evidence);
    const metadata = await sharp(rendered).metadata();
    const firstCenter = await sharp(rendered)
      .extract({ left: 440, top: 340, width: 10, height: 10 })
      .stats();

    expect(metadata).toMatchObject({ format: 'png', width: 3300, height: 2550 });
    expect(rendered.equals(scan)).toBe(false);
    expect(firstCenter.channels[0]!.mean).toBeGreaterThan(firstCenter.channels[2]!.mean);
  });
});
