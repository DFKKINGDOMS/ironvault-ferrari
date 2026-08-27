import { researchOemPart, type OemPartResearch } from './oem-research.js';
import {
  decodeToyotaVin,
  validateToyotaVin,
  type DecodedToyotaVin
} from './vin-fitment.js';

type FetchLike = typeof fetch;

interface PrivateCatalogConfig {
  origin: string;
  siteHeader: 'LPN' | 'TPD';
}

const LEXUS_CATALOG: PrivateCatalogConfig = {
  origin: 'https://www.lexuspartsnow.com',
  siteHeader: 'LPN'
};

const TOYOTA_CATALOG: PrivateCatalogConfig = {
  origin: 'https://www.toyotapartsdeal.com',
  siteHeader: 'TPD'
};

export interface VinFilteredPartCandidate {
  partNumber: string;
  description: string;
  pncCode?: string;
  replacedBy?: string;
}

export interface CorrectOemPartResult {
  rejectedPartNumber: string;
  partFamily: string;
  vinLastFour: string;
  vehicle: DecodedToyotaVin;
  status: 'EXACT_MATCH' | 'MULTIPLE_MATCHES' | 'NO_EXACT_MATCH';
  statusLabel: 'Correct part found' | 'Possible matching parts' | 'Correct part not verified';
  verdictTone: 'GREEN' | 'AMBER';
  explanation: string;
  matchBasis: 'VIN_FILTERED_PNC' | 'VIN_FILTERED_EXACT_FAMILY' | 'NO_UNIQUE_CANDIDATE';
  candidatePartNumbers: string[];
  correctPart?: OemPartResearch;
  buyerFitmentVerified: boolean;
  sellerListingChanged: false;
  eBayWritePerformed: false;
  vinStored: false;
  dealerIdentityExposed: false;
}

export interface FindCorrectOemPartOptions {
  fetch?: FetchLike;
  decodeVin?: (vin: string, fetcher?: FetchLike) => Promise<DecodedToyotaVin>;
  research?: (partNumber: string) => Promise<OemPartResearch>;
  lookupCandidates?: (
    vehicle: DecodedToyotaVin,
    vin: string,
    partFamily: string
  ) => Promise<VinFilteredPartCandidate[]>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function valueByKey(value: Record<string, unknown>, names: string[]): unknown {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const entry = Object.entries(value).find(([key]) => wanted.has(key.toLowerCase()));
  return entry?.[1];
}

function normalizePartNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizePnc(value: string | undefined): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeModel(value: string): string {
  return value.toUpperCase().replace(/\b(?:TOYOTA|LEXUS|SCION)\b/g, '').replace(/[^A-Z0-9]/g, '');
}

function modelMatches(decoded: string, catalog: string): boolean {
  const left = normalizeModel(decoded);
  const right = normalizeModel(catalog);
  if (!left || !right) return false;
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 5 && (left.endsWith(right) || right.endsWith(left));
}

function sanitizeCatalogText(value: string): string {
  return value
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[redacted]')
    .replace(/Lexus\s*Parts\s*Now|Toyota\s*Parts\s*Deal|Longo(?:\s+Toyota(?:\s+of\s+El\s+Monte)?)?|Revolution\s*Parts|Original\s*Parts\s*Giant/gi, '[redacted]')
    .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, '[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function canonicalFamily(value: string): string {
  const noise = new Set([
    'GENUINE', 'TOYOTA', 'LEXUS', 'SCION', 'OEM', 'ENGINE', 'ASSY', 'ASSEMBLY', 'SUB', 'SET'
  ]);
  return value
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length > 1 && !noise.has(token))
    .sort()
    .join('|');
}

function readableFamily(value: string): string {
  const clean = sanitizeCatalogText(value).replace(/\s+/g, ' ').trim();
  const comma = clean.match(/^([^,]+),\s*(.+)$/);
  return comma ? `${comma[2]} ${comma[1]}` : clean;
}

function inferPartFamily(research: OemPartResearch): string {
  const candidates = [...research.identity.alternateNames, research.identity.description]
    .map(readableFamily)
    .filter((value) => canonicalFamily(value).length > 0);
  return candidates.sort((a, b) => a.length - b.length)[0] || 'replacement part';
}

function parseInitialStore(html: string): Record<string, unknown> {
  const match = html.match(
    /<script[^>]*id=["']initialState["'][^>]*>\s*window\.__INITIAL_STORE__\s*=\s*([\s\S]*?);?\s*<\/script>/i
  );
  if (!match?.[1]) throw new Error('The vehicle catalog did not return readable fitment data.');
  const json = match[1]
    .replace(/:\s*undefined(?=\s*[,}])/g, ':null')
    .replace(/([[,]\s*)undefined(?=\s*[,\]])/g, '$1null');
  try {
    return objectValue(JSON.parse(json));
  } catch {
    throw new Error('The vehicle catalog fitment data could not be parsed safely.');
  }
}

function safeReturnedUrl(value: string, config: PrivateCatalogConfig): URL | undefined {
  try {
    const url = new URL(value, config.origin);
    if (url.protocol !== 'https:' || url.origin !== config.origin) return undefined;
    if (url.pathname !== '/page_product/searchbyname') return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function privateHeaders(config: PrivateCatalogConfig, contentType = false): Record<string, string> {
  return {
    accept: contentType ? 'application/json' : 'text/html,application/xhtml+xml',
    ...(contentType ? { 'content-type': 'application/json' } : {}),
    referer: `${config.origin}/`,
    site: config.siteHeader,
    'user-agent': 'PartQuill/0.9 (+https://partquill.com)'
  };
}

function vehicleStateMatches(vehicle: DecodedToyotaVin, state: Record<string, unknown>): boolean {
  const make = stringValue(valueByKey(state, ['make', 'makeName']));
  const model = stringValue(valueByKey(state, ['model', 'modelName']));
  const yearRaw = valueByKey(state, ['year', 'modelYear']);
  const year = typeof yearRaw === 'number' ? yearRaw : Number(stringValue(yearRaw));
  return Boolean(
    make && make.toUpperCase() === vehicle.make.toUpperCase() &&
    model && modelMatches(vehicle.model, model) &&
    Number.isInteger(year) && year === vehicle.modelYear
  );
}

function candidateFromRaw(value: unknown): VinFilteredPartCandidate | undefined {
  const part = objectValue(value);
  const partNumber = stringValue(valueByKey(part, ['partNumber', 'partNo', 'partNumberAbbr']));
  if (!partNumber || !/^[A-Z0-9][A-Z0-9-]{3,38}[A-Z0-9]$/i.test(partNumber)) return undefined;
  const main = stringValue(valueByKey(part, ['mainDesc', 'description', 'partName']));
  const sub = stringValue(valueByKey(part, ['subDesc', 'alternateDescription']));
  const description = sanitizeCatalogText(main || sub || 'OEM replacement part');
  const pncCode = stringValue(valueByKey(part, ['pncCode', 'pnc', 'callout']));
  const replacedBy = stringValue(valueByKey(part, ['replacedBy', 'supersededBy']));
  return {
    partNumber: partNumber.trim().toUpperCase(),
    description,
    ...(pncCode ? { pncCode: sanitizeCatalogText(pncCode) } : {}),
    ...(replacedBy ? { replacedBy: sanitizeCatalogText(replacedBy) } : {})
  };
}

function deduplicateCandidates(values: unknown[]): VinFilteredPartCandidate[] {
  const byPart = new Map<string, VinFilteredPartCandidate>();
  for (const value of values) {
    const candidate = candidateFromRaw(value);
    if (!candidate) continue;
    const key = normalizePartNumber(candidate.partNumber);
    const existing = byPart.get(key);
    if (!existing) {
      byPart.set(key, candidate);
    } else if (!existing.pncCode && candidate.pncCode) {
      byPart.set(key, { ...existing, pncCode: candidate.pncCode });
    }
  }
  return [...byPart.values()];
}

export async function lookupVinFilteredParts(
  vehicle: DecodedToyotaVin,
  vinInput: string,
  partFamily: string,
  fetcher: FetchLike = fetch
): Promise<VinFilteredPartCandidate[]> {
  const vin = validateToyotaVin(vinInput);
  const config = vehicle.make === 'Lexus' ? LEXUS_CATALOG : TOYOTA_CATALOG;
  const redirectResponse = await fetcher(new URL('/api/url/vehicle-redirect', config.origin), {
    method: 'POST',
    headers: privateHeaders(config, true),
    body: JSON.stringify({
      pageKey: null,
      pageType: 1,
      selectionType: 2,
      keywords: partFamily,
      filter: null,
      currentURL: `${config.origin}/`,
      vin
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });
  if (!redirectResponse.ok) {
    throw new Error('The vehicle catalog is temporarily unavailable. No replacement was claimed.');
  }
  const redirectPayload = objectValue(await redirectResponse.json());
  const redirectData = objectValue(redirectPayload.data);
  const redirectValue = stringValue(valueByKey(redirectData, ['url', 'redirectUrl'])) ||
    stringValue(valueByKey(redirectPayload, ['url', 'redirectUrl']));
  const searchUrl = redirectValue ? safeReturnedUrl(redirectValue, config) : undefined;
  if (!searchUrl) throw new Error('The VIN did not produce a safe vehicle-specific catalog search.');

  const searchResponse = await fetcher(searchUrl, {
    headers: privateHeaders(config),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });
  if (!searchResponse.ok) {
    throw new Error('The vehicle-specific catalog search is temporarily unavailable.');
  }
  const store = parseInitialStore(await searchResponse.text());
  const initApp = objectValue(store.initApp);
  const vehicleInfo = objectValue(initApp.decodeVehicleInfo);
  if (!vehicleStateMatches(vehicle, vehicleInfo)) {
    throw new Error('The catalog vehicle did not match the decoded VIN, so no replacement was claimed.');
  }

  const resultResponse = await fetcher(new URL('/api/search/pagination-result-new', config.origin), {
    method: 'POST',
    headers: privateHeaders(config, true),
    body: JSON.stringify({
      vehicle: vehicleInfo,
      hasOptions: true,
      keywords: partFamily,
      optionFilters: [],
      searchDetail: { keywords: '', isEsSearch: true, rawKeywords: partFamily, page: 1 },
      searchFlag: { searchPartId: 0, isAcc: false, subCategoryUrl: '', pncDesc: '' }
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });
  if (!resultResponse.ok) {
    throw new Error('The VIN-filtered part results are temporarily unavailable.');
  }
  const resultPayload = objectValue(await resultResponse.json());
  const data = objectValue(resultPayload.data);
  const parts = Array.isArray(data.parts)
    ? data.parts
    : Array.isArray(data.partList)
      ? data.partList
      : [];
  return deduplicateCandidates(parts);
}

function assertPrivateResult(result: CorrectOemPartResult, fullVin: string): void {
  const serialized = JSON.stringify(result);
  if (serialized.includes(fullVin)) throw new Error('VIN masking failed closed.');
  if (/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts|original\s*parts\s*giant/i.test(serialized)) {
    throw new Error('Dealer identity redaction failed closed.');
  }
  const urls = serialized.match(/https?:\\?\/\\?\/[^"\\\s]+/g) || [];
  if (urls.some((url) => !url.replace(/\\/g, '').startsWith('https://api.partquill.com/'))) {
    throw new Error('External catalog URL redaction failed closed.');
  }
}

export async function findCorrectOemPart(
  rejectedPartNumberInput: string,
  vinInput: string,
  options: FindCorrectOemPartOptions = {}
): Promise<CorrectOemPartResult> {
  const vin = validateToyotaVin(vinInput);
  const research = options.research ?? researchOemPart;
  const decodeVin = options.decodeVin ?? decodeToyotaVin;
  const [vehicle, rejected] = await Promise.all([
    decodeVin(vin, options.fetch),
    research(rejectedPartNumberInput)
  ]);
  const rejectedPartNumber = rejected.identity.partNumber;
  const partFamily = inferPartFamily(rejected);
  const lookup = options.lookupCandidates ?? ((currentVehicle, currentVin, family) =>
    lookupVinFilteredParts(currentVehicle, currentVin, family, options.fetch));
  const candidates = await lookup(vehicle, vin, partFamily);
  const targetPncs = new Set(rejected.identity.pncCodes.map(normalizePnc).filter(Boolean));
  const pncMatches = candidates.filter((candidate) => targetPncs.has(normalizePnc(candidate.pncCode)));
  const familyAliases = new Set(
    [rejected.identity.description, ...rejected.identity.alternateNames]
      .map(canonicalFamily)
      .filter(Boolean)
  );
  const familyMatches = pncMatches.length > 0
    ? []
    : candidates.filter((candidate) => familyAliases.has(canonicalFamily(candidate.description)));
  const matched = pncMatches.length > 0 ? pncMatches : familyMatches;
  const matchBasis: CorrectOemPartResult['matchBasis'] = pncMatches.length > 0
    ? 'VIN_FILTERED_PNC'
    : familyMatches.length > 0
      ? 'VIN_FILTERED_EXACT_FAMILY'
      : 'NO_UNIQUE_CANDIDATE';
  const candidatePartNumbers = matched.map((candidate) => candidate.partNumber).slice(0, 5);

  if (matched.length !== 1) {
    const status = matched.length > 1 ? 'MULTIPLE_MATCHES' as const : 'NO_EXACT_MATCH' as const;
    const result: CorrectOemPartResult = {
      rejectedPartNumber,
      partFamily,
      vinLastFour: vin.slice(-4),
      vehicle,
      status,
      statusLabel: status === 'MULTIPLE_MATCHES' ? 'Possible matching parts' : 'Correct part not verified',
      verdictTone: 'AMBER',
      explanation: status === 'MULTIPLE_MATCHES'
        ? `More than one VIN-filtered ${partFamily} candidate remains. PartQuill will not guess which one is correct.`
        : `No single VIN-filtered ${partFamily} candidate could be verified. PartQuill will not guess.`,
      matchBasis: 'NO_UNIQUE_CANDIDATE',
      candidatePartNumbers,
      buyerFitmentVerified: false,
      sellerListingChanged: false,
      eBayWritePerformed: false,
      vinStored: false,
      dealerIdentityExposed: false
    };
    assertPrivateResult(result, vin);
    return result;
  }

  const selected = matched[0] as VinFilteredPartCandidate;
  const correctPart = await research(selected.partNumber);
  if (normalizePartNumber(correctPart.identity.partNumber) !== normalizePartNumber(selected.partNumber)) {
    throw new Error('The replacement research did not return the exact candidate part number.');
  }
  if (targetPncs.size > 0 && matchBasis === 'VIN_FILTERED_PNC') {
    const confirmedPncs = new Set(correctPart.identity.pncCodes.map(normalizePnc).filter(Boolean));
    if (![...targetPncs].some((pnc) => confirmedPncs.has(pnc))) {
      throw new Error('The replacement callout could not be confirmed, so no replacement was claimed.');
    }
  }
  const result: CorrectOemPartResult = {
    rejectedPartNumber,
    partFamily,
    vinLastFour: vin.slice(-4),
    vehicle,
    status: 'EXACT_MATCH',
    statusLabel: 'Correct part found',
    verdictTone: 'GREEN',
    explanation: `One exact ${partFamily} was returned for this VIN-filtered vehicle catalog and independently exact-matched by part number.`,
    matchBasis,
    candidatePartNumbers: [correctPart.identity.partNumber],
    correctPart,
    buyerFitmentVerified: true,
    sellerListingChanged: false,
    eBayWritePerformed: false,
    vinStored: false,
    dealerIdentityExposed: false
  };
  assertPrivateResult(result, vin);
  return result;
}
