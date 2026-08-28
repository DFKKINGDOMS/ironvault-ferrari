import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { GmCatalogPart } from '../src/catalog/gm-catalog.js';
import { buildSellerCommandPreview, parseListingCommand, selectCompatibleVehicleBrand } from '../src/seller/command-preview.js';

const gm5459066 = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-smoke-5459066.json', import.meta.url), 'utf8')
) as GmCatalogPart;
const gm602698 = JSON.parse(
  readFileSync(new URL('../data/gm-catalog-curated-602698.json', import.meta.url), 'utf8')
) as GmCatalogPart;
const baseApplication = gm5459066.applications[0]!;
const baseModel = baseApplication.models[0]!;
const gm581167: GmCatalogPart = {
  ...gm5459066,
  partNumber: '581167',
  divisions: ['Oldsmobile'],
  description: 'SWITCH & BRACKET, lamp',
  productType: 'SWITCH & BRACKET, lamp',
  catalogGroup: '10.275',
  diagrams: [],
  rollup: {
    ...gm5459066.rollup,
    occurrenceCount: 1,
    pageCount: 1,
    firstPageId: 2150,
    lastPageId: 2150,
    representativePageId: 2150,
    representativeImageRef: 'GM2150-FULL'
  },
  applications: [{
    ...baseApplication,
    claimId: 27723,
    division: 'Oldsmobile',
    catalogGroup: '10.275',
    partName: 'SWITCH',
    description: 'SWITCH & BRACKET, lamp',
    groupHeading: null,
    componentFamily: null,
    supplier: null,
    applicationText: '1961-1962',
    yearStart: 1961,
    yearEnd: 1962,
    exclusion: null,
    sourcePageId: 2150,
    imageRef: 'GM2150-FULL',
    imageBlobKey: 'gm-scans/pages/002150/full_page.png',
    layoutLine: '1961 & 1962 exc, F85........... SWITCH & BRACKET, lamp..... 1 581167........',
    models: [1961, 1962].flatMap((year) => ['Dynamic 88', 'F-85', 'Ninety-Eight', 'Starfire', 'Super 88'].map((modelName) => ({
      ...baseModel,
      year,
      division: 'Oldsmobile',
      modelName
    })))
  }]
};
const gm5455054: GmCatalogPart = {
  ...gm5459066,
  partNumber: '5455054',
  divisions: [],
  productType: 'Po 567095 | 5455055',
  description: 'Po 567095 | 5455055',
  catalogGroup: '4.898',
  applications: [],
  diagrams: [],
  rollup: {
    ...gm5459066.rollup,
    firstPageId: 2163,
    lastPageId: 2163,
    representativePageId: 2163,
    representativeImageRef: 'GM2163-FULL'
  }
};
const gm5455055: GmCatalogPart = {
  ...gm5455054,
  partNumber: '5455055',
  productType: 'Ail Moraine',
  description: 'Ail Moraine',
  catalogGroup: '4.658',
  rollup: {
    ...gm5455054.rollup,
    firstPageId: 2164,
    lastPageId: 2164,
    representativePageId: 2164,
    representativeImageRef: 'GM2164-FULL'
  }
};

describe('one-command seller preview', () => {
  it('extracts the primary sample command without making an external request', () => {
    const preview = buildSellerCommandPreview('List part 58487514 on eBay for $9.99 now');
    expect(preview.intent).toMatchObject({
      partNumber: '58487514',
      price: '9.99',
      quantity: 1,
      condition: 'New',
      conditionSource: 'SELLER_DEFAULT_REQUIRES_CONFIRMATION',
      shipping: 'Calculated shipping',
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
      brand: 'General Motors',
      manufacturerPartNumber: '5459066',
      productType: 'Vacuum Power-Brake Air Cleaner/Filter'
    });
    expect(preview.fitment.state).toBe('CATALOG_STATED');
    expect(preview.fitment.applications).toHaveLength(3);
    expect(preview.fitment.applications.map((row) => row.vehicle)).toEqual(expect.arrayContaining([
      '1959 Oldsmobile Dynamic 88',
      '1959 Oldsmobile Ninety-Eight',
      '1959 Oldsmobile Super 88'
    ]));
    expect(preview.media.catalogReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'catalog-row', pageId: 2166, exactPartDepiction: true, viewUrl: '/v1/gm-catalog/pages/2166/image' }),
      expect.objectContaining({ kind: 'diagram', pageId: 2145, callout: 'FRONT ELEMENT', primary: true })
    ]));
    expect(preview.intelligence).toMatchObject({
      category: { state: 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION', categoryName: 'Air Filters' },
      shipping: {
        state: 'ESTIMATED_REQUIRES_CONFIRMATION',
        suggestedPackageIn: { length: 10, width: 8, height: 4 },
        dimensionalWeightLb: 3,
        estimatedBillableWeightLb: 3
      }
    });
    expect(JSON.stringify(preview)).not.toContain('gmpartswiki.com');
    expect(preview.issues.map((issue) => issue.code)).toContain('CATALOG_EVIDENCE_REVIEW_REQUIRED');
    expect(preview.issues.map((issue) => issue.code)).toContain('EBAY_CATEGORY_VERIFICATION_REQUIRED');
    expect(preview.issues.map((issue) => issue.code)).not.toContain('CATALOG_LOOKUP_REQUIRED');
  });

  it('preserves the supplied 602698 catalog row with its full fitment qualifier', () => {
    const preview = buildSellerCommandPreview('List part 602698 for $49.99', gm602698);
    expect(preview.identity).toMatchObject({
      state: 'CATALOG_STATED',
      brand: 'General Motors',
      manufacturerPartNumber: '602698',
      productType: 'Steering Knuckle With Nut'
    });
    expect(preview.fitment.applications).toEqual([
      expect.objectContaining({
        vehicle: '1937–1941 Chevrolet S, T, V, W, Y series',
        qualifier: expect.stringContaining('lower bolt holes are 1/2 inch diameter')
      })
    ]);
    expect(preview.intelligence).toMatchObject({
      category: { categoryName: 'Wheel Hubs, Bearings & Parts' },
      shipping: { profileId: 'P12', productFamilyProfileId: 'steering-knuckle-hub', confirmationRequired: true }
    });
    expect(JSON.stringify(preview)).not.toContain('gmpartswiki.com');
  });

  it('keeps one OEM-keyed 581167 draft, proper-cases OCR and honors the F-85 exclusion', () => {
    const preview = buildSellerCommandPreview('List part 581167 for $29.99', gm581167);
    expect(preview.listing).toMatchObject({
      sku: '581167',
      title: 'GM 581167 Switch & Bracket, Lamp Fits Oldsmobile 1961–1962'
    });
    expect(preview.identity.productType).toBe('Switch & Bracket, Lamp');
    expect(preview.fitment.applications).toHaveLength(8);
    expect(preview.fitment.applications.some((row) => row.vehicle.includes('F-85'))).toBe(false);
    expect(preview.fitment.applications.every((row) => row.qualifier.includes('Excludes F85'))).toBe(true);
    expect(preview.media.catalogReferences).toContainEqual(expect.objectContaining({
      kind: 'catalog-row',
      pageId: 2150,
      viewUrl: '/v1/gm-catalog/pages/2150/image'
    }));
    expect(preview.intelligence).toMatchObject({
      category: {
        state: 'RULE_DERIVED_REQUIRES_EBAY_VERIFICATION',
        categoryName: 'Lighting Switches & Controls',
        categoryId: null
      },
      shipping: {
        source: 'APPROVED_PRODUCT_FAMILY_PRESET',
        profileId: 'P4',
        productFamilyProfileId: 'lighting-switch-control',
        suggestedPackageIn: { length: 8, width: 6, height: 4 },
        confirmationRequired: true
      }
    });
  });

  it('replaces neighboring OCR text with the exact 5455054 catalog curation', () => {
    const preview = buildSellerCommandPreview('List part 5455054 for $49.99', gm5455054);
    expect(preview.identity).toMatchObject({
      state: 'CATALOG_STATED',
      brand: 'General Motors',
      manufacturerPartNumber: '5455054',
      productType: 'Moraine Power Brake Repair Kit'
    });
    expect(preview.listing).toMatchObject({
      sku: '5455054',
      title: 'GM 5455054 Moraine Power Brake Repair Kit Fits Oldsmobile 1955–1957'
    });
    expect(JSON.stringify(preview)).not.toContain('Po 567095');
    expect(preview.fitment.applications).toEqual([
      expect.objectContaining({ vehicle: '1955–1957 Oldsmobile Moraine power-brake equipped vehicles' })
    ]);
    expect(preview.media.catalogReferences).toContainEqual(expect.objectContaining({ pageId: 2153, primary: true }));
    expect(preview.intelligence).toMatchObject({
      category: { state: 'EBAY_TAXONOMY_VERIFIED', categoryName: 'Brake Boosters', categoryId: '174021' },
      shipping: {
        profileId: 'P6',
        suggestedPackageIn: { length: 10, width: 8, height: 4 },
        confirmationRequired: true
      }
    });
  });

  it('maps 5455055 to its own proper OEM identity and held catalog application', () => {
    const preview = buildSellerCommandPreview('List part 5455055 for $49.99', gm5455055);
    expect(preview.identity).toMatchObject({
      state: 'CATALOG_STATED',
      brand: 'General Motors',
      manufacturerPartNumber: '5455055',
      productType: 'Moraine Vacuum Cylinder Repair Kit'
    });
    expect(preview.listing).toMatchObject({
      sku: '5455055',
      title: 'GM 5455055 Moraine Vacuum Cylinder Repair Kit Fits Oldsmobile 1955–1956'
    });
    expect(preview.fitment.applications).toEqual([
      expect.objectContaining({ vehicle: '1955–1956 Oldsmobile Moraine power-brake equipped vehicles' })
    ]);
    expect(preview.media.catalogReferences).toContainEqual(expect.objectContaining({
      pageId: 6761,
      primary: true,
      callout: '5455055',
      imageRef: 'GM6761-FULL',
      imageBlobKey: 'gm-scans/pages/006761/full_page.png',
      evidenceBox: expect.objectContaining({ left: 1737, top: 718, width: 144, height: 33 })
    }));
    expect(preview.intelligence?.category).toMatchObject({
      state: 'EBAY_TAXONOMY_VERIFIED',
      source: 'EBAY_OFFICIAL_CATEGORY_FILE',
      categoryId: '174021',
      categoryName: 'Brake Boosters'
    });
    expect(preview.tariff).toMatchObject({
      state: 'CANDIDATE_REQUIRES_SELLER_REVIEW',
      hsCode: '870830',
      htsCode: '8708.30.50.90',
      sellerConfirmationRequired: true
    });
    expect(preview.recovery.enabled).toBe(false);
    expect(preview.listing.aspects).toMatchObject({
      Brand: 'General Motors',
      'Manufacturer Part Number': '5455055',
      'OE/OEM Part Number': '5455055',
      'California Prop 65 Warning': ''
    });
  });

  it('rejects every catalog-derived field when the returned OEM key differs', () => {
    const preview = buildSellerCommandPreview('List part 5455055 for $49.99', gm5455054);
    expect(preview.identity).toMatchObject({ state: 'NOT_VERIFIED', manufacturerPartNumber: '5455055' });
    expect(preview.listing.sku).toBe('5455055');
    expect(preview.listing.title).toBe('Part 5455055 — catalog identity required');
    expect(preview.issues).toContainEqual(expect.objectContaining({ code: 'CATALOG_PART_NUMBER_MISMATCH' }));
    expect(JSON.stringify(preview)).not.toContain('5455054 Moraine');
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

  it('preserves quantity zero and only accepts price zero as an explicit giveaway', () => {
    const outOfStock = parseListingCommand('List part 5455055 for $49.99 qty 0');
    expect(outOfStock).toMatchObject({ quantity: 0, price: '49.99', saleMode: 'FIXED_PRICE' });

    const invalidZero = buildSellerCommandPreview('List part 5455055 for $0 qty 0', gm5455055);
    expect(invalidZero.issues).toContainEqual(expect.objectContaining({ code: 'ZERO_PRICE_REQUIRES_GIVEAWAY' }));

    const giveaway = buildSellerCommandPreview('Give away part 5455055 qty 0', gm5455055);
    expect(giveaway.intent).toMatchObject({ quantity: 0, price: '0.00', saleMode: 'GIVEAWAY' });
    expect(giveaway.issues).toContainEqual(expect.objectContaining({ code: 'GIVEAWAY_NOT_EBAY_ELIGIBLE' }));
    expect(giveaway.issues.map((issue) => issue.code)).not.toContain('ZERO_PRICE_REQUIRES_GIVEAWAY');
  });

  it('rejects negative and over-precision prices instead of converting partial values', () => {
    expect(parseListingCommand('List part 5455055 for $-5')).toMatchObject({ price: null, saleMode: 'FIXED_PRICE' });
    expect(parseListingCommand('List part 5455055 for $12.345')).toMatchObject({ price: null, saleMode: 'FIXED_PRICE' });
  });

  it('shows VIN recovery only when every supported year is 1989 or newer', () => {
    expect(buildSellerCommandPreview('List part 5455055 for $49.99', gm5455055).recovery.enabled).toBe(false);
    const modern: GmCatalogPart = {
      ...gm5459066,
      partNumber: '9990001',
      applications: gm5459066.applications.map((application) => ({
        ...application,
        yearStart: 1990,
        yearEnd: 1991,
        applicationText: '1990-1991',
        layoutLine: application.layoutLine?.replaceAll('1959', '1990') ?? null,
        models: application.models.map((model) => ({ ...model, year: 1990 }))
      }))
    };
    expect(buildSellerCommandPreview('List part 9990001 for $49.99', modern).recovery.enabled).toBe(true);
  });

  it('chooses one compatible vehicle make deterministically from the strongest catalog evidence', () => {
    const application = gm5459066.applications[0]!;
    const multiDivision: GmCatalogPart = {
      ...gm5459066,
      divisions: ['Oldsmobile', 'Buick'],
      applications: [
        { ...application, claimId: 1, division: 'Buick', models: application.models.map((model) => ({ ...model, division: 'Buick' })) },
        { ...application, claimId: 2, division: 'Oldsmobile', models: [application.models[0]!] }
      ]
    };
    expect(selectCompatibleVehicleBrand(multiDivision)).toBe('Buick');
    expect(selectCompatibleVehicleBrand(multiDivision)).toBe('Buick');
  });

  it('creates a deterministic payload fingerprint', () => {
    const first = buildSellerCommandPreview('List part 58487514 on eBay for $9.99 now');
    const second = buildSellerCommandPreview('List part 58487514 on eBay for $9.99 now');
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it('holds an exact-number OCR candidate until catalog-stated or curated evidence exists', () => {
    const candidate: GmCatalogPart = {
      ...gm5459066,
      partNumber: '9999999',
      verificationState: 'ocr_candidate',
      applications: [],
      diagrams: [],
      rollup: {
        ...gm5459066.rollup,
        catalogStatedOccurrences: 0,
        representativePageId: 9999
      }
    };
    const preview = buildSellerCommandPreview('List part 9999999 for $19.99', candidate);
    expect(preview.mapping).toMatchObject({
      state: 'OCR_CANDIDATE_HELD',
      exactKeyMatch: true,
      sellerFacingAllowed: false
    });
    expect(preview.identity.state).toBe('NOT_VERIFIED');
    expect(preview.issues).toContainEqual(expect.objectContaining({
      code: 'GM_OCR_CANDIDATE_HELD',
      blocking: true
    }));
  });

  it('defaults GMPartsWiki identity to genuine General Motors while qualifying the vehicle make', () => {
    const preview = buildSellerCommandPreview('List part 5455055 for $49.99', gm5455055);
    expect(preview.listing.title).toContain('Fits Oldsmobile');
    expect(preview.listing.title.startsWith('Oldsmobile ')).toBe(false);
    expect(preview.brandPolicy).toMatchObject({
      state: 'COMPLIANT',
      rule: 'GENUINE_BRAND_ALLOWED',
      itemBrand: 'General Motors',
      compatibleBrand: 'Oldsmobile',
      veroParticipant: 'General Motors'
    });
    expect(preview.listing.aspects.Brand).toBe('General Motors');
    expect(preview.listing.aspects['Compatible Vehicle Brand']).toBe('Oldsmobile');
  });

});
