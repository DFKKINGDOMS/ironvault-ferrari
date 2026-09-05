import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import { assessGmCatalogMapping, canonicalOemPartNumber, formatOemPartNumber, normalizeGmCatalogPart, type GmCatalogMappingAssessment } from '../catalog/gm-catalog-quality.js';
import { buildCatalogListingIntelligence, type CatalogListingIntelligence } from '../catalog/listing-intelligence.js';
import { buildTariffIntelligence, type TariffIntelligence } from '../catalog/tariff-intelligence.js';
import type { AppConfig } from '../config.js';
import { applyEbayBrandTitlePolicy, EBAY_INTELLECTUAL_PROPERTY_POLICY_URL, EBAY_VERO_PROFILE_INDEX_URL, type BrandTitlePolicyResult } from '../ebay/brand-title-policy.js';
import type { PublicShopifyMediaMatch } from '../shopify-media/types.js';

export const listingCommandRequestSchema = z.object({
  command: z.string().trim().min(3).max(500)
});

const quantityWords: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

export type ListingCommandRoute = 'CATALOG_ASSISTED' | 'PHOTO_FIRST' | 'SAFETY_REVIEW';
export type CommandPreviewStatus = 'ILLUSTRATIVE_SAMPLE' | 'HELD' | 'PHOTO_REQUIRED' | 'SAFETY_REVIEW_REQUIRED';

export interface ListingCommandIntent {
  partNumber: string | null;
  itemDescription: string | null;
  route: ListingCommandRoute;
  safetyClass: 'STANDARD' | 'RESTRAINT_SYSTEM';
  price: string | null;
  saleMode: 'FIXED_PRICE' | 'GIVEAWAY';
  quantity: number;
  condition: 'New' | 'Used' | 'Remanufactured' | 'Not specified';
  conditionSource: 'COMMAND' | 'SELLER_DEFAULT_REQUIRES_CONFIRMATION' | 'REQUIRES_SELLER_SELECTION';
  shipping: 'Seller default' | 'Free domestic shipping' | 'Calculated shipping' | 'Local pickup only';
  fitmentMode: 'CATALOG_CONTROLLED' | 'DO_NOT_PUBLISH';
  channel: 'eBay';
}

export interface SellerCommandPreview {
  schemaVersion: '2026-08-30';
  status: CommandPreviewStatus;
  command: string;
  intent: ListingCommandIntent;
  listing: {
    title: string;
    titleLength: number;
    format: 'Buy It Now · GTC';
    sku: string | null;
    description: string;
    category: string | null;
    categoryId: string | null;
    aspects: Record<string, string>;
    handlingTime: '3 business days';
    returns: '30 days · buyer-paid';
    international: 'Held until origin is verified';
  };
  identity: {
    state: 'ILLUSTRATIVE_NOT_EVIDENCE' | 'CATALOG_STATED' | 'NOT_VERIFIED' | 'PHOTO_IDENTIFICATION_PENDING' | 'SAFETY_REVIEW_PENDING';
    brand: string | null;
    manufacturerPartNumber: string | null;
    productType: string | null;
    sourceLabel: string;
    sourceDetail: string;
  };
  fitment: {
    state: 'CATALOG_STATED' | 'NOT_VERIFIED' | 'OMITTED_BY_SELLER';
    totalApplications: number;
    sourceLabel: string;
    sourceDetail: string;
    applications: Array<{ vehicle: string; qualifier: string; state: 'CATALOG_STATED' | 'CATALOG_DERIVED' | 'NOT_VERIFIED' }>;
  };
  media: {
    state: 'SELLER_PHOTO_REQUIRED' | 'LABEL_AND_PHOTOS_REQUIRED';
    sourceLabel: string;
    sourceDetail: string;
    minimumPhotos: number;
    requiredViews: Array<{ id: string; label: string; detail: string; required: boolean }>;
    analysisState: 'NOT_UPLOADED';
    catalogReferences: Array<{
      kind: 'catalog-row' | 'diagram';
      pageId: number;
      label: string;
      viewUrl: string;
      listingImageUrl: string | null;
      imageRef: string | null;
      imageBlobKey: string | null;
      callout: string | null;
      confidence: number | null;
      exactPartDepiction: boolean;
      primary: boolean;
      evidenceBox: Record<string, unknown> | null;
      displayRotationDegrees: number | null;
      relationshipState: string;
    }>;
    primaryListingImage: {
      url: string;
      name: string;
      pageId: number;
      calloutId: string;
      source: 'FIRST_PARTY_CATALOG_CALLOUT';
      rightsState: 'FIRST_PARTY_CATALOG_EVIDENCE';
    } | null;
    merchantMedia: PublicShopifyMediaMatch | null;
  };
  intelligence: CatalogListingIntelligence | null;
  tariff: TariffIntelligence | null;
  mapping: GmCatalogMappingAssessment;
  brandPolicy: BrandTitlePolicyResult | null;
  confirmations: Array<{ id: string; label: string; detail: string }>;
  issues: Array<{ code: string; message: string; blocking: boolean }>;
  recovery: {
    label: 'Find the correct part for a vehicle';
    enabled: boolean;
    requires: ['17-character VIN', 'part type'];
    privacyNote: string;
  };
  policy: {
    state: 'STANDARD_REVIEW' | 'RESTRICTED_ITEM_HOLD';
    label: string;
    sourceUrl: string | null;
    requirements: string[];
  };
  gates: {
    privatePreflight: 'SIMULATION_AVAILABLE' | 'HELD';
    publicEbayWrite: 'DISABLED';
    ebayHandoffUrl: 'https://www.ebay.com/';
  };
  noExternalRequestMade: boolean;
  fingerprint: string;
}

function normalizePrice(value: string | undefined): string | null {
  if (!value) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) return null;
  return parsed.toFixed(2);
}

function quantityFrom(value: string | undefined): number {
  if (!value) return 1;
  const normalized = value.toLowerCase();
  const parsed = quantityWords[normalized] ?? Number(normalized);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 999 ? parsed : 1;
}

function findPartNumber(command: string): string | null {
  const explicit = command.match(
    /\b(?:part|mpn|oem(?:\s+part)?(?:\s+number)?)\s*(?:number|no\.?)?\s*[:#-]?\s*([a-z0-9][a-z0-9-]{3,})\b/i
  )?.[1];
  if (explicit && /\d/.test(explicit)) return formatOemPartNumber(explicit);

  const candidate = command
    .match(/\b[a-z0-9][a-z0-9-]{4,}\b/gi)
    ?.find((token) => /\d/.test(token) && !/^\d{1,4}$/.test(token));
  return candidate ? formatOemPartNumber(candidate) : null;
}

const restraintPattern = /\b(?:air\s*bag|airbag|srs|inflator|pretensioner|supplemental\s+restraint)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCaseSellerText(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => /^\d{2,4}$/.test(word) || /^(?:OEM|OE|SRS|ABS)$/i.test(word)
      ? word.toUpperCase()
      : `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

const catalogTitleAcronyms = new Set([
  'A/C', 'ABS', 'AC', 'COE', 'DC', 'GM', 'HD', 'LH', 'NOS', 'OE', 'OEM', 'RH', 'SRS'
]);

/**
 * Catalog OCR is commonly stored in all caps. Convert human-readable words to
 * title case while preserving part-like tokens and automotive abbreviations.
 */
export function properCaseCatalogText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((token) => token.replace(/[A-Za-z]+/g, (word) => {
      const upper = word.toUpperCase();
      if (catalogTitleAcronyms.has(upper) || /\d/.test(word)) return upper;
      return `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`;
    }))
    .join(' ');
}

function findItemDescription(command: string, partNumber: string | null): string | null {
  let value = command
    .replace(/\b(?:and\s+)?i\s+(?:want|would\s+like)\s+to\s+(?:list|sell|draft)\s+(?:it|this)(?:\s+now)?\b/gi, ' ')
    .replace(/\b(?:list|sell|draft)\s+(?:it|this)\b/gi, ' ')
    .replace(/\$\s*-?\d+(?:\.\d+)?/g, ' ')
    .replace(/\b(?:for|at|price(?:d)?(?:\s+at)?)\s+-?\d+(?:\.\d+)?\b/gi, ' ')
    .replace(/\b(?:local\s+pickup\s+only|free\s+(?:domestic\s+)?shipping|calculated\s+shipping|no\s+fitment|without\s+fitment)\b/gi, ' ')
    .replace(/\b(?:on\s+)?ebay\b/gi, ' ')
    .replace(/\b(?:now|please)\b/gi, ' ')
    .replace(/^\s*(?:list|sell|draft|create\s+(?:an?\s+)?listing\s+for)\s+/i, '')
    .replace(/^\s*(?:an?|the)\s+/i, '')
    .replace(/^\s*i\s+have\s+(?:an?|the)?\s*/i, '')
    .replace(/^\s*(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+/i, '')
    .replace(/\b(?:it\s+is|it's|its)\s+(black|white|gray|grey|red|blue|green|tan|beige|brown|silver)\b/gi, '$1')
    .replace(/\b(?:new|used|remanufactured|reman)\b/gi, ' ');

  if (partNumber) {
    value = value
      .replace(new RegExp(`\\b${escapeRegExp(partNumber)}\\b`, 'gi'), ' ')
      .replace(/\b(?:part|mpn|oem)(?:\s+(?:number|no))?\s*[:#-]?\b/gi, ' ');
  }

  value = value
    .replace(/\b(?:qty|quantity)\s*[:=]?\s*\d+\b/gi, ' ')
    .replace(/\s+(?:and|for|at)\s*$/i, '')
    .replace(/[^a-z0-9&/+'-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value || /^(?:part|item)$/i.test(value)) return null;
  return titleCaseSellerText(value).slice(0, 72).trim();
}

export function parseListingCommand(command: string): ListingCommandIntent {
  const normalized = command.toLowerCase();
  const saleMode = 'FIXED_PRICE' as const;
  const explicitPrice = command.match(/\$\s*(-?\d+(?:\.\d+)?)(?![\d.])/)?.[1]
    ?? command.match(/\b(?:for|at|price(?:d)?(?:\s+at)?)\s+(-?\d+(?:\.\d+)?)(?![\d.])/i)?.[1];
  const quantityValue = command.match(/\b(?:quantity|qty)\s*[:=]?\s*(\d+)\b/i)?.[1]
    ?? command.match(/\b(?:sell|list|draft)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i)?.[1];
  const explicitCondition = /\bused\b/.test(normalized)
    ? 'Used' as const
    : /\breman(?:ufactured)?\b/.test(normalized)
      ? 'Remanufactured' as const
      : /\bnew\b/.test(normalized)
        ? 'New' as const
        : null;
  const shipping = normalized.includes('local pickup only')
    ? 'Local pickup only' as const
    : normalized.includes('free shipping')
      ? 'Free domestic shipping' as const
      : normalized.includes('calculated shipping')
        ? 'Calculated shipping' as const
        : 'Calculated shipping' as const;

  const partNumber = findPartNumber(command);
  const safetyClass = restraintPattern.test(command) ? 'RESTRAINT_SYSTEM' as const : 'STANDARD' as const;
  const route: ListingCommandRoute = safetyClass === 'RESTRAINT_SYSTEM'
    ? 'SAFETY_REVIEW'
    : partNumber
      ? 'CATALOG_ASSISTED'
      : 'PHOTO_FIRST';

  const parsedPrice = normalizePrice(explicitPrice);
  const price = parsedPrice && Number(parsedPrice) >= 0.99 ? parsedPrice : '0.99';
  return {
    partNumber,
    itemDescription: findItemDescription(command, partNumber),
    route,
    safetyClass,
    price,
    saleMode,
    quantity: quantityFrom(quantityValue),
    condition: explicitCondition ?? (route === 'CATALOG_ASSISTED' ? 'New' : 'Not specified'),
    conditionSource: explicitCondition
      ? 'COMMAND'
      : route === 'CATALOG_ASSISTED'
        ? 'SELLER_DEFAULT_REQUIRES_CONFIRMATION'
        : 'REQUIRES_SELLER_SELECTION',
    shipping,
    fitmentMode: /\bno\s+fitment\b|\bwithout\s+fitment\b/.test(normalized) ? 'DO_NOT_PUBLISH' : 'CATALOG_CONTROLLED',
    channel: 'eBay'
  };
}

function titleGuard(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) return normalized;
  return normalized.slice(0, 80).replace(/\s+\S*$/, '').trim();
}

function buildDescription(intent: ListingCommandIntent, productType: string | null): string {
  if (intent.route === 'SAFETY_REVIEW') {
    return `Seller described this item as “${intent.itemDescription ?? 'a possible restraint-system component'}.” It remains blocked from listing assembly until restricted-item eligibility, a readable OEM label, donor-vehicle VIN, recall status, deployment status and compliant hazmat shipping are verified.`;
  }
  if (intent.route === 'PHOTO_FIRST') {
    return `Seller described this item as “${intent.itemDescription ?? 'an unidentified automotive item'}.” Add seller-owned photos of the whole item, reverse or connectors, and every readable label or marking. Brand, part number, category and vehicle compatibility remain blank until supported.`;
  }
  const identity = productType ?? 'Automotive replacement part';
  const number = intent.partNumber ?? 'not yet identified';
  return `${identity}, part ${number}. Quantity ${intent.quantity}. Condition is set to ${intent.condition} and must be confirmed against the physical item. Unsupported fitment, origin, contents and media claims remain excluded until evidence is attached.`;
}

function catalogYears(catalog: GmCatalogPart): string | null {
  const years = catalog.applications.flatMap((application) => {
    if (application.yearStart == null) return [];
    return [application.yearEnd && application.yearEnd !== application.yearStart
      ? `${application.yearStart}–${application.yearEnd}`
      : String(application.yearStart)];
  });
  return [...new Set(years)].slice(0, 3).join(', ') || null;
}

/** Choose one compatible vehicle brand deterministically from catalog evidence. */
export function selectCompatibleVehicleBrand(catalog: GmCatalogPart): string | null {
  const divisionOrder = new Map(catalog.divisions.map((division, index) => [division, index]));
  const counts = new Map<string, number>();
  for (const division of catalog.divisions) counts.set(division, counts.get(division) ?? 0);
  for (const application of catalog.applications) {
    if (application.division) counts.set(application.division, (counts.get(application.division) ?? 0) + 2);
    for (const model of application.models) {
      if (model.division) counts.set(model.division, (counts.get(model.division) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([left, leftCount], [right, rightCount]) =>
      rightCount - leftCount
      || (divisionOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (divisionOrder.get(right) ?? Number.MAX_SAFE_INTEGER)
      || left.localeCompare(right)
    )[0]?.[0] ?? null;
}

function catalogIncludesPre1989Vehicle(catalog: GmCatalogPart): boolean {
  return catalog.applications.some((application) => {
    if (
      (application.yearStart != null && application.yearStart < 1989)
      || (application.yearEnd != null && application.yearEnd < 1989)
      || application.models.some((model) => model.year != null && model.year < 1989)
    ) return true;
    const decodedYears = [application.applicationText, application.modelScope, application.layoutLine]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => [...value.matchAll(/\b(?:18|19|20)\d{2}\b/g)].map((match) => Number(match[0])));
    return decodedYears.some((year) => year < 1989);
  });
}

function decodedApplicationExclusion(application: GmCatalogPart['applications'][number]): string | null {
  if (application.exclusion?.trim()) return application.exclusion.trim();
  const layoutExclusion = application.layoutLine?.match(
    /\b(?:exc(?:ept)?|excl(?:uding)?)\.?\s*,?\s*([a-z0-9][a-z0-9 -]*?)(?=\.{2,}|\s{3,}|$)/i
  )?.[1]?.trim();
  return layoutExclusion || null;
}

function normalizedModelToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function modelIsExcluded(modelName: string, exclusion: string | null): boolean {
  if (!exclusion) return false;
  const normalizedModel = normalizedModelToken(modelName);
  return exclusion
    .split(/[,;/]|\band\b|&/i)
    .map(normalizedModelToken)
    .filter(Boolean)
    .some((token) => token === normalizedModel || token.includes(normalizedModel));
}

function catalogFitmentApplications(catalog: GmCatalogPart): SellerCommandPreview['fitment']['applications'] {
  const rows: SellerCommandPreview['fitment']['applications'] = [];
  const seen = new Set<string>();
  for (const application of catalog.applications) {
    const decodedExclusion = decodedApplicationExclusion(application);
    const yearText = application.yearStart == null
      ? application.applicationText ?? 'Year not decoded'
      : application.yearEnd && application.yearEnd !== application.yearStart
        ? `${application.yearStart}–${application.yearEnd}`
        : String(application.yearStart);
    const qualifier = [
      application.description,
      application.supplier ? `${application.supplier} system` : null,
      application.equipmentQualifier,
      decodedExclusion ? `Excludes ${decodedExclusion}` : null,
      `Catalog page ${application.sourcePageId}`
    ].filter(Boolean).join(' · ');
    if (application.models.length) {
      for (const model of application.models) {
        if (modelIsExcluded(model.modelName, decodedExclusion)) continue;
        const vehicle = [model.year ?? yearText, model.division ?? application.division, model.modelName]
          .filter(Boolean)
          .join(' ');
        const key = `${vehicle}|${qualifier}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ vehicle, qualifier, state: 'CATALOG_DERIVED' });
        }
      }
    } else {
      const vehicle = [yearText, application.division ?? catalog.divisions.join('/'), application.modelScope ?? 'catalog application']
        .filter(Boolean)
        .join(' ');
      const key = `${vehicle}|${qualifier}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ vehicle, qualifier, state: 'CATALOG_STATED' });
      }
    }
  }
  return rows;
}

function catalogReferences(catalog: GmCatalogPart): SellerCommandPreview['media']['catalogReferences'] {
  const calloutEvidence = catalog.calloutEvidence;
  const calloutReference = calloutEvidence ? [{
    kind: 'diagram' as const,
    pageId: calloutEvidence.pageId,
    label: `GM illustration · exact callout ${calloutEvidence.calloutId}`,
    viewUrl: calloutEvidence.annotatedImageUrl,
    listingImageUrl: calloutEvidence.annotatedImageUrl,
    imageRef: `GM${calloutEvidence.pageId}-CALLOUT-${calloutEvidence.calloutId}`,
    imageBlobKey: null,
    callout: calloutEvidence.calloutId,
    confidence: Math.min(calloutEvidence.rowConfidence, ...calloutEvidence.calloutBoxes.map((box) => box.confidence ?? 0.75)),
    exactPartDepiction: true,
    primary: true,
    // The primary asset is already rendered with every matching callout.
    // Avoid drawing a second browser-side ring over the first occurrence.
    evidenceBox: null,
    displayRotationDegrees: null,
    relationshipState: 'exact_row_spatial_callout'
  }] : [];
  const rowReferences = catalog.applications.map((application, index) => ({
    kind: 'catalog-row' as const,
    pageId: application.sourcePageId,
    label: `${application.catalogTitle ?? 'GM catalog'} · Group ${application.catalogGroup ?? 'not decoded'}`,
    viewUrl: `/v1/gm-catalog/pages/${application.sourcePageId}/image`,
    listingImageUrl: null,
    imageRef: application.imageRef,
    imageBlobKey: application.imageBlobKey,
    callout: catalog.partNumber,
    confidence: application.confidence,
    exactPartDepiction: true,
    primary: !calloutEvidence && catalog.diagrams.length === 0 && index === 0,
    evidenceBox: application.evidenceBox,
    displayRotationDegrees: null,
    relationshipState: 'catalog_stated_row'
  }));
  const diagramReferences = catalog.diagrams.map((diagram) => ({
    kind: 'diagram' as const,
    pageId: diagram.pageId,
    label: diagram.title ?? `GM illustration · Group ${diagram.catalogGroup ?? 'not decoded'}`,
    viewUrl: `/v1/gm-catalog/pages/${diagram.pageId}/image`,
    listingImageUrl: null,
    imageRef: diagram.imageRef,
    imageBlobKey: diagram.imageBlobKey,
    callout: diagram.calloutLabel,
    confidence: diagram.confidence,
    exactPartDepiction: diagram.exactPartDepiction,
    primary: !calloutEvidence && diagram.isPrimary,
    evidenceBox: diagram.evidenceBox,
    displayRotationDegrees: diagram.displayRotationDegrees,
    relationshipState: diagram.relationshipState
  }));
  const references: SellerCommandPreview['media']['catalogReferences'] = [
    ...calloutReference,
    ...diagramReferences,
    ...rowReferences
  ];
  if (!rowReferences.length && catalog.rollup.representativePageId) {
    const pageId = catalog.rollup.representativePageId;
    references.push({
      kind: 'catalog-row' as const,
      pageId,
      label: `GM catalog exact part-number occurrence · Group ${catalog.catalogGroup ?? 'not decoded'}`,
      viewUrl: `/v1/gm-catalog/pages/${pageId}/image`,
      listingImageUrl: null,
      imageRef: catalog.rollup.representativeImageRef,
      imageBlobKey: catalog.rollup.representativeImageRef
        ? `gm-scans/pages/${String(pageId).padStart(6, '0')}/full_page.png`
        : null,
      callout: catalog.partNumber,
      confidence: catalog.rollup.bestLayoutConfidence,
      exactPartDepiction: true,
      primary: !calloutEvidence && diagramReferences.length === 0,
      evidenceBox: null,
      displayRotationDegrees: null,
      relationshipState: 'exact_part_number_occurrence'
    });
  }
  const unique = new Map<string, (typeof references)[number]>();
  for (const reference of references) {
    const key = `${reference.kind}|${reference.pageId}|${reference.callout ?? ''}`;
    if (!unique.has(key)) unique.set(key, reference);
  }
  return [...unique.values()];
}

export function buildSellerCommandPreview(
  command: string,
  gmCatalog?: GmCatalogPart,
  suppliedIntelligence?: CatalogListingIntelligence,
  suppliedMapping?: GmCatalogMappingAssessment,
  merchantMedia: PublicShopifyMediaMatch | null = null
): SellerCommandPreview {
  const intent = parseListingCommand(command);
  const mapping = suppliedMapping ?? assessGmCatalogMapping(gmCatalog, intent.partNumber);
  const isSafetyReview = intent.route === 'SAFETY_REVIEW';
  const isPhotoFirst = intent.route === 'PHOTO_FIRST';
  const isIllustrativeFixture = intent.partNumber === '58487514' && !isSafetyReview;
  const catalogMatch = !isSafetyReview && !isPhotoFirst && !isIllustrativeFixture
    ? normalizeGmCatalogPart(gmCatalog, intent.partNumber)
    : undefined;
  const catalogNumberMismatch = Boolean(
    gmCatalog
    && intent.partNumber
    && canonicalOemPartNumber(gmCatalog.partNumber) !== canonicalOemPartNumber(intent.partNumber)
  );
  const intelligence = catalogMatch
    ? suppliedIntelligence ?? buildCatalogListingIntelligence(catalogMatch)
    : null;
  const tariff = catalogMatch ? buildTariffIntelligence(catalogMatch) : null;
  const omittedFitment = intent.fitmentMode === 'DO_NOT_PUBLISH';
  const status: CommandPreviewStatus = isSafetyReview
    ? 'SAFETY_REVIEW_REQUIRED'
    : isPhotoFirst
      ? 'PHOTO_REQUIRED'
      : isIllustrativeFixture
        ? 'ILLUSTRATIVE_SAMPLE'
        : 'HELD';
  const identity = isIllustrativeFixture
    ? {
        state: 'ILLUSTRATIVE_NOT_EVIDENCE' as const,
        brand: 'ACDelco',
        manufacturerPartNumber: intent.partNumber,
        productType: 'Cabin Air Filter',
        sourceLabel: 'Illustrative catalog-adapter fixture',
        sourceDetail: 'Shows the approved filled state. It is not live catalog evidence and cannot authorize an eBay claim.'
      }
    : catalogMatch
      ? {
          state: 'CATALOG_STATED' as const,
          brand: catalogMatch.manufacturer || 'General Motors',
          manufacturerPartNumber: intent.partNumber,
          productType: catalogMatch.productType ? properCaseCatalogText(catalogMatch.productType) : null,
          sourceLabel: `GM catalog scan · page ${catalogMatch.rollup.representativePageId ?? catalogMatch.rollup.firstPageId}`,
          sourceDetail: catalogMatch.description
            ? `${properCaseCatalogText(catalogMatch.description)} is stated in GM group ${catalogMatch.catalogGroup ?? 'not decoded'}. Evidence is preserved separately from seller condition and marketplace compatibility.`
            : `Exact part number ${intent.partNumber} occurs in GM group ${catalogMatch.catalogGroup ?? 'not decoded'}. Its OCR description is held because it is not reliable enough for a seller title.`
        }
      : isSafetyReview
      ? {
          state: 'SAFETY_REVIEW_PENDING' as const,
          brand: null,
          manufacturerPartNumber: intent.partNumber,
          productType: null,
          sourceLabel: 'Restricted restraint item · evidence required',
          sourceDetail: 'No identity, category or compatibility claim can publish until PartQuill verifies the item label and every eBay airbag eligibility requirement.'
        }
      : isPhotoFirst
        ? {
            state: 'PHOTO_IDENTIFICATION_PENDING' as const,
            brand: null,
            manufacturerPartNumber: null,
            productType: null,
            sourceLabel: 'Photo-first seller intake',
            sourceDetail: 'A part number is optional for this path. Seller-owned photos and a few physical-item facts are required before identity can be reviewed.'
          }
        : {
        state: 'NOT_VERIFIED' as const,
        brand: null,
        manufacturerPartNumber: intent.partNumber,
        productType: null,
        sourceLabel: 'Catalog identity not verified',
        sourceDetail: 'A unique authorized catalog result is required before brand, product type, category or fitment can publish.'
          };
  const compatibleBrand = catalogMatch ? selectCompatibleVehicleBrand(catalogMatch) : null;
  const brandPolicy = isIllustrativeFixture
    ? applyEbayBrandTitlePolicy({
        itemBrand: 'ACDelco',
        compatibleBrand: null,
        relationship: 'GENUINE_BRANDED_ITEM',
        manufacturerPartNumber: intent.partNumber ?? '',
        productName: 'Cabin Air Filter OE Replacement',
        applicationYears: null
      })
    : catalogMatch
      ? applyEbayBrandTitlePolicy({
          itemBrand: catalogMatch.manufacturer || 'General Motors',
          compatibleBrand,
          relationship: 'GENUINE_BRANDED_ITEM',
          manufacturerPartNumber: identity.manufacturerPartNumber ?? catalogMatch.partNumber,
          productName: properCaseCatalogText(catalogMatch.description ?? catalogMatch.productType ?? 'Automotive Part'),
          applicationYears: catalogYears(catalogMatch)
        })
      : null;
  const title = titleGuard(
    brandPolicy?.title
      || (isSafetyReview
        ? `${intent.itemDescription ?? 'Possible airbag or restraint item'} — Safety review required`
        : isPhotoFirst
          ? `${intent.itemDescription ?? 'Unidentified automotive item'} — Photos required`
          : `Part ${intent.partNumber} — catalog identity required`)
  );
  const fitmentApplications: SellerCommandPreview['fitment']['applications'] = omittedFitment
    ? []
    : catalogMatch
      ? catalogFitmentApplications(catalogMatch)
      : isIllustrativeFixture
      ? [
        { vehicle: '2018–2020 Chevrolet Equinox', qualifier: '1.5L Turbo · illustrative row', state: 'NOT_VERIFIED' as const },
        { vehicle: '2018–2020 GMC Terrain', qualifier: '1.5L Turbo · illustrative row', state: 'NOT_VERIFIED' as const }
      ]
    : [];
  const issues: SellerCommandPreview['issues'] = [];
  if (Number(intent.price) < 0.99) {
    issues.push({ code: 'EBAY_MOTORS_MINIMUM_PRICE_REQUIRED', message: 'eBay Motors Buy It Now price must be at least $0.99.', blocking: true });
  }
  if (catalogNumberMismatch) {
    issues.push({
      code: 'CATALOG_PART_NUMBER_MISMATCH',
      message: 'The catalog lookup returned a different normalized OEM number, so every catalog-derived field was rejected.',
      blocking: true
    });
  }
  if (isSafetyReview) {
    issues.push({
      code: 'RESTRICTED_RESTRAINT_REVIEW_REQUIRED',
      message: 'Airbags and restraint-system parts require seller eligibility and item-level policy evidence before listing assembly.',
      blocking: true
    });
    issues.push({
      code: 'OEM_LABEL_AND_DONOR_VIN_REQUIRED',
      message: 'Add readable label photos and the donor-vehicle VIN. A typed vehicle description is not sufficient.',
      blocking: true
    });
  } else if (isPhotoFirst) {
    issues.push({
      code: 'PHOTO_IDENTIFICATION_REQUIRED',
      message: 'No part number was supplied. Continue with seller-owned item photos instead.',
      blocking: true
    });
  } else if (catalogMatch) {
    issues.push({
      code: 'CATALOG_EVIDENCE_REVIEW_REQUIRED',
      message: 'GM scan evidence was found. Review the catalog-stated application and derived model expansion before publishing compatibility.',
      blocking: true
    });
    if (brandPolicy?.sellerConfirmationRequired) {
      issues.push({
        code: 'BRAND_AUTHENTICITY_CONFIRMATION_REQUIRED',
        message: `Confirm whether the physical item is genuinely branded or aftermarket. Until then, ${compatibleBrand ?? 'the compatible brand'} stays behind Fits/For and Brand remains unset.`,
        blocking: true
      });
    }
    if (intelligence?.category.state !== 'EBAY_TAXONOMY_VERIFIED') {
      issues.push({
        code: 'EBAY_CATEGORY_VERIFICATION_REQUIRED',
        message: intelligence?.category.categoryId
          ? `Official leaf ${intelligence.category.categoryId} is a fallback and must be replaced or explicitly confirmed before submission.`
          : intelligence?.category.categoryName
            ? `${intelligence.category.categoryName} is a PartQuill category candidate and must be verified against the current eBay taxonomy.`
            : 'The current eBay leaf category must be resolved before publication.',
        blocking: true
      });
    }
  } else if (!isIllustrativeFixture) {
    issues.push(mapping.state === 'OCR_CANDIDATE_HELD'
      ? {
          code: 'GM_OCR_CANDIDATE_HELD',
          message: 'The OEM number occurs in OCR candidate data, but no curated or catalog-stated exact row supports seller-facing fields yet.',
          blocking: true
        }
      : {
          code: 'CATALOG_LOOKUP_REQUIRED',
          message: 'No unique authorized catalog identity has been attached to this command preview.',
          blocking: true
        });
  } else {
    issues.push({
      code: 'ILLUSTRATIVE_DATA_ONLY',
      message: 'The filled identity and fitment are an explicit UI fixture, not live catalog evidence.',
      blocking: true
    });
  }
  issues.push({
    code: isSafetyReview ? 'LABEL_AND_SELLER_PHOTOS_REQUIRED' : 'SELLER_PHOTO_REQUIRED',
    message: isSafetyReview
      ? 'Add the whole item, OEM label, connectors and deployment-condition views.'
      : isPhotoFirst
        ? 'Add the whole item, reverse or connectors, and label or marking views.'
        : 'Add at least one seller-owned photo before a real submission.',
    blocking: true
  });

  const aspects: Record<string, string> = isIllustrativeFixture
    ? { Brand: 'ACDelco', 'Manufacturer Part Number': intent.partNumber ?? '', 'OE/OEM Part Number': intent.partNumber ?? '', 'California Prop 65 Warning': '', Type: 'Cabin Air Filter' }
    : catalogMatch
      ? {
          Brand: catalogMatch.manufacturer || 'General Motors',
          'Manufacturer Part Number': identity.manufacturerPartNumber ?? formatOemPartNumber(catalogMatch.partNumber),
          'OE/OEM Part Number': identity.manufacturerPartNumber ?? formatOemPartNumber(catalogMatch.partNumber),
          'California Prop 65 Warning': '',
          ...(compatibleBrand ? { 'Compatible Vehicle Brand': compatibleBrand } : {}),
          ...(identity.productType ? { Type: identity.productType } : {}),
          ...(catalogMatch.catalogGroup ? { 'GM Catalog Group': catalogMatch.catalogGroup } : {}),
          ...(catalogMatch.calloutEvidence ? { 'Callout Ref ID': catalogMatch.calloutEvidence.calloutId } : {})
        }
    : intent.partNumber
      ? { 'Manufacturer Part Number': intent.partNumber }
      : {};

  const previewWithoutFingerprint = {
    schemaVersion: '2026-08-30' as const,
    status,
    command,
    intent,
    listing: {
      title,
      titleLength: title.length,
      format: 'Buy It Now · GTC' as const,
      // PartQuill's seller contract uses the exact normalized OEM/MPN as the
      // inventory key. A previous prototype prefix caused cross-draft leakage.
      sku: identity.manufacturerPartNumber ?? intent.partNumber,
      description: catalogMatch
        ? [
            `General Motors part ${identity.manufacturerPartNumber}`,
            `Description: ${properCaseCatalogText(catalogMatch.description ?? catalogMatch.productType ?? 'Automotive part')}`,
            catalogMatch.calloutEvidence ? `Callout Ref ID: ${catalogMatch.calloutEvidence.calloutId}` : null,
            `GM catalog group: ${catalogMatch.catalogGroup ?? 'not decoded'}`,
            '',
            `Compatibility: ${fitmentApplications.length} catalog application row${fitmentApplications.length === 1 ? '' : 's'} are available in the structured eBay compatibility review${catalogYears(catalogMatch) ? ` for catalog-stated years ${catalogYears(catalogMatch)}` : ''}. The full row set is not repeated in this description.`,
            `Verify OEM part number ${identity.manufacturerPartNumber} against the physical item and use the structured compatibility table for exact vehicle details.`,
            `Quantity: ${intent.quantity}. The seller must confirm condition, package contents and the actual item before publication.`
          ].filter((line): line is string => line !== null).join('\n')
        : buildDescription(intent, identity.productType),
      category: isIllustrativeFixture
        ? 'Air & Fuel Delivery › Filters'
        : intelligence?.category.categoryPath ?? intelligence?.category.categoryName ?? null,
      categoryId: intelligence?.category.categoryId ?? null,
      aspects,
      handlingTime: '3 business days' as const,
      returns: '30 days · buyer-paid' as const,
      international: 'Held until origin is verified' as const
    },
    identity,
    fitment: {
      state: omittedFitment ? 'OMITTED_BY_SELLER' as const : catalogMatch ? 'CATALOG_STATED' as const : 'NOT_VERIFIED' as const,
      totalApplications: catalogMatch ? fitmentApplications.length : fitmentApplications.length ? 12 : 0,
      sourceLabel: omittedFitment
        ? 'Seller instruction: do not publish fitment'
        : catalogMatch
          ? `GM catalog evidence · ${catalogMatch.applications.length} application claim${catalogMatch.applications.length === 1 ? '' : 's'}`
        : isSafetyReview
          ? 'Compatibility blocked during safety review'
          : isPhotoFirst
            ? 'Compatibility blank until identification'
            : 'Fitment not verified',
      sourceDetail: omittedFitment
        ? 'Compatibility rows are excluded from the public payload.'
        : catalogMatch
          ? `${catalogMatch.applications.length} catalog-stated application claim${catalogMatch.applications.length === 1 ? '' : 's'} produced ${fitmentApplications.length} model-level row${fitmentApplications.length === 1 ? '' : 's'}. Model expansion remains catalog-derived and must stay visibly attributed.`
        : isSafetyReview
          ? 'Typed year, make and model words are not fitment evidence. No compatibility can publish during the restricted-item hold.'
          : isPhotoFirst
            ? 'Typed year, make and model words are seller hints only. Compatibility stays empty until item identity is supported.'
            : isIllustrativeFixture
          ? 'Twelve rows are represented only to demonstrate the review UI. They remain amber and are not publishable.'
          : 'No compatibility rows will publish until the catalog adapter returns a unique, supported result.',
      applications: fitmentApplications
    },
    media: {
      state: isSafetyReview ? 'LABEL_AND_PHOTOS_REQUIRED' as const : 'SELLER_PHOTO_REQUIRED' as const,
      sourceLabel: isSafetyReview
        ? 'Readable OEM label + seller photos required'
        : isPhotoFirst
          ? 'Three seller-owned item views required'
          : merchantMedia?.assets.length
            ? 'Exact-key merchant image ready for confirmation'
            : 'Seller-owned item photo required',
      sourceDetail: isSafetyReview
        ? 'PartQuill will not identify or assemble this restricted item from the typed description alone.'
        : isPhotoFirst
          ? 'The photos become the primary item evidence; typed year, make and model words remain unverified seller hints.'
          : merchantMedia?.assets.length
            ? `${merchantMedia.assets.length} exact-keyed merchant image${merchantMedia.assets.length === 1 ? '' : 's'} passed the Ferrari source-comparison rules. Confirm that an image depicts the exact physical item before it can satisfy the seller-photo gate.`
          : catalogMatch
            ? `${catalogMatch.diagrams.length} related diagram reference${catalogMatch.diagrams.length === 1 ? '' : 's'} and ${catalogMatch.applications.length} catalog row reference${catalogMatch.applications.length === 1 ? '' : 's'} are attached. They are evidence, not seller-item photographs.`
            : 'Licensed catalog media may assist presentation later, but a placeholder can never enter a listing payload.',
      minimumPhotos: isSafetyReview ? 4 : isPhotoFirst ? 3 : 1,
      requiredViews: isSafetyReview
        ? [
            { id: 'whole-item', label: 'Whole item', detail: 'Show the complete component from edge to edge.', required: true },
            { id: 'oem-label', label: 'OEM label / part number', detail: 'Every character must be readable.', required: true },
            { id: 'connectors', label: 'Connectors and reverse', detail: 'Show plugs, wiring and the rear surface.', required: true },
            { id: 'condition', label: 'Deployment condition', detail: 'Show that the component has not deployed or been rebuilt.', required: true }
          ]
        : isPhotoFirst
          ? [
              { id: 'whole-item', label: 'Whole item', detail: 'Show the complete item from edge to edge.', required: true },
              { id: 'reverse', label: 'Back / connectors', detail: 'Show mounting points, plugs and the reverse.', required: true },
              { id: 'label', label: 'Labels / markings', detail: 'Capture every readable number or logo.', required: true }
            ]
          : [
              { id: 'whole-item', label: 'Actual item', detail: 'Show the exact physical item that will ship.', required: true },
              { id: 'label', label: 'Part-number label', detail: 'Recommended when a readable label exists.', required: false }
            ],
      analysisState: 'NOT_UPLOADED' as const,
      catalogReferences: catalogMatch ? catalogReferences(catalogMatch) : [],
      primaryListingImage: catalogMatch?.calloutEvidence ? {
        url: catalogMatch.calloutEvidence.annotatedImageUrl,
        name: `${catalogMatch.partNumber}_callout_${catalogMatch.calloutEvidence.calloutId}.png`,
        pageId: catalogMatch.calloutEvidence.pageId,
        calloutId: catalogMatch.calloutEvidence.calloutId,
        source: 'FIRST_PARTY_CATALOG_CALLOUT' as const,
        rightsState: 'FIRST_PARTY_CATALOG_EVIDENCE' as const
      } : null,
      merchantMedia
    },
    intelligence,
    tariff,
    mapping,
    brandPolicy,
    confirmations: [
      {
        id: 'part-in-hand',
        label: isSafetyReview
          ? 'Photos and OEM label show the exact item'
          : isPhotoFirst
            ? 'Photos show the exact item I will ship'
            : 'This is the exact part I have in hand',
        detail: isSafetyReview
          ? 'A policy review is still required; this confirmation does not establish eligibility or recall status.'
          : isPhotoFirst
            ? 'Do not use a stock photo or a similar item.'
            : `The number on the physical item or package matches ${intent.partNumber}.`
      },
      {
        id: 'condition',
        label: intent.condition === 'Not specified' ? 'Choose the actual item condition' : `Condition = ${intent.condition}`,
        detail: intent.condition === 'New'
          ? 'Unused and never installed.'
          : intent.condition === 'Not specified'
            ? 'New, used or remanufactured must come from the seller or physical-item evidence.'
            : 'The selected condition accurately describes the physical item.'
      }
    ],
    issues,
    recovery: {
      label: 'Find the correct part for a vehicle' as const,
      enabled: Boolean(catalogMatch && !omittedFitment && fitmentApplications.length > 0 && !catalogIncludesPre1989Vehicle(catalogMatch)),
      requires: ['17-character VIN', 'part type'] as ['17-character VIN', 'part type'],
      privacyNote: 'The full VIN is used transiently for the requested lookup and is not retained by the preview service.'
    },
    policy: isSafetyReview
      ? {
          state: 'RESTRICTED_ITEM_HOLD' as const,
          label: 'eBay airbag eligibility review required',
          sourceUrl: 'https://www.ebay.com/help/policies/prohibited-restricted-items/vehicle-parts-accessories-policy?id=4293',
          requirements: [
            'Seller is approved by eBay and maintains active ARA certification and membership',
            'Used airbag has never deployed and is not rebuilt or recalled',
            'Listing includes the donor-vehicle VIN and eBay-required certification statement',
            'Hazmat shipment uses a compliant non-USPS carrier',
            'International shipping is disabled'
          ]
        }
      : {
          state: 'STANDARD_REVIEW' as const,
          label: 'Standard automotive listing review',
          sourceUrl: null,
          requirements: []
        },
    gates: {
      privatePreflight: isIllustrativeFixture && intent.price ? 'SIMULATION_AVAILABLE' as const : 'HELD' as const,
      publicEbayWrite: 'DISABLED' as const,
      ebayHandoffUrl: 'https://www.ebay.com/' as const
    },
    noExternalRequestMade: intelligence?.category.source !== 'EBAY_TAXONOMY_API'
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(previewWithoutFingerprint)).digest('hex');
  return { ...previewWithoutFingerprint, fingerprint };
}

export function buildSellerUiBootstrap(config: AppConfig) {
  return {
    version: '0.23.0',
    mode: 'private-pilot',
    backendConnected: true,
    workspace: {
      displayName: config.PARTQUILL_WORKSPACE_NAME,
      accountLabel: config.PARTQUILL_WORKSPACE_LABEL,
      initials: config.PARTQUILL_WORKSPACE_INITIALS
    },
    ebay: {
      environment: config.EBAY_ENV,
      mode: config.EBAY_MODE,
      writesEnabled: config.ALLOW_EBAY_WRITES,
      handoffUrl: 'https://www.ebay.com/'
    },
    ebayReferenceDiscovery: {
      mode: config.EBAY_REFERENCE_DISCOVERY_MODE,
      maxImages: config.EBAY_REFERENCE_MAX_IMAGES,
      cacheHours: config.EBAY_REFERENCE_CACHE_HOURS,
      permanentArchiveRequiresRights: true
    },
    veroProfileRegistry: {
      mode: 'read-only-official-profile-index',
      endpoint: '/v1/seller-ui/vero-profiles',
      sourceUrl: EBAY_VERO_PROFILE_INDEX_URL,
      policyUrl: EBAY_INTELLECTUAL_PROPERTY_POLICY_URL,
      officialIndexIsIncomplete: true
    },
    persistence: config.DATABASE_URL ? 'postgres' : config.PILOT_EPHEMERAL_MODE ? 'ephemeral-memory-pilot' : 'memory',
    imageStudio: {
      mode: config.IMAGE_STUDIO_MODE,
      path: '/image-studio'
    },
    defaults: {
      listingFormat: 'Buy It Now · GTC',
      minimumPrice: '0.99',
      handlingTime: '3 business days',
      handlingTimes: [
        { days: 0, label: 'Same business day' },
        { days: 1, label: '1 business day' },
        { days: 2, label: '2 business days' },
        { days: 3, label: '3 business days' },
        { days: 4, label: '4 business days' },
        { days: 5, label: '5 business days' },
        { days: 10, label: '10 business days' },
        { days: 15, label: '15 business days' },
        { days: 20, label: '20 business days' },
        { days: 30, label: '30 business days' },
        { days: 40, label: '40 business days' }
      ],
      domesticShipping: 'Calculated shipping',
      returns: '30 days · buyer-paid',
      international: 'Held until origin is verified'
    },
    safeguards: {
      unknownCatalogClaimsHeld: true,
      sellerPhotoRequired: true,
      photoFirstWithoutPartNumber: true,
      restrictedRestraintGate: true,
      dualApproval: true,
      publicEbayWritesDisabled: true
    }
  } as const;
}
