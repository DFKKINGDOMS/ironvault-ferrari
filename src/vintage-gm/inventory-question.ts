import type { GmCatalogApplication } from '../catalog/gm-catalog.js';
import type {
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

function vehicleFrom(command: string): { year: number | null; make: string | null; model: string | null } {
  const yearMatch = command.match(/\b((?:18|19|20)\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (!yearMatch || yearMatch.index === undefined) return { year, make: null, model: null };

  const afterYear = command.slice(yearMatch.index + yearMatch[0].length);
  const rawVehicle = afterYear.match(/^\s*(?:model\s+)?(.+?)\s+parts?\b/i)?.[1]
    ?? afterYear.match(/^\s*(?:model\s+)?(.+?)(?=\s+(?:that|which|from|in\s+stock|available|inventory|at\s+vintage)\b|[?.!,]|$)/i)?.[1]
    ?? null;
  if (!rawVehicle) return { year, make: null, model: null };

  let segment = compact(rawVehicle)
    .replace(/^(?:all|the|any)\s+/i, '')
    .replace(/\b(?:replacement|oem|genuine|new|used)\b/gi, ' ');
  const makeEntry = knownMakes.find((candidate) => candidate.pattern.test(segment));
  if (makeEntry) segment = compact(segment.replace(makeEntry.pattern, ' '));
  const model = segment && !/^(?:gm|general\s+motors|vehicle|car|truck)$/i.test(segment)
    ? titleCase(segment)
    : null;
  return { year, make: makeEntry?.name ?? null, model };
}

export function parseVintageGmInventoryQuestion(command: string): VintageGmInventoryQuestionIntent | null {
  const normalized = command.toLowerCase();
  const sourceMentioned = /\bvintage\s+parts?\b|\bvintage\s+(?:source|inventory|file)\b/.test(normalized);
  const asksForInventory = /\b(?:in\s+stock|available|inventory|quantity|qty|value|price|cost|how\s+many|has|have)\b/.test(normalized);
  const asksForParts = /\bparts?\b|\binventory\b/.test(normalized);
  const questionOrSet = /\b(?:give|show|find|tell|which|what|how|list|display|sort)\b/.test(normalized) || command.includes('?');
  const singleListing = /\b(?:list|sell|draft|publish)\s+(?:gm\s+)?part\s*(?:#|number)?\s*[:#-]?\s*[a-z0-9-]{4,}\b/i.test(command)
    || /\b(?:on\s+ebay|for\s+\$\s*\d)/i.test(command);
  if (!sourceMentioned || !asksForInventory || !asksForParts || !questionOrSet || singleListing) return null;

  const vehicle = vehicleFrom(command);
  const sort = requestedSort(command);
  return {
    kind: 'VINTAGE_GM_INVENTORY_QUESTION',
    source: 'VINTAGE_PARTS',
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    inStockOnly: true,
    sortBy: sort.sortBy,
    sortDirection: sort.sortDirection,
    requestedLimit: requestedLimit(command)
  };
}

function applicationHasYear(application: GmCatalogApplication, year: number | null): boolean {
  if (year === null) return true;
  if (application.models.some((model) => model.year === year)) return true;
  const start = application.yearStart ?? application.yearEnd;
  const end = application.yearEnd ?? application.yearStart;
  return start !== null && end !== null && start <= year && year <= end;
}

function applicationHasModel(application: GmCatalogApplication, model: string | null): boolean {
  if (!model) return true;
  const explicitModels = application.models
    .map((candidate) => `${candidate.modelName} ${candidate.seriesCode ?? ''}`)
    .filter((value) => normalizedWords(value));
  if (explicitModels.length > 0) return explicitModels.some((value) => includesWords(value, model));
  const applicationText = [
    application.catalogTitle,
    application.applicationText,
    application.modelScope,
    application.division
  ].filter((value): value is string => Boolean(value)).join(' ');
  return includesWords(applicationText, model);
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
    && applicationHasModel(application, intent.model)
    && applicationHasMake(application, intent.make);
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
  const label = fitmentLabel(intent);
  const mapped = pool.matches.map<VintageGmInventoryAnswerRow>((match) => {
    const applications = match.matchedApplications.filter((application) => matchesVintageVehicleApplication(application, intent));
    const sourcePages = [...new Set(applications.map((application) => application.sourcePageId).filter((page) => page > 0))]
      .sort((left, right) => left - right);
    const modelDerived = Boolean(intent.model) && applications.some((application) => application.models.some((model) =>
      includesWords(`${model.modelName} ${model.seriesCode ?? ''}`, intent.model ?? '')
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
      fitment: {
        label,
        applicationCount: applications.length,
        sourcePages,
        evidenceState: modelDerived ? 'CATALOG_DERIVED_MODEL' : 'CATALOG_STATED'
      }
    };
  }).filter((row) => row.fitment.applicationCount > 0 || (!intent.year && !intent.make && !intent.model));

  const ordered = sortedRows(mapped, intent);
  const selected = ordered.slice(0, intent.requestedLimit ?? MAX_VINTAGE_INVENTORY_ANSWER_ROWS)
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
    intent,
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
