import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { GmCatalogCalloutEvidence, GmCatalogPart } from '../src/catalog/gm-catalog.js';
import {
  gmCatalogCalloutPageCandidates,
  renderGmCalloutImage,
  scoreGmCalloutPageLayout
} from '../src/catalog/gm-callout.js';

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

  it('keeps certified page 12 eligible instead of truncating exact evidence to three pages', () => {
    const sourcePages = Array.from({ length: 50 }, (_, index) => 104_977 + index);
    const catalog: GmCatalogPart = {
      partNumber: '9438315',
      manufacturer: 'General Motors',
      divisions: ['Oldsmobile'],
      productType: 'Hose',
      description: 'Hose, fuel-oil evap',
      catalogGroup: '8.962',
      verificationState: 'catalog_stated',
      identityEvidence: {
        method: 'gmpartswiki_exact_part_link',
        verificationState: 'catalog_stated',
        sourcePages
      },
      rollup: {
        occurrenceCount: sourcePages.length,
        pageCount: sourcePages.length,
        catalogStatedOccurrences: sourcePages.length,
        firstPageId: sourcePages[0]!,
        lastPageId: sourcePages.at(-1)!,
        representativePageId: sourcePages[0]!,
        representativeImageRef: null,
        bestLayoutConfidence: 0.97
      },
      applications: [],
      diagrams: []
    };

    const candidates = gmCatalogCalloutPageCandidates(catalog);

    expect(candidates).toHaveLength(32);
    expect(candidates.slice(0, 16)).toEqual(sourcePages.slice(0, 16));
    expect(candidates).toContain(104_988);
  });

  it('ranks an illustration scan above a dense parts-only table', async () => {
    const illustration = readFileSync(new URL('../data/gm-scans/pages/002145/full_page.png', import.meta.url));
    const rows = Array.from({ length: 58 }, (_, index) =>
      `<rect x="80" y="${80 + index * 23}" width="1040" height="11" fill="black"/>`
    ).join('');
    const table = await sharp(Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600"><rect width="1200" height="1600" fill="white"/>${rows}</svg>`
    )).png().toBuffer();

    expect(await scoreGmCalloutPageLayout(illustration))
      .toBeGreaterThan(await scoreGmCalloutPageLayout(table));
  });
});
