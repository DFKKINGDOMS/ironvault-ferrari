import type { GmCatalogApplication, GmCatalogPart } from '../catalog/gm-catalog.js';
import type {
  VintageGmCatalogInventory,
  VintageGmInventoryAnswer,
  VintageGmInventoryAnswerRow,
  VintageGmInventoryQuestionIntent,
  VintageGmInventoryQuestionPool,
  VintageGmInventorySort,
  VintageGmInventorySortDirection
} from './types.js';

export const MAX_VINTAGE_INVENTORY_ANSWER_ROWS = 5_000;

const knownMakes: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /\bchev(?:rolet|y)?\b/i, name: 'Chevrolet' },
  { pattern: /\bcadillac\b/i, name: 'Cadillac' },
  { pattern: /\bbuick\b/i, name: 'Buick' },
  { pattern: /\bpontiac\b/i, name: 'Pontiac' },
  { pattern: /\boldsmobile\b|\bolds\b/i, name: 'Oldsmobile' },
  { pattern: /\bgmc\b/i, name: 'GMC' },
  { pattern: /\bsaturn\b/i, name: 'Saturn' },
  { pattern: /\bhummer\b/i, name: 'Hummer' }
];

const modelSeriesAliases: Readonly<Record<string, readonly string[]>> = {
  corvette: ['Y'],
  'c k truck': ['C K', 'C', 'K']
};

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function titleCase(value: string): string {
  return compact(value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()))
    .replace(/\bGmc\b/g, 'GMC');
}

function normalizedWords(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesWords(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizedWords(needle);
  if (!normalizedNeedle) return true;
  return ` ${normalizedWords(haystack)} `.includes(` ${normalizedNeedle} `);
}

function requestedLimit(command: string): number | null {
  if (/\b(?:all|every)\b/i.test(command)) return null;
  const raw = command.match(/\b(?:top|first|show|give|find|list)(?:\s+me)?(?:\s+(?:a|the))?(?:\s+list\s+of)?\s+(\d{1,3})\b/i)?.[1]
    ?? command.match(/\b(\d{1,3})\s+(?:in[- ]stock\s+)?parts?\b/i)?.[1];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 500) : null;
}

function requestedSort(command: string): { sortBy: VintageGmInventorySort; sortDirection: VintageGmInventorySortDirection } {
  const normalized = command.toLowerCase();
  let sortBy: VintageGmInventorySort = 'QUANTITY';
  if (/\b(?:inventory|stock|extended|total)\s+value\b|\bvalue\b/.test(normalized)) sortBy = 'INVENTORY_VALUE';
  else if (/\b(?:unit\s+)?(?:price|cost)\b/.test(normalized)) sortBy = 'UNIT_PRICE';
  else if (/\bpart\s*(?:#|number)|\bmpn\b|\bsku\b/.test(normalized)) sortBy = 'PART_NUMBER';
  else if (/\bdescription\b|\bname\b/.test(normalized)) sortBy = 'DESCRIPTION';
  else if (/\bqty\b|\bquantity\b|\bstock\b/.test(normalized)) sortBy = 'QUANTITY';

  const explicitAscending = /\b(?:lowest|least|smallest|ascending|asc|a\s*(?:to|-)\s*z)\b/.test(normalized);
  const explicitDescending = /\b(?:highest|most|largest|descending|desc|z\s*(?:to|-)\s*a)\b/.test(normalized);
  const alphabeticalDefault = sortBy === 'PART_NUMBER' || sortBy === 'DESCRIPTION';
  return {
    sortBy,
    sortDirection: explicitAscending ? 'ASC' : explicitDescending ? 'DESC' : alphabeticalDefault ? 'ASC' : 'DESC'
  };
}

interface PartConcept {
  canonical: string;
  patterns: RegExp[];
  alternatives: string[];
}

const partConcepts: readonly PartConcept[] = [
  {
    canonical: 'wheel lug nut',
    patterns: [/\b(?:wheel\s+)?lug\s+nuts?\b/i, /\bwheel\s+nuts?\b/i],
    alternatives: ['lug nut', 'wheel nut', 'nut wheel', 'wheel lug']
  },
  {
    canonical: 'door panel',
    patterns: [/\bdoor\s+(?:trim\s+)?panels?\b/i],
    alternatives: ['door panel', 'door trim', 'trim panel door']
  },
  {
    canonical: 'interior',
    patterns: [/\binterior(?:\s+(?:parts?|trim|components?))?\b/i],
    alternatives: [
      'interior', 'instrument panel', 'dashboard', 'dash panel', 'console', 'seat',
      'headliner', 'carpet', 'garnish', 'interior trim', 'trim panel', 'door panel'
    ]
  },
  {
    canonical: 'exterior',
    patterns: [/\bexterior(?:\s+(?:parts?|trim|components?))?\b/i],
    alternatives: ['exterior', 'body panel', 'bumper', 'fender', 'hood', 'grille', 'molding', 'exterior trim']
  },
  {
    canonical: 'brake',
    patterns: [/\bbrakes?\b/i],
    alternatives: ['brake', 'caliper', 'rotor', 'drum', 'master cylinder']
  },
  {
    canonical: 'steering',
    patterns: [/\bsteering\b/i],
    alternatives: ['steering', 'steering gear', 'steering column', 'tie rod']
  },
  {
    canonical: 'suspension',
    patterns: [/\bsuspension\b/i],
    alternatives: ['suspension', 'control arm', 'spring', 'shock', 'strut']
  },
  {
    canonical: 'engine',
    patterns: [/\bengine(?:\s+parts?)?\b/i],
    alternatives: ['engine', 'motor', 'cylinder', 'piston', 'camshaft', 'crankshaft']
  },
  {
    canonical: 'transmission',
    patterns: [/\btransmissions?\b|\btrans\b/i],
    alternatives: ['transmission', 'transaxle', 'gearbox']
  },
  {
    canonical: 'electrical',
    patterns: [/\belectrical\b/i],
    alternatives: ['electrical', 'switch', 'relay', 'wiring', 'harness', 'lamp']
  }
];

const partNoiseWords = new Set([
  'a', 'an', 'all', 'any', 'available', 'can', 'catalog', 'do', 'every', 'find', 'for',
  'full', 'give', 'got', 'has', 'have', 'i', 'in', 'inventory', 'inv', 'is', 'list',
  'locate', 'looking', 'me', 'need', 'of', 'on', 'part', 'parts', 'please', 'search',
  'show', 'some', 'stock', 'that', 'the', 'to', 'vintage', 'want', 'we', 'what',
  'which', 'with', 'you'
]);

function matchedPartConcept(value: string): PartConcept | null {
  return partConcepts.find((concept) => concept.patterns.some((pattern) => pattern.test(value))) ?? null;
}

function cleanPartQuery(value: string): string | null {
  const words = normalizedWords(value).split(' ').filter((word) => word && !partNoiseWords.has(word) && !/^(?:18|19|20)\d{2}$/.test(word));
  return words.length ? words.join(' ') : null;
}

function partSearchGroups(partQuery: string | null): string[][] {
  if (!partQuery) return [];
  const concept = matchedPartConcept(partQuery);
  if (concept) return [concept.alternatives.map((value) => normalizedWords(value))];
  return normalizedWords(partQuery).split(' ').filter((word) => word.length > 1).map((word) => [word]);
}

function normalizeVehicleModel(value: string, make: string | null): string | null {
  const compacted = compact(value)
    .replace(/^(?:all|the|any|a|an)\s+/i, '')
    .replace(/\b(?:replacement|oem|genuine|new|used)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!compacted || /^(?:gm|general\s+motors|vehicle|car|truck|pickup)$/i.test(compacted)) return null;
  const normalized = normalizedWords(compacted);
  if ((make === 'GMC' || make === 'Chevrolet' || make === null) && /^(?:c\s+k|ck)(?:\s+(?:pickup|truck))?$/.test(normalized)) {
    return 'C/K Truck';
  }
  return titleCase(compacted.replace(/\s*[,/]\s*/g, '/'));
}

function vehicleAndPartFrom(command: string): {
  year: number | null;
  make: string | null;
  model: string | null;
  vehicleText: string | null;
  partQuery: string | null;
} {
  const yearMatch = command.match(/\b((?:18|19|20)\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const makeEntry = knownMakes.find((candidate) => candidate.pattern.test(command));
  const make = makeEntry?.name ?? null;
  const concept = matchedPartConcept(command);

  let vehicleSegment = '';
  let partCandidate = '';
  const forVehicle = command.match(/\bfor\s+(?:a|an|the)?\s*((?:18|19|20)\d{2}\b[\s\S]*)/i);
  if (forVehicle && forVehicle.index !== undefined) {
    vehicleSegment = forVehicle[1] ?? '';
    partCandidate = command.slice(0, forVehicle.index);
  } else if (yearMatch && yearMatch.index !== undefined) {
    vehicleSegment = command.slice(yearMatch.index);
  } else {
    const forNamedVehicle = command.match(/\bfor\s+(?:a|an|the)\s+(.+?)(?=\s+(?:that|which|with|in\s+stock|available|from\s+vintage)\b|[?.!]|$)/i);
    if (forNamedVehicle && forNamedVehicle.index !== undefined) {
      vehicleSegment = forNamedVehicle[1] ?? '';
      partCandidate = command.slice(0, forNamedVehicle.index);
    }
  }

  vehicleSegment = vehicleSegment
    .replace(/\b(?:that|which|with|from)\b[\s\S]*$/i, '')
    .replace(/\b(?:in\s+stock|on\s+hand|available|sorted?\s+by|order(?:ed)?\s+by)\b[\s\S]*$/i, '')
    .replace(/\s+parts?\b[\s\S]*$/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  if (concept) {
    for (const pattern of concept.patterns) {
      const match = vehicleSegment.match(pattern);
      if (match && match.index !== undefined && match.index > 0) {
        vehicleSegment = vehicleSegment.slice(0, match.index).trim();
        if (!partCandidate) partCandidate = match[0];
        break;
      }
    }
  }

  let modelSegment = vehicleSegment
    .replace(/\b(?:18|19|20)\d{2}\b/g, ' ')
    .replace(/\b(?:model|year)\b/gi, ' ');
  if (makeEntry) modelSegment = modelSegment.replace(makeEntry.pattern, ' ');
  modelSegment = compact(modelSegment);

  const model = normalizeVehicleModel(modelSegment, make);
  let partQuery = concept?.canonical ?? cleanPartQuery(partCandidate);
  if (!partQuery && !vehicleSegment) partQuery = cleanPartQuery(command);
  const vehicleText = [year, make, model].filter(Boolean).join(' ') || null;
  return { year, make, model, vehicleText, partQuery };
}

function inventoryPartNumber(command: string): string | null {
  const raw = command.match(/\b(?:part(?:\s*(?:number|no\.?|#))?|mpn|sku)\s*[:#-]?\s*([a-z0-9][a-z0-9._-]{3,})\b/i)?.[1];
  return raw ? raw.replace(/[^a-z0-9]/gi, '').toUpperCase() : null;
}

export function vintageGmModelSeriesAliases(model: string | null, year: number | null): string[] {
  if (!model) return [];
  if (normalizedWords(model) === 'corvette' && (year === null || year < 1984 || year > 2019)) return [];
  return [...(modelSeriesAliases[normalizedWords(model)] ?? [])];
}

export function parseVintageGmInventoryQuestion(command: string): VintageGmInventoryQuestionIntent | null {
  const normalized = command.toLowerCase();
  const singleListing = /\b(?:sell|draft|publish)\b/i.test(command)
    || /\b(?:on\s+ebay|for\s+\$\s*\d|\$\s*\d)\b/i.test(command)
    || /\blist\s+(?:a|an|one|this)\s+(?:new|used|nos|genuine|oem|black|white|red|blue|left|right)\b/i.test(command);
  if (singleListing) return null;

  const understood = vehicleAndPartFrom(command);
  const partNumber = inventoryPartNumber(command);
  if (partNumber) understood.partQuery = null;
  const sourceMentioned = /\bvintage\s+parts?\b|\bvintage\s+(?:source|inventory|file)\b/.test(normalized);
  const inventoryCue = /\b(?:inventory|inv|in\s+stock|on\s+hand|stock\s+list|available|quantity|qty|value|price|cost|how\s+many)\b/.test(normalized)
    || /\b(?:do|what)\s+(?:we|you)\s+have\b|\blooking\s+for\b|\b(?:find|locate|search)\b/.test(normalized)
    || /\b(?:all|every|full)\s+(?:the\s+)?parts?\b/.test(normalized)
    || /\bi\s+(?:need|want)\b/.test(normalized);
  const questionCue = /\b(?:give|show|find|locate|search|tell|which|what|how|list|display|sort|need|want|looking)\b/.test(normalized)
    || command.includes('?');
  const vehicleCue = understood.year !== null || understood.make !== null || understood.model !== null;
  const partCue = understood.partQuery !== null || partNumber !== null || /\bparts?\b/.test(normalized);
  const compactVehicleOnly = vehicleCue && normalizedWords(command).split(' ').length <= 7;
  if (!(sourceMentioned || inventoryCue || compactVehicleOnly) || !(questionCue || compactVehicleOnly) || !(vehicleCue || partCue)) {
    return null;
  }

  const sort = requestedSort(command);
  const queryMode = partNumber
    ? 'PART_NUMBER'
    : vehicleCue && understood.partQuery
      ? 'VEHICLE_PART'
      : vehicleCue
        ? 'VEHICLE_ALL_PARTS'
        : 'PART_DESCRIPTION';
  return {
    kind: 'VINTAGE_GM_INVENTORY_QUESTION',
    source: 'VINTAGE_PARTS',
    year: understood.year,
    make: understood.make,
    model: understood.model,
    vehicleText: understood.vehicleText,
    partQuery: understood.partQuery,
    partNumber,
    partSearchGroups: partSearchGroups(understood.partQuery),
    queryMode,
    inStockOnly: true,
    sortBy: sort.sortBy,
    sortDirection: sort.sortDirection,
    requestedLimit: requestedLimit(command)
  };
}

export function matchesVintagePartQuery(
  catalog: GmCatalogPart,
  inventory: VintageGmCatalogInventory,
  intent: VintageGmInventoryQuestionIntent
): boolean {
  if (intent.partNumber && normalizedWords(inventory.partNumber) !== normalizedWords(intent.partNumber)) return false;
  if (intent.partSearchGroups.length === 0) return true;
  const applicationPartText = (catalog.applications ?? []).map((application) => [
    application.partName,
    application.description,
    application.groupHeading,
    application.componentFamily
  ].filter(Boolean).join(' ')).join(' ');
  const searchable = normalizedWords([
    inventory.productName,
    ...inventory.descriptions,
    catalog.productType,
    catalog.description,
    catalog.catalogGroup,
    applicationPartText
  ].filter(Boolean).join(' '));
  return intent.partSearchGroups.every((alternatives) =>
    alternatives.some((alternative) => includesWords(searchable, alternative))
  );
}

export function resolveVintageGmIntentFromCatalogModels(
  intent: VintageGmInventoryQuestionIntent,
  catalogModels: readonly string[]
): VintageGmInventoryQuestionIntent {
  if (!intent.model || intent.partQuery || intent.partNumber) return intent;
  const requested = normalizedWords(intent.model);
  const candidates = catalogModels
    .map((model) => ({ source: model, normalized: normalizedWords(model) }))
    .filter((candidate) =>
      candidate.normalized
      && !/^(?:car|truck|vehicle|passenger car|all)$/.test(candidate.normalized)
      && (requested === candidate.normalized || requested.startsWith(candidate.normalized + ' '))
    )
    .sort((left, right) => right.normalized.length - left.normalized.length);
  const selected = candidates[0];
  if (!selected || selected.normalized === requested) return intent;
  const remainder = requested.slice(selected.normalized.length).trim();
  if (!remainder) return intent;
  const resolvedModel = titleCase(selected.source);
  return {
    ...intent,
    model: resolvedModel,
    vehicleText: [intent.year, intent.make, resolvedModel].filter(Boolean).join(' '),
    partQuery: remainder,
    partSearchGroups: partSearchGroups(remainder),
    queryMode: 'VEHICLE_PART'
  };
}

function applicationHasYear(application: GmCatalogApplication, year: number | null): boolean {
  if (year === null) return true;
  if (application.models.some((model) => model.year === year)) return true;
  const start = application.yearStart ?? application.yearEnd;
  const end = application.yearEnd ?? application.yearStart;
  return start !== null && end !== null && start <= year && year <= end;
}

function applicationHasModel(application: GmCatalogApplication, model: string | null, year: number | null): boolean {
  if (!model) return true;
  const explicitModels = application.models
    .map((candidate) => `${candidate.modelName} ${candidate.seriesCode ?? ''}`)
    .filter((value) => normalizedWords(value));
  const applicationText = [
    application.catalogTitle,
    application.applicationText,
    application.modelScope,
    application.division
  ].filter((value): value is string => Boolean(value)).join(' ');
  const aliases = vintageGmModelSeriesAliases(model, year).map((alias) => normalizedWords(alias));
  const aliasMatched = aliases.some((alias) =>
    includesWords(applicationText, alias)
    || application.models.some((candidate) =>
      includesWords(`${candidate.modelName} ${candidate.seriesCode ?? ''}`, alias)
    )
  );
  return explicitModels.some((value) => includesWords(value, model))
    || includesWords(applicationText, model)
    || aliasMatched;
}

function applicationHasMake(application: GmCatalogApplication, make: string | null): boolean {
  if (!make) return true;
  const divisions = [
    application.division,
    ...application.models.map((model) => model.division)
  ].filter((value): value is string => Boolean(value));
  return divisions.length === 0 || divisions.some((division) => includesWords(division, make));
}

export function matchesVintageVehicleApplication(
  application: GmCatalogApplication,
  intent: VintageGmInventoryQuestionIntent
): boolean {
  const evidenceUsable = application.verificationState.toLowerCase() === 'catalog_stated'
    && application.confidence >= 0.8;
  return evidenceUsable
    && applicationHasYear(application, intent.year)
    && applicationHasModel(application, intent.model, intent.year)
    && applicationHasMake(application, intent.make);
}

function catalogImage(
  catalog: GmCatalogPart,
  sourcePages: number[]
): VintageGmInventoryAnswerRow['catalogImage'] {
  if (catalog.calloutEvidence?.annotatedImageUrl) {
    return {
      state: 'EXACT_CALLOUT',
      url: catalog.calloutEvidence.annotatedImageUrl,
      pageId: catalog.calloutEvidence.pageId,
      calloutId: catalog.calloutEvidence.calloutId,
      label: 'Exact catalog callout ' + catalog.calloutEvidence.calloutId
    };
  }
  const diagram = (catalog.diagrams ?? []).find((candidate) => candidate.isPrimary && candidate.exactPartDepiction)
    ?? (catalog.diagrams ?? []).find((candidate) => candidate.exactPartDepiction)
    ?? (catalog.diagrams ?? []).find((candidate) => candidate.isPrimary);
  if (diagram) {
    return {
      state: 'CATALOG_DIAGRAM',
      url: '/v1/gm-catalog/pages/' + diagram.pageId + '/image',
      pageId: diagram.pageId,
      calloutId: diagram.calloutLabel,
      label: diagram.calloutLabel ? 'Catalog diagram · callout ' + diagram.calloutLabel : 'Catalog diagram'
    };
  }
  const pageId = sourcePages[0] ?? catalog.rollup.representativePageId;
  if (pageId) {
    return {
      state: 'EVIDENCE_PAGE',
      url: '/v1/gm-catalog/pages/' + pageId + '/image',
      pageId,
      calloutId: null,
      label: 'Catalog evidence page'
    };
  }
  return { state: 'UNAVAILABLE', url: null, pageId: null, calloutId: null, label: 'Catalog image unavailable' };
}

function displayDescription(values: string[], fallback: string | null): string {
  const source = values.find((value) => value.trim()) ?? fallback ?? 'Description unavailable';
  return titleCase(source);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function sortedRows(rows: VintageGmInventoryAnswerRow[], intent: VintageGmInventoryQuestionIntent): VintageGmInventoryAnswerRow[] {
  const direction = intent.sortDirection === 'ASC' ? 1 : -1;
  return [...rows].sort((left, right) => {
    let compared = 0;
    if (intent.sortBy === 'QUANTITY') compared = left.quantity - right.quantity;
    else if (intent.sortBy === 'INVENTORY_VALUE') compared = Number(left.sourceInventoryValue) - Number(right.sourceInventoryValue);
    else if (intent.sortBy === 'UNIT_PRICE') compared = Number(left.sourcePriceMax) - Number(right.sourcePriceMax);
    else if (intent.sortBy === 'DESCRIPTION') compared = compareText(left.description, right.description);
    else compared = compareText(left.partNumber, right.partNumber);
    return compared * direction || compareText(left.partNumber, right.partNumber);
  });
}

function fitmentLabel(intent: VintageGmInventoryQuestionIntent): string {
  return [intent.year, intent.make, intent.model].filter(Boolean).join(' ') || 'All catalog-supported GM applications';
}

export function buildVintageGmInventoryAnswer(
  command: string,
  intent: VintageGmInventoryQuestionIntent,
  pool: VintageGmInventoryQuestionPool
): VintageGmInventoryAnswer {
  const resolvedIntent = pool.resolvedIntent ?? intent;
  const label = fitmentLabel(resolvedIntent);
  const mapped = pool.matches.filter((match) => matchesVintagePartQuery(match.catalog, match.inventory, resolvedIntent))
    .map<VintageGmInventoryAnswerRow>((match) => {
    const applications = match.matchedApplications.filter((application) => matchesVintageVehicleApplication(application, resolvedIntent));
    const sourcePages = [...new Set(applications.map((application) => application.sourcePageId).filter((page) => page > 0))]
      .sort((left, right) => left - right);
    const modelDerived = Boolean(resolvedIntent.model) && applications.some((application) => application.models.some((model) =>
      includesWords(`${model.modelName} ${model.seriesCode ?? ''}`, resolvedIntent.model ?? '')
      && model.verificationState.toLowerCase() !== 'catalog_stated'
    ));
    return {
      rank: 0,
      partNumber: match.inventory.partNumber,
      sku: match.inventory.sku,
      description: displayDescription(match.inventory.descriptions, match.catalog.description ?? match.catalog.productType),
      alternateDescriptions: match.inventory.descriptions.slice(1).map((description) => titleCase(description)),
      brands: match.inventory.brands,
      quantity: match.inventory.quantity,
      sourcePriceMin: match.inventory.sourcePriceMin,
      sourcePriceMax: match.inventory.sourcePriceMax,
      sourceInventoryValue: match.sourceInventoryValue,
      sourceWeightMin: match.inventory.sourceWeightMin,
      sourceWeightMax: match.inventory.sourceWeightMax,
      catalogImage: catalogImage(match.catalog, sourcePages),
      fitment: {
        label,
        applicationCount: applications.length,
        sourcePages,
        evidenceState: modelDerived ? 'CATALOG_DERIVED_MODEL' : 'CATALOG_STATED'
      }
    };
  }).filter((row) => row.fitment.applicationCount > 0 || (!resolvedIntent.year && !resolvedIntent.make && !resolvedIntent.model));

  const ordered = sortedRows(mapped, resolvedIntent);
  const selected = ordered.slice(0, resolvedIntent.requestedLimit ?? MAX_VINTAGE_INVENTORY_ANSWER_ROWS)
    .map((row, index) => ({ ...row, rank: index + 1 }));
  const truncated = pool.truncated || selected.length < ordered.length;
  const datasetReady = Boolean(pool.dataset?.active && pool.dataset.status === 'completed');
  const value = selected.reduce((total, row) => total + Number(row.sourceInventoryValue), 0);
  const totalUnits = selected.reduce((total, row) => total + row.quantity, 0);

  return {
    schemaVersion: '2026-08-31',
    kind: 'VINTAGE_GM_INVENTORY_ANSWER',
    status: !datasetReady ? 'DATA_NOT_LOADED' : selected.length === 0 ? 'NO_MATCHES' : truncated ? 'TRUNCATED' : 'READY',
    command,
    intent: resolvedIntent,
    dataset: pool.dataset,
    returnedCount: selected.length,
    summary: {
      distinctParts: selected.length,
      totalUnits,
      sourceInventoryValue: value.toFixed(4),
      complete: !truncated
    },
    rows: selected,
    valueDefinition: 'Sum of active Vintage source quantity multiplied by its source unit price; not resale or eBay market value.',
    readOnly: true,
    listingDraftCreated: false,
    allowanceConsumed: false,
    noExternalRequestMade: true
  };
}
