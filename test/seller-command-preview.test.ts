import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';
import { buildSellerCommandPreview, parseListingCommand } from '../src/seller/command-preview.js';

const gm5459066 = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-smoke-5459066.json', import.meta.url), 'utf8')
) as GmCatalogPart;

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

  it('fills catalog identity, model candidates and diagram references from PostgreSQL evidence', () => {
    const preview = buildSellerCommandPreview('List part 5459066 for $9.99', gm5459066);
    expect(preview.status).toBe('HELD');
    expect(preview.identity).toMatchObject({
      state: 'CATALOG_STATED',
      brand: 'Oldsmobile',
      manufacturerPartNumber: '5459066',
      productType: 'Vacuum power-brake air cleaner/filter'
    });
    expect(preview.fitment.state).toBe('CATALOG_STATED');
    expect(preview.fitment.applications).toHaveLength(3);
    expect(preview.fitment.applications.map((row) => row.vehicle)).toEqual(expect.arrayContaining([
      '1959 Oldsmobile Dynamic 88',
      '1959 Oldsmobile Ninety-Eight',
      '1959 Oldsmobile Super 88'
    ]));
    expect(preview.media.catalogReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'catalog-row', pageId: 2166, exactPartDepiction: true }),
      expect.objectContaining({ kind: 'diagram', pageId: 2145, callout: 'FRONT ELEMENT' })
    ]));
    expect(preview.issues.map((issue) => issue.code)).toContain('CATALOG_EVIDENCE_REVIEW_REQUIRED');
    expect(preview.issues.map((issue) => issue.code)).not.toContain('CATALOG_LOOKUP_REQUIRED');
  });

  it('routes an item without a part number to photo-first intake', () => {
    const preview = buildSellerCommandPreview('List a used black dashboard for $49.99');
    expect(preview.status).toBe('PHOTO_REQUIRED');
    expect(preview.intent).toMatchObject({
      partNumber: null,
      itemDescription: 'Black Dashboard',
      route: 'PHOTO_FIRST',
      safetyClass: 'STANDARD',
      price: '49.99',
      condition: 'Used',
      conditionSource: 'COMMAND'
    });
    expect(preview.listing.title).toBe('Black Dashboard — Photos required');
    expect(preview.listing.category).toBeNull();
    expect(preview.media.minimumPhotos).toBe(3);
    expect(preview.media.requiredViews.map((view) => view.id)).toEqual(['whole-item', 'reverse', 'label']);
    expect(preview.issues.map((issue) => issue.code)).toContain('PHOTO_IDENTIFICATION_REQUIRED');
    expect(preview.issues.map((issue) => issue.code)).not.toContain('PART_NUMBER_REQUIRED');
    expect(preview.gates.privatePreflight).toBe('HELD');
  });

  it('places possible airbags and restraint items behind the restricted-item gate', () => {
    const preview = buildSellerCommandPreview('List 1990 Corvette airbag for 49.99');
    expect(preview.status).toBe('SAFETY_REVIEW_REQUIRED');
    expect(preview.intent).toMatchObject({
      partNumber: null,
      itemDescription: '1990 Corvette Airbag',
      route: 'SAFETY_REVIEW',
      safetyClass: 'RESTRAINT_SYSTEM',
      price: '49.99',
      condition: 'Not specified',
      conditionSource: 'REQUIRES_SELLER_SELECTION'
    });
    expect(preview.identity.state).toBe('SAFETY_REVIEW_PENDING');
    expect(preview.media.state).toBe('LABEL_AND_PHOTOS_REQUIRED');
    expect(preview.media.minimumPhotos).toBe(4);
    expect(preview.policy).toMatchObject({
      state: 'RESTRICTED_ITEM_HOLD',
      label: 'eBay airbag eligibility review required'
    });
    expect(preview.policy.requirements).toHaveLength(5);
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'RESTRICTED_RESTRAINT_REVIEW_REQUIRED', blocking: true }));
    expect(preview.recovery.enabled).toBe(false);
    expect(preview.gates.privatePreflight).toBe('HELD');
  });

  it('keeps the safety gate even when a restraint command includes a part number', () => {
    const preview = buildSellerCommandPreview('List airbag part 12345-AB100 for $89.00');
    expect(preview.intent.partNumber).toBe('12345-AB100');
    expect(preview.intent.route).toBe('SAFETY_REVIEW');
    expect(preview.status).toBe('SAFETY_REVIEW_REQUIRED');
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
