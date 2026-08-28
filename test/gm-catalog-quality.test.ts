import { describe, expect, it } from 'vitest';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';
import {
  assessGmCatalogMapping,
  canonicalOemPartNumber,
  credibleCatalogIdentityText,
  formatOemPartNumber,
  normalizeGmCatalogPart
} from '../src/catalog/gm-catalog-quality.js';

function emptyCatalog(partNumber: string, description: string): GmCatalogPart {
  return {
    partNumber,
    manufacturer: 'General Motors',
    divisions: [],
    productType: description,
    description,
    catalogGroup: '4.898',
    verificationState: 'catalog_stated',
    rollup: {
      occurrenceCount: 1,
      pageCount: 1,
      catalogStatedOccurrences: 1,
      firstPageId: 2163,
      lastPageId: 2163,
      representativePageId: 2163,
      representativeImageRef: 'GM2163-FULL',
      bestLayoutConfidence: 0.91
    },
    applications: [],
    diagrams: []
  };
}

describe('GM catalog exact-key and OCR quality controls', () => {
  it('normalizes OEM display and lookup keys without changing meaningful hyphens', () => {
    expect(formatOemPartNumber(' 13568 – 29025 ')).toBe('13568-29025');
    expect(canonicalOemPartNumber('13568-29025')).toBe('1356829025');
  });

  it('rejects neighboring part numbers and supplier-only OCR fragments', () => {
    expect(credibleCatalogIdentityText('Po 567095 | 5455055', '5455054')).toBeNull();
    expect(credibleCatalogIdentityText('Ail Moraine', '5455055')).toBeNull();
    expect(credibleCatalogIdentityText('SWITCH & BRACKET, lamp', '581167')).toBe('SWITCH & BRACKET, lamp');
  });

  it('never accepts a catalog record keyed to a different normalized OEM number', () => {
    expect(normalizeGmCatalogPart(emptyCatalog('5455054', 'Repair Kit'), '5455055')).toBeUndefined();
  });

  it('retains the first-party page on a catalog-stated exact mapping', () => {
    expect(assessGmCatalogMapping(emptyCatalog('5455998', 'Brake Repair Kit'), '5455998')).toMatchObject({
      state: 'CATALOG_STATED_EXACT',
      sellerFacingAllowed: true,
      sourcePages: [2163]
    });
  });

  it('holds an exact-key OCR candidate until catalog-stated evidence is available', () => {
    const catalog = emptyCatalog('5455999', 'Ail Moraine');
    catalog.verificationState = 'candidate';
    catalog.rollup.catalogStatedOccurrences = 0;

    expect(assessGmCatalogMapping(catalog, '5455999')).toMatchObject({
      state: 'OCR_CANDIDATE_HELD',
      exactKeyMatch: true,
      sellerFacingAllowed: false
    });
    expect(normalizeGmCatalogPart(catalog, '5455999')).toBeUndefined();
  });
});
