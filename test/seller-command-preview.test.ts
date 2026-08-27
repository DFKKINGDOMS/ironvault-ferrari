import { describe, expect, it } from 'vitest';
import { buildSellerCommandPreview, parseListingCommand } from '../src/seller/command-preview.js';

describe('one-command seller preview', () => {
  it('extracts the primary sample command without making an external request', () => {
    const preview = buildSellerCommandPreview('List part 58487514 on eBay for $9.99 now');
    expect(preview.intent).toMatchObject({
      partNumber: '58487514',
      price: '9.99',
      quantity: 1,
      condition: 'New',
      conditionSource: 'SELLER_DEFAULT_REQUIRES_CONFIRMATION',
      shipping: 'Seller default',
      fitmentMode: 'CATALOG_CONTROLLED'
    });
    expect(preview.status).toBe('ILLUSTRATIVE_SAMPLE');
    expect(preview.identity.state).toBe('ILLUSTRATIVE_NOT_EVIDENCE');
    expect(preview.fitment.state).toBe('NOT_VERIFIED');
    expect(preview.fitment.applications.every((row) => row.state === 'NOT_VERIFIED')).toBe(true);
    expect(preview.media.state).toBe('SELLER_PHOTO_REQUIRED');
    expect(preview.gates.publicEbayWrite).toBe('DISABLED');
    expect(preview.noExternalRequestMade).toBe(true);
    expect(preview.issues.map((issue) => issue.code)).toContain('ILLUSTRATIVE_DATA_ONLY');
  });

  it('holds every unknown identity instead of fabricating listing fields', () => {
    const preview = buildSellerCommandPreview('List part 13568-29025 for $79.95');
    expect(preview.status).toBe('HELD');
    expect(preview.identity).toMatchObject({
      state: 'NOT_VERIFIED',
      brand: null,
      productType: null,
      manufacturerPartNumber: '13568-29025'
    });
    expect(preview.listing.category).toBeNull();
    expect(preview.fitment.totalApplications).toBe(0);
    expect(preview.gates.privatePreflight).toBe('HELD');
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'CATALOG_LOOKUP_REQUIRED', blocking: true }));
  });

  it('understands quantity, condition, pickup and the no-fitment instruction', () => {
    expect(parseListingCommand('Sell three F3TZ-15200 used for $72.60 local pickup only no fitment')).toMatchObject({
      partNumber: 'F3TZ-15200',
      price: '72.60',
      quantity: 3,
      condition: 'Used',
      conditionSource: 'COMMAND',
      shipping: 'Local pickup only',
      fitmentMode: 'DO_NOT_PUBLISH'
    });
  });

  it('creates a deterministic payload fingerprint', () => {
    const first = buildSellerCommandPreview('List part 58487514 on eBay for $9.99 now');
    const second = buildSellerCommandPreview('List part 58487514 on eBay for $9.99 now');
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
  });
});
