import { buildCatalogListingIntelligence } from '../catalog/listing-intelligence.js';
import {
  assessGmCatalogMapping,
  normalizeGmCatalogPart
} from '../catalog/gm-catalog-quality.js';
import { properCaseCatalogText } from '../seller/command-preview.js';
import type {
  VintageGmCatalogMatchPool,
  VintageGmShortlist,
  VintageGmShortlistCandidate
} from './types.js';

const DEFAULT_SHORTLIST_COUNT = 10;
const MAX_SHORTLIST_COUNT = 25;
const restraintPattern = /\b(?:air\s*bag|airbag|srs|inflator|pretensioner|supplemental\s+restraint|seat\s*belt\s*(?:retractor|pretensioner))\b/i;

function requestedCount(command: string): number {
  const explicit = command.match(/\b(?:give|show|find|pick|recommend|list)(?:\s+me)?(?:\s+(?:a|the))?(?:\s+list\s+of)?\s+(\d{1,2})\b/i)?.[1]
    ?? command.match(/\b(\d{1,2})\s+(?:rare\s+|vintage\s+|gm\s+)?parts?\b/i)?.[1]
    ?? command.match(/\blist\s+(\d{1,2})\s+part\s*(?:#|number)/i)?.[1];
  const parsed = Number(explicit ?? DEFAULT_SHORTLIST_COUNT);
  return Number.isInteger(parsed) && parsed >= 1
    ? Math.min(parsed, MAX_SHORTLIST_COUNT)
    : DEFAULT_SHORTLIST_COUNT;
}

export function isVintageGmShortlistCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  const asksForSet = /\b(?:give|show|find|pick|recommend)\b/.test(normalized)
    || /\blist\s+(?:me\s+)?(?:a\s+)?(?:set|group|batch|collection|\d{1,2})\b/.test(normalized);
  const pluralParts = /\bparts\b|\bparts?from\b|\bpart\s*(?:#(?:['’]?s)?|numbers?)\b/.test(normalized);
  const discoveryScope = /\b(?:vintage|vinatge|inventory|database|file|rare|scarce|gmpartswiki|gm\s+parts\s+wiki|catalog(?:ue)?)\b/.test(normalized);
  const singleListing = /\b(?:list|sell|draft)\s+(?:gm\s+)?part\s*(?:#|number)?\s*[:#-]?\s*[a-z0-9-]{4,}\b/i.test(command)
    && !/\b\d{1,2}\s+part\s*(?:#|number)s?\b/i.test(command);
  return asksForSet && pluralParts && discoveryScope && !singleListing;
}

function sourceScarcity(quantity: number): VintageGmShortlistCandidate['inventory']['scarcityBand'] {
  if (quantity <= 1) return 'ONE_IN_SOURCE';
  if (quantity <= 3) return 'LOW_SOURCE_STOCK';
  return 'AVAILABLE_SOURCE_STOCK';
}

function sourcePriceForDraft(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0.99, parsed).toFixed(2) : '0.99';
}

function cleanTitlePart(value: string): string {
  return properCaseCatalogText(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function titleGuard(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) return normalized;
  return normalized.slice(0, 80).replace(/\s+\S*$/, '').trim();
}

function candidateFromMatch(
  match: VintageGmCatalogMatchPool['matches'][number],
  rank: number
): VintageGmShortlistCandidate | null {
  const mapping = assessGmCatalogMapping(match.catalog, match.inventory.partNumber);
  if (!mapping.sellerFacingAllowed || ![
    'CURATED_EXACT',
    'CATALOG_LINKED_EXACT',
    'CATALOG_STATED_EXACT'
  ].includes(mapping.state)) return null;

  const catalog = normalizeGmCatalogPart(match.catalog, match.inventory.partNumber);
  if (!catalog || restraintPattern.test([
    ...match.inventory.descriptions,
    catalog.productType,
    catalog.description,
    ...catalog.applications.flatMap((application) => [application.partName, application.description, application.componentFamily])
  ].filter(Boolean).join(' '))) return null;

  const catalogDescription = cleanTitlePart(catalog.description ?? catalog.productType ?? 'Automotive Part');
  const inventoryDescription = cleanTitlePart(match.inventory.descriptions[0] ?? catalogDescription);
  const intelligence = buildCatalogListingIntelligence(catalog);
  const suggestedTitle = titleGuard(`GM ${match.inventory.partNumber} ${catalogDescription}`);
  const evidencePage = mapping.sourcePages[0] ?? null;
  return {
    rank,
    partNumber: match.inventory.partNumber,
    inventory: {
      brands: match.inventory.brands,
      description: inventoryDescription,
      alternateDescriptions: match.inventory.descriptions
        .map(cleanTitlePart)
        .filter((description) => description !== inventoryDescription),
      quantity: match.inventory.quantity,
      sourcePriceMin: match.inventory.sourcePriceMin,
      sourcePriceMax: match.inventory.sourcePriceMax,
      sourceWeightMin: match.inventory.sourceWeightMin,
      sourceWeightMax: match.inventory.sourceWeightMax,
      sourceRows: match.inventory.sourceRows,
      recordCount: match.inventory.recordCount,
      scarcityBand: sourceScarcity(match.inventory.quantity)
    },
    catalog: {
      manufacturer: catalog.manufacturer || 'General Motors',
      productType: cleanTitlePart(catalog.productType ?? catalogDescription),
      description: catalogDescription,
      divisions: catalog.divisions,
      catalogGroup: catalog.catalogGroup,
      mappingState: mapping.state as VintageGmShortlistCandidate['catalog']['mappingState'],
      sourcePages: mapping.sourcePages,
      occurrenceCount: catalog.rollup.occurrenceCount,
      pageCount: catalog.rollup.pageCount,
      applicationCount: catalog.applications.length,
      evidenceViewUrl: evidencePage ? `/v1/gm-catalog/pages/${evidencePage}/image` : null,
      category: {
        state: intelligence.category.state,
        categoryId: intelligence.category.categoryId,
        categoryName: intelligence.category.categoryName,
        categoryPath: intelligence.category.categoryPath
      }
    },
    listing: {
      state: 'DRAFT_CANDIDATE_REVIEW_REQUIRED',
      suggestedTitle,
      reviewCommand: `List GM part ${match.inventory.partNumber} for $${sourcePriceForDraft(match.inventory.sourcePriceMax)}`,
      reviewRequirements: [
        'Photograph the actual item and readable GM part-number label.',
        'Confirm condition and usable quantity from the physical inventory.',
        'Review the eBay Motors leaf category and item specifics.',
        'Set the seller price; the Vintage feed price is not an eBay market-value estimate.'
      ]
    }
  };
}

export function buildVintageGmShortlist(
  command: string,
  pool: VintageGmCatalogMatchPool
): VintageGmShortlist {
  const count = requestedCount(command);
  const candidates: VintageGmShortlistCandidate[] = [];
  for (const match of pool.matches) {
    const candidate = candidateFromMatch(match, candidates.length + 1);
    if (candidate) candidates.push(candidate);
    if (candidates.length >= count) break;
  }

  const status = !pool.dataset || pool.dataset.status !== 'completed'
    ? 'DATA_NOT_LOADED' as const
    : candidates.length === 0
      ? 'NO_EXACT_MATCHES' as const
      : candidates.length < count
        ? 'PARTIAL' as const
        : 'READY' as const;
  return {
    schemaVersion: '2026-08-29',
    kind: 'VINTAGE_GM_SHORTLIST',
    status,
    command,
    requestedCount: count,
    returnedCount: candidates.length,
    dataset: pool.dataset,
    candidates,
    ranking: {
      label: 'Vintage source-inventory scarcity + exact GM catalog evidence',
      marketRarityClaimed: false,
      ebayMarketDataUsed: false,
      explanation: 'Lower total quantity in the active Vintage source ranks first, then stronger exact catalog evidence and broader preserved page support. This does not establish marketplace rarity, demand, or value.'
    },
    gates: {
      actualItemPhotoRequired: true,
      conditionConfirmationRequired: true,
      categoryReviewRequired: true,
      publicEbayWrite: 'DISABLED'
    },
    noExternalRequestMade: true
  };
}

export function vintageGmShortlistRequestedCount(command: string): number {
  return requestedCount(command);
}
