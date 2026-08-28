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
  catalogGroup: string;
  supplier: string;
  applicationText: string;
  yearStart: number;
  yearEnd: number;
  modelScope: string;
  sourcePageId: number;
}): GmCatalogApplication {
  return {
    claimId: input.claimId,
    manufacturer: 'General Motors',
    division: 'Oldsmobile',
    catalogTitle: 'General Motors Parts Catalogue',
    catalogGroup: input.catalogGroup,
    partName: input.partName,
    description: input.description,
    groupHeading: 'Power Brake Parts',
    componentFamily: 'Power Brake Repair Kit',
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
    imageRef: null,
    imageBlobKey: null,
    evidenceBox: null,
    evidenceContext: input.applicationText,
    layoutLine: input.applicationText,
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
      sourcePageId: 2153
    })]
  },
  '5455055': {
    divisions: ['Oldsmobile'],
    productType: 'Moraine Power Brake Overhaul Kit',
    description: 'Moraine Power Brake Overhaul Kit',
    catalogGroup: '4.658',
    applications: [curatedApplication({
      claimId: -5455055,
      partName: 'Power Brake Overhaul Kit',
      description: 'Moraine Power Brake Overhaul Kit',
      catalogGroup: '4.658',
      supplier: 'Moraine',
      applicationText: '1955 and 1956 Oldsmobile with Moraine power brakes',
      yearStart: 1955,
      yearEnd: 1956,
      modelScope: 'Moraine power-brake equipped vehicles',
      sourcePageId: 6761
    })]
  }
};

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
  if (!requestedKey || canonicalOemPartNumber(catalog.partNumber) !== requestedKey) return undefined;

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
          representativeImageRef: null,
          bestLayoutConfidence: Math.max(catalog.rollup.bestLayoutConfidence ?? 0, 0.97)
        }
      : catalog.rollup
  };
}
