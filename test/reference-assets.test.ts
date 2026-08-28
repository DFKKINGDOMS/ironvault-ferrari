import { describe, expect, it } from 'vitest';
import { referenceAssetFilename, referenceAssetUrl } from '../src/ebay/reference-assets.js';

describe('permanent reference asset naming', () => {
  it('uses the SKU for the first image and numeric suffixes for later images', () => {
    expect(referenceAssetFilename('5455055', 0)).toBe('5455055.png');
    expect(referenceAssetFilename('5455055', 1)).toBe('5455055_1.png');
    expect(referenceAssetFilename('5455055', 2)).toBe('5455055_2.png');
  });

  it('preserves ordinary hyphenated OEM SKUs in permanent URLs', () => {
    expect(referenceAssetUrl('13568-29025', 0)).toBe('/v1/reference-assets/13568-29025.png');
    expect(referenceAssetUrl('13568-29025', 3)).toBe('/v1/reference-assets/13568-29025_3.png');
  });
});
