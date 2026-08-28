import type { GmCatalogApplication, GmCatalogPart } from './gm-catalog.js';

export function canonicalOemPartNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatOemPartNumber(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

const automotiveIdentityWords = new Set([
  'arm', 'bearing', 'belt', 'bolt', 'booster', 'bracket', 'bushing', 'cable', 'cleaner',
  'clutch', 'cover', 'cylinder', 'drum', 'element', 'filter', 'fitting', 'gasket', 'gear',
  'hose', 'housing', 'hub', 'kit', 'knuckle', 'lamp', 'line', 'linkage', 'master', 'motor',
  'mount', 'nut', 'pad', 'panel', 'pipe', 'piston', 'plate', 'pump', 'relay', 'repair',
  'retainer', 'rod', 'rotor', 'screw', 'seal', 'shaft', 'shoe', 'solenoid', 'spring',
  'steering', 'support', 'switch', 'tube', 'valve', 'washer', 'wheel'
]);

const supplierWords = new Set(['bendix', 'delco', 'moraine', 'rochester']);

/**
 * OCR context is useful evidence, but it is not automatically a product name.
 * Reject dot leaders, neighboring part numbers and supplier-only fragments before
 * any catalog text reaches a seller title or marketplace aspect.
 */
export function credibleCatalogIdentityText(value: string | null | undefined, partNumber: string): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < 3 || text.length > 140 || /[|]/.test(text) || /\.{4,}/.test(text)) return null;

  const requestedKey = canonicalOemPartNumber(partNumber);
  const partLikeTokens = text.match(/\b[A-Z0-9-]*\d[A-Z0-9-]{4,}\b/gi) ?? [];
  if (partLikeTokens.some((token) => canonicalOemPartNumber(token) !== requestedKey)) return null;

  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (words.some((word) => automotiveIdentityWords.has(word))) return text;

  const significantWords = words.filter((word) => word.length >= 4 && !supplierWords.has(word));
  return significantWords.length >= 2 ? text : null;
}

function curatedApplication(input: {
  claimId: number;
  partName: string;
  description: string;
  componentFamily?: string;
  catalogGroup: string;
  supplier: string;
  applicationText: string;
  yearStart: number;
  yearEnd: number;
  modelScope: string;
  sourcePageId: number;
  evidenceBox: Record<string, unknown>;
  evidenceContext?: string;
  layoutLine?: string;
}): GmCatalogApplication {
  const pageFolder = String(input.sourcePageId).padStart(6, '0');
  return {
    claimId: input.claimId,
    manufacturer: 'General Motors',
    division: 'Oldsmobile',
    catalogTitle: 'General Motors Parts Catalogue',
    catalogGroup: input.catalogGroup,
    partName: input.partName,
    description: input.description,
    groupHeading: 'Power Brake Parts',
    componentFamily: input.componentFamily ?? 'Power Brake Repair Kit',
    supplier: input.supplier,
    applicationText: input.applicationText,
    yearStart: input.yearStart,
    yearEnd: input.yearEnd,
    modelScope: input.modelScope,
    equipmentQualifier: 'Power-brake equipped vehicles',
    exclusion: null,
    position: null,
    quantity: '1',
    sourcePageId: input.sourcePageId,
    sourceUrl: null,
    imageRef: `GM${input.sourcePageId}-FULL`,
    imageBlobKey: `gm-scans/pages/${pageFolder}/full_page.png`,
    evidenceBox: input.evidenceBox,
    evidenceContext: input.evidenceContext ?? input.applicationText,
    layoutLine: input.layoutLine ?? input.applicationText,
    crossReference: null,
    relationMethod: 'curated_catalog_table',
    confidence: 0.97,
    verificationState: 'catalog_stated',
    modelExpansionState: 'not_expanded',
    models: []
  };
}

interface CatalogCuration {
  divisions: string[];
  productType: string;
  description: string;
  catalogGroup: string;
  applications: GmCatalogApplication[];
}

const catalogCurations: Readonly<Record<string, CatalogCuration>> = {
  '5455054': {
    divisions: ['Oldsmobile'],
    productType: 'Moraine Power Brake Repair Kit',
    description: 'Moraine Power Brake Repair Kit',
    catalogGroup: '4.898',
    applications: [curatedApplication({
      claimId: -5455054,
      partName: 'Power Brake Repair Kit',
      description: 'Moraine Power Brake Repair Kit',
      catalogGroup: '4.898',
      supplier: 'Moraine',
      applicationText: '1955 through 1957 Oldsmobile with Moraine power brakes',
      yearStart: 1955,
      yearEnd: 1957,
      modelScope: 'Moraine power-brake equipped vehicles',
      sourcePageId: 2153,
      evidenceBox: {
        left: 1684,
        top: 451,
        width: 125,
        height: 28,
        image_width: 2550,
        image_height: 3300
      },
      evidenceContext: '1955 through 1957 W/P.B. (Moraine) 1 5455054 (4.898)',
      layoutLine: '1955 through 1957 W/P.B. (Moraine) 1 5455054 (4.898)'
    })]
  },
  '5455055': {
    divisions: ['Oldsmobile'],
    productType: 'Moraine Vacuum Cylinder Repair Kit',
    description: 'Moraine Vacuum Cylinder Repair Kit',
    catalogGroup: '4.658',
    applications: [curatedApplication({
      claimId: -5455055,
      partName: 'Vacuum Cylinder Repair Kit',
      description: 'Moraine Vacuum Cylinder Repair Kit',
      componentFamily: 'Power Brake Vacuum Cylinder Repair Kit',
      catalogGroup: '4.658',
      supplier: 'Moraine',
      applicationText: '1955 and 1956 Oldsmobile with Moraine power brakes',
      yearStart: 1955,
      yearEnd: 1956,
      modelScope: 'Moraine power-brake equipped vehicles',
      sourcePageId: 6761,
      evidenceBox: {
        left: 1737,
        top: 718,
        width: 144,
        height: 33,
        image_width: 2550,
        image_height: 3300
      },
      evidenceContext: 'Oldsmobile 1955: 5455055; Oldsmobile 1956: 5455055 — Moraine vacuum-cylinder repair kit column',
      layoutLine: 'OLDSMOBILE 1955 567095 5455055 567094 5455054; 1956 567095 5455055 567094 5455054'
    })]
  }
};

export type GmCatalogMappingState =
  | 'CURATED_EXACT'
  | 'CATALOG_STATED_EXACT'
  | 'OCR_CANDIDATE_HELD'
  | 'PART_NUMBER_MISMATCH'
  | 'NOT_FOUND';

export interface GmCatalogMappingAssessment {
  state: GmCatalogMappingState;
  requestedPartNumber: string | null;
  returnedPartNumber: string | null;
  exactKeyMatch: boolean;
  sellerFacingAllowed: boolean;
  sourcePages: number[];
  reasons: string[];
}

export function assessGmCatalogMapping(
  catalog: GmCatalogPart | undefined,
  requestedPartNumber: string | null
): GmCatalogMappingAssessment {
  const requested = requestedPartNumber ? formatOemPartNumber(requestedPartNumber) : null;
  if (!catalog || !requested) {
    return {
      state: 'NOT_FOUND',
      requestedPartNumber: requested,
      returnedPartNumber: catalog?.partNumber ? formatOemPartNumber(catalog.partNumber) : null,
      exactKeyMatch: false,
      sellerFacingAllowed: false,
      sourcePages: [],
      reasons: ['No exact OEM-keyed catalog record was returned.']
    };
  }
  const returned = formatOemPartNumber(catalog.partNumber);
  const exactKeyMatch = canonicalOemPartNumber(returned) === canonicalOemPartNumber(requested);
  if (!exactKeyMatch) {
    return {
      state: 'PART_NUMBER_MISMATCH',
      requestedPartNumber: requested,
      returnedPartNumber: returned,
      exactKeyMatch: false,
      sellerFacingAllowed: false,
      sourcePages: [],
      reasons: ['The returned catalog key does not exactly equal the requested normalized OEM part number.']
    };
  }

  const curation = catalogCurations[canonicalOemPartNumber(requested)];
  const catalogStatedApplications = catalog.applications.filter((application) =>
    application.verificationState === 'catalog_stated'
    && application.confidence >= 0.8
    && Number.isInteger(application.sourcePageId)
  );
  const rollupPage = catalog.rollup.representativePageId ?? catalog.rollup.firstPageId;
  const catalogStated = catalog.verificationState === 'catalog_stated'
    && (
      catalogStatedApplications.length > 0
      || (catalog.rollup.catalogStatedOccurrences > 0 && Number.isInteger(rollupPage))
    );
  const sourcePages = [...new Set([
    ...(curation?.applications ?? catalogStatedApplications).map((application) => application.sourcePageId),
    ...(curation ? [] : Number.isInteger(rollupPage) ? [rollupPage] : [])
  ].filter(Number.isInteger))];

  if (curation) {
    return {
      state: 'CURATED_EXACT',
      requestedPartNumber: requested,
      returnedPartNumber: returned,
      exactKeyMatch: true,
      sellerFacingAllowed: true,
      sourcePages,
      reasons: ['Exact OEM key matched a manually curated catalog transcription with first-party page evidence.']
    };
  }
  if (catalogStated) {
    return {
      state: 'CATALOG_STATED_EXACT',
      requestedPartNumber: requested,
      returnedPartNumber: returned,
      exactKeyMatch: true,
      sellerFacingAllowed: true,
      sourcePages,
      reasons: ['Exact OEM key and catalog-stated application evidence passed the seller-facing threshold.']
    };
  }
  return {
    state: 'OCR_CANDIDATE_HELD',
    requestedPartNumber: requested,
    returnedPartNumber: returned,
    exactKeyMatch: true,
    sellerFacingAllowed: false,
    sourcePages: [],
    reasons: [
      'The number is only an OCR/candidate occurrence; it is retained for review and cannot populate identity, title, category or fitment.'
    ]
  };
}

/**
 * Return one exact OEM-keyed catalog record suitable for seller-facing use.
 * A lookup result can never replace the requested part number with a nearby OCR
 * candidate. Low-quality OCR identity text is held instead of being published.
 */
export function normalizeGmCatalogPart(
  catalog: GmCatalogPart | undefined,
  requestedPartNumber: string | null
): GmCatalogPart | undefined {
  if (!catalog || !requestedPartNumber) return undefined;
  const requestedKey = canonicalOemPartNumber(requestedPartNumber);
  const assessment = assessGmCatalogMapping(catalog, requestedPartNumber);
  if (!requestedKey || !assessment.sellerFacingAllowed) return undefined;

  const curation = catalogCurations[requestedKey];
  const structuredCandidates = catalog.applications.flatMap((application) => [
    application.componentFamily,
    application.groupHeading,
    application.description,
    application.partName
  ]);
  const productType = curation?.productType
    ?? [catalog.productType, ...structuredCandidates]
      .map((candidate) => credibleCatalogIdentityText(candidate, requestedKey))
      .find(Boolean)
    ?? null;
  const description = curation?.description
    ?? [catalog.description, ...structuredCandidates, productType]
      .map((candidate) => credibleCatalogIdentityText(candidate, requestedKey))
      .find(Boolean)
    ?? null;

  return {
    ...catalog,
    partNumber: formatOemPartNumber(requestedPartNumber),
    divisions: curation?.divisions ?? catalog.divisions,
    productType,
    description,
    catalogGroup: curation?.catalogGroup ?? catalog.catalogGroup,
    applications: curation?.applications ?? catalog.applications,
    rollup: curation
      ? {
          ...catalog.rollup,
          representativePageId: curation.applications[0]?.sourcePageId ?? catalog.rollup.representativePageId,
          representativeImageRef: curation.applications[0]?.imageRef ?? null,
          bestLayoutConfidence: Math.max(catalog.rollup.bestLayoutConfidence ?? 0, 0.97)
        }
      : catalog.rollup
  };
}
