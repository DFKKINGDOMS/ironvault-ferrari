import { researchOemPart, type OemPartResearch } from './oem-research.js';
import type { LexusPartFitment, OemMake } from './lexuspartsnow.js';

const VPIC_ORIGIN = 'https://vpic.nhtsa.dot.gov';

export interface DecodedToyotaVin {
  make: OemMake;
  model: string;
  modelYear: number;
  engineModel?: string;
  displacementL?: number;
  cylinders?: number;
  trim?: string;
  series?: string;
}

export interface VinPartVerification {
  partNumber: string;
  vinLastFour: string;
  vehicle: DecodedToyotaVin;
  status: 'CATALOG_MATCH' | 'CATALOG_NO_MATCH' | 'INCONCLUSIVE';
  statusLabel: 'Fits this vehicle' | 'Does not fit this vehicle' | 'May fit — not verified';
  verdictTone: 'GREEN' | 'RED' | 'AMBER';
  explanation: string;
  matchingFitment: LexusPartFitment[];
  catalogChecks: {
    attempted: 3;
    exactPartMatches: number;
    unavailable: number;
    matchingRows: number;
  };
  listingFitmentAllowed: boolean;
  vinStored: false;
  dealerIdentityExposed: false;
}

export interface VerifyVinPartOptions {
  fetch?: typeof fetch;
  research?: (partNumber: string) => Promise<OemPartResearch>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function validateToyotaVin(value: string): string {
  const vin = value.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    throw new Error('Enter a complete 17-character VIN. Letters I, O and Q are not valid VIN characters.');
  }
  return vin;
}

function normalizeMake(value: string): OemMake | undefined {
  const make = value.trim().toUpperCase();
  if (make === 'TOYOTA') return 'Toyota';
  if (make === 'LEXUS') return 'Lexus';
  if (make === 'SCION') return 'Scion';
  return undefined;
}

function normalizedModel(value: string): string {
  return value.toUpperCase().replace(/\b(?:TOYOTA|LEXUS|SCION)\b/g, '').replace(/[^A-Z0-9]/g, '');
}

function modelMatches(decoded: string, catalog: string): boolean {
  const left = normalizedModel(decoded);
  const right = normalizedModel(catalog);
  if (!left || !right) return false;
  if (left === right) return true;
  return Math.min(left.length, right.length) >= 5 && (left.endsWith(right) || right.endsWith(left));
}

function yearMatches(year: number, row: LexusPartFitment): boolean {
  const start = row.yearStart ?? row.yearEnd;
  const end = row.yearEnd ?? row.yearStart;
  return start !== undefined && end !== undefined && year >= start && year <= end;
}

function engineEvidence(row: LexusPartFitment): string {
  return [row.trimEngine, row.optionDetails, row.raw].filter(Boolean).join(' ').toUpperCase();
}

function engineMatchStrength(vehicle: DecodedToyotaVin, row: LexusPartFitment): 'MATCH' | 'CONFLICT' | 'UNSPECIFIED' {
  const evidence = engineEvidence(row);
  const engineModel = vehicle.engineModel?.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const normalizedEvidence = evidence.replace(/[^A-Z0-9]/g, '');
  if (engineModel && engineModel.length >= 4 && normalizedEvidence.includes(engineModel)) return 'MATCH';

  const displacementMatches = [...evidence.matchAll(/(\d(?:\.\d)?)\s*L\b/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  if (vehicle.displacementL !== undefined && displacementMatches.length > 0) {
    return displacementMatches.some((value) => Math.abs(value - (vehicle.displacementL as number)) <= 0.11)
      ? 'MATCH'
      : 'CONFLICT';
  }
  return 'UNSPECIFIED';
}

export async function decodeToyotaVin(vinInput: string, fetcher: typeof fetch = fetch): Promise<DecodedToyotaVin> {
  const vin = validateToyotaVin(vinInput);
  const url = new URL(`/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(vin)}`, VPIC_ORIGIN);
  url.searchParams.set('format', 'json');
  const response = await fetcher(url, {
    headers: { accept: 'application/json', 'user-agent': 'PartQuill/0.7 (+https://partquill.com)' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error('The VIN decoder is temporarily unavailable. No compatibility claim was made.');
  const payload = objectValue(await response.json());
  const decoded = objectValue(Array.isArray(payload.Results) ? payload.Results[0] : undefined);
  const make = normalizeMake(textValue(decoded.Make) || '');
  const model = textValue(decoded.Model);
  const modelYear = numberValue(decoded.ModelYear);
  const errorCode = textValue(decoded.ErrorCode);
  if (!make || !model || !modelYear || !Number.isInteger(modelYear) || (errorCode && errorCode !== '0')) {
    throw new Error('This VIN could not be decoded as a supported Toyota, Lexus or Scion vehicle.');
  }
  const engineModel = textValue(decoded.EngineModel);
  const displacementL = numberValue(decoded.DisplacementL);
  const cylinders = numberValue(decoded.EngineCylinders);
  const trim = textValue(decoded.Trim);
  const series = textValue(decoded.Series) || textValue(decoded.Series2);
  return {
    make,
    model,
    modelYear,
    ...(engineModel ? { engineModel } : {}),
    ...(displacementL !== undefined ? { displacementL } : {}),
    ...(cylinders !== undefined ? { cylinders } : {}),
    ...(trim ? { trim } : {}),
    ...(series ? { series } : {})
  };
}

export async function verifyOemPartVin(
  partNumber: string,
  vinInput: string,
  options: VerifyVinPartOptions = {}
): Promise<VinPartVerification> {
  const vin = validateToyotaVin(vinInput);
  const [vehicle, research] = await Promise.all([
    decodeToyotaVin(vin, options.fetch),
    (options.research ?? researchOemPart)(partNumber)
  ]);
  const modelRows = research.fitment.filter(
    (row) => row.make === vehicle.make && modelMatches(vehicle.model, row.model) && yearMatches(vehicle.modelYear, row)
  );
  const strengths = modelRows.map((row) => engineMatchStrength(vehicle, row));
  const matchingFitment = modelRows.filter((_, index) => strengths[index] !== 'CONFLICT');
  const hasEngineMatch = strengths.includes('MATCH');
  const hasUnspecified = strengths.includes('UNSPECIFIED');
  const status: VinPartVerification['status'] = modelRows.length === 0
    ? 'CATALOG_NO_MATCH'
    : hasEngineMatch
      ? 'CATALOG_MATCH'
      : hasUnspecified
        ? 'INCONCLUSIVE'
        : 'CATALOG_NO_MATCH';
  const statusLabel: VinPartVerification['statusLabel'] = status === 'CATALOG_MATCH'
    ? 'Fits this vehicle'
    : status === 'CATALOG_NO_MATCH'
      ? 'Does not fit this vehicle'
      : 'May fit — not verified';
  const verdictTone: VinPartVerification['verdictTone'] = status === 'CATALOG_MATCH'
    ? 'GREEN'
    : status === 'CATALOG_NO_MATCH'
      ? 'RED'
      : 'AMBER';
  const explanation = status === 'CATALOG_MATCH'
    ? `The decoded ${vehicle.modelYear} ${vehicle.make} ${vehicle.model} matches the part's year, model and engine evidence.`
    : status === 'CATALOG_NO_MATCH'
      ? `The decoded ${vehicle.modelYear} ${vehicle.make} ${vehicle.model} does not match the available year, model and engine evidence for this part.`
      : `The decoded ${vehicle.modelYear} ${vehicle.make} ${vehicle.model} matches broad catalog rows, but engine or production-break evidence is not specific enough for a guaranteed fit.`;
  return {
    partNumber: research.identity.partNumber,
    vinLastFour: vin.slice(-4),
    vehicle,
    status,
    statusLabel,
    verdictTone,
    explanation,
    matchingFitment,
    catalogChecks: {
      attempted: 3,
      exactPartMatches: research.catalogChecks.exactMatches,
      unavailable: research.catalogChecks.unavailable,
      matchingRows: matchingFitment.length
    },
    listingFitmentAllowed: status === 'CATALOG_MATCH',
    vinStored: false,
    dealerIdentityExposed: false
  };
}
