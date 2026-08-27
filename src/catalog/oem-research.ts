import { registerCatalogImage } from './image-proxy.js';
import {
  researchLexusPart,
  researchToyotaPart,
  type LexusPartFitment,
  type LexusPartResearch,
  type OemMake,
  type ResearchLexusPartOptions
} from './lexuspartsnow.js';
import { researchRevolutionParts, type RevolutionPartsOptions } from './revolutionparts.js';

const DEFAULT_QUICK_SALE_DISCOUNT_PERCENT = 20;

export interface AnonymousOemQuote {
  quote: string;
  listPrice?: number;
  currentPrice?: number;
  savingsPercent?: number;
}

export interface OemApplicationSummary {
  make: OemMake;
  model: string;
  yearRanges: string[];
}

export interface OemPartResearch {
  identity: {
    partNumber: string;
    description: string;
    alternateNames: string[];
    manufacturerNotes: string[];
    condition?: string;
    fitmentType?: string;
    pncCodes: string[];
    replacedBy: string[];
    replaces: string[];
  };
  brandCoverage: {
    catalogBrands: OemMake[];
    fitmentBrands: OemMake[];
    crossoverStatus: 'SINGLE_BRAND' | 'MULTI_BRAND';
  };
  pricing: {
    currency: 'USD';
    observedQuoteCount: number;
    listPriceReference?: number;
    currentPriceLow?: number;
    currentPriceHigh?: number;
    anonymousQuotes: AnonymousOemQuote[];
  };
  quickSale: {
    targetPrice?: number;
    lowPrice?: number;
    highPrice?: number;
    discountPercent: number;
    basis: 'LOWEST_CURRENT_OEM_QUOTE' | 'UNAVAILABLE';
    disclaimer: string;
  };
  images: Array<{
    url: string;
    type: 'ACTUAL_PRODUCT_PHOTO' | 'CATALOG_ILLUSTRATION';
    alt?: string;
  }>;
  fitment: LexusPartFitment[];
  fitmentTotal: number;
  catalogChecks: {
    attempted: 3;
    exactMatches: number;
    unavailable: number;
    retrievedAt: string;
  };
  dealerIdentityExposed: false;
  vinConfirmationRequired: true;
}

export interface ResearchOemPartOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  quickSaleDiscountPercent?: number;
  lookups?: {
    lexus?: (partNumber: string, options?: ResearchLexusPartOptions) => Promise<LexusPartResearch>;
    toyota?: (partNumber: string, options?: ResearchLexusPartOptions) => Promise<LexusPartResearch>;
    scion?: (partNumber: string, options?: RevolutionPartsOptions) => Promise<LexusPartResearch>;
  };
}

function normalizedPartNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return roundMoney(value as number);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = value?.trim();
    const key = trimmed?.toUpperCase();
    if (!trimmed || !key || seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

function sanitizePublicText(value: string): string {
  return value
    .replace(/https?:\/\/\S+|www\.\S+/gi, '[redacted]')
    .replace(/Lexus\s*Parts\s*Now|Toyota\s*Parts\s*Deal|Longo(?:\s+Toyota(?:\s+of\s+El\s+Monte)?)?|Revolution\s*Parts|Original\s*Parts\s*Giant/gi, '[redacted]')
    .replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, '[redacted]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.' -]{2,60}\s+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Highway|Hwy)\b[^|,;]*/gi, '[redacted]')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function assertDealerAnonymous(result: OemPartResearch): void {
  const serialized = JSON.stringify(result);
  if (/lexuspartsnow|toyotapartsdeal|longotoyota|revolutionparts|original\s*parts\s*giant/i.test(serialized)) {
    throw new Error('Dealer identity redaction failed closed.');
  }
  const urls = serialized.match(/https?:\\?\/\\?\/[^"\\\s]+/g) || [];
  if (urls.some((url) => !url.replace(/\\/g, '').startsWith('https://api.partquill.com/'))) {
    throw new Error('External catalog URL redaction failed closed.');
  }
  if (/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(serialized)) {
    throw new Error('Dealer contact redaction failed closed.');
  }
}

function mergeFitment(observations: LexusPartResearch[]): LexusPartFitment[] {
  const rows = new Map<string, LexusPartFitment>();
  for (const row of observations.flatMap((observation) => observation.fitment)) {
    const key = [row.yearStart, row.yearEnd, row.make, row.model, row.trimEngine, row.optionDetails]
      .map((value) => String(value || '').toUpperCase())
      .join('|');
    if (!rows.has(key)) {
      rows.set(key, {
        ...row,
        model: sanitizePublicText(row.model),
        ...(row.trimEngine ? { trimEngine: sanitizePublicText(row.trimEngine) } : {}),
        ...(row.optionDetails ? { optionDetails: sanitizePublicText(row.optionDetails) } : {}),
        raw: sanitizePublicText(row.raw)
      });
    }
  }
  return [...rows.values()].sort((a, b) =>
    a.make.localeCompare(b.make) || a.model.localeCompare(b.model) || (b.yearEnd || 0) - (a.yearEnd || 0)
  );
}

function compactYearRanges(rows: LexusPartFitment[]): string[] {
  const intervals = rows.flatMap((row) => {
    const start = row.yearStart ?? row.yearEnd;
    const end = row.yearEnd ?? row.yearStart;
    return start === undefined || end === undefined ? [] : [{ start, end }];
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  const ranges = merged.map(({ start, end }) => start === end ? String(start) : `${start}\u2013${end}`);
  return ranges.length ? ranges : ['Years not returned'];
}

export function summarizeOemApplications(rows: LexusPartFitment[]): OemApplicationSummary[] {
  const groups = new Map<string, LexusPartFitment[]>();
  for (const row of rows) {
    const key = `${row.make}|${row.model.toUpperCase()}`;
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    make: group[0]?.make as OemMake,
    model: group[0]?.model || 'Model not returned',
    yearRanges: compactYearRanges(group)
  })).sort((a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model));
}

function anonymousQuotes(observations: LexusPartResearch[]): AnonymousOemQuote[] {
  return observations
    .filter((observation) => observation.pricing.listPrice !== undefined || observation.pricing.dealerSalePrice !== undefined)
    .sort((a, b) => (a.pricing.dealerSalePrice ?? Number.MAX_VALUE) - (b.pricing.dealerSalePrice ?? Number.MAX_VALUE))
    .map((observation, index) => ({
      quote: `Quote ${String.fromCharCode(65 + index)}`,
      ...(observation.pricing.listPrice !== undefined ? { listPrice: observation.pricing.listPrice } : {}),
      ...(observation.pricing.dealerSalePrice !== undefined ? { currentPrice: observation.pricing.dealerSalePrice } : {}),
      ...(observation.pricing.savingsPercent !== undefined ? { savingsPercent: observation.pricing.savingsPercent } : {})
    }));
}

function descriptionHints(observations: LexusPartResearch[]): string[] {
  return uniqueStrings(
    observations.flatMap((observation) => [
      observation.identity.description,
      observation.identity.alternateDescription
    ])
  );
}

export async function researchOemPart(
  requestedPartNumber: string,
  options: ResearchOemPartOptions = {}
): Promise<OemPartResearch> {
  const discountPercent = options.quickSaleDiscountPercent ?? DEFAULT_QUICK_SALE_DISCOUNT_PERCENT;
  if (!Number.isFinite(discountPercent) || discountPercent < 10 || discountPercent > 40) {
    throw new Error('Quick-sale discount must be between 10% and 40%.');
  }
  const shared = { fetch: options.fetch, now: options.now };
  const lexusLookup = options.lookups?.lexus ?? researchLexusPart;
  const toyotaLookup = options.lookups?.toyota ?? researchToyotaPart;
  const scionLookup = options.lookups?.scion ?? researchRevolutionParts;
  const primary = await Promise.allSettled([
    lexusLookup(requestedPartNumber, shared),
    toyotaLookup(requestedPartNumber, shared)
  ]);
  const observations = primary.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (observations.length === 0) {
    throw new Error(`No exact OEM catalog result was found for ${requestedPartNumber}.`);
  }
  const scion = await scionLookup(requestedPartNumber, { ...shared, descriptionHints: descriptionHints(observations) })
    .then((value) => ({ status: 'fulfilled' as const, value }))
    .catch((reason: unknown) => ({ status: 'rejected' as const, reason }));
  if (scion.status === 'fulfilled') observations.push(scion.value);

  const normalizedRequested = normalizedPartNumber(requestedPartNumber);
  const exact = observations.filter(
    (observation) => normalizedPartNumber(observation.identity.partNumber) === normalizedRequested
  );
  if (exact.length === 0) throw new Error(`No exact OEM catalog result was found for ${requestedPartNumber}.`);

  const fitment = mergeFitment(exact);
  const fitmentBrands = [...new Set(fitment.map((row) => row.make))].sort() as OemMake[];
  const catalogBrands = [...new Set([
    ...exact.map((observation) => observation.identity.manufacturer),
    ...(exact.some((observation) => observation.source.provider === 'RevolutionParts') ? ['Scion' as const] : [])
  ])].sort() as OemMake[];
  const quotes = anonymousQuotes(exact);
  const currentPrices = quotes.flatMap((quote) => quote.currentPrice === undefined ? [] : [quote.currentPrice]);
  const listPrices = quotes.flatMap((quote) => quote.listPrice === undefined ? [] : [quote.listPrice]);
  const lowestCurrentPrice = currentPrices.length ? Math.min(...currentPrices) : undefined;
  const currentPriceHigh = currentPrices.length ? Math.max(...currentPrices) : undefined;
  const disclaimer =
    'Anonymous OEM-catalog estimate only—not verified resale-market value. Confirm exact part, condition, VIN fitment, shipping, marketplace fees, cost and margin before pricing; PartQuill will not apply or publish it automatically.';
  const imageSeen = new Set<string>();
  const images = exact.flatMap((observation) => observation.images).flatMap((image) => {
    if (imageSeen.has(image.url)) return [];
    imageSeen.add(image.url);
    try {
      return [{ ...image, ...(image.alt ? { alt: sanitizePublicText(image.alt) } : {}), url: registerCatalogImage(image.url) }];
    } catch {
      return [];
    }
  }).slice(0, 8);

  const result: OemPartResearch = {
    identity: {
      partNumber: exact[0]?.identity.partNumber || requestedPartNumber.toUpperCase(),
      description: sanitizePublicText(exact[0]?.identity.description || 'OEM part'),
      alternateNames: uniqueStrings(exact.flatMap((observation) => [observation.identity.alternateDescription, observation.identity.description]))
        .filter((value) => value.toUpperCase() !== (exact[0]?.identity.description || '').toUpperCase())
        .map(sanitizePublicText),
      manufacturerNotes: uniqueStrings(exact.map((observation) => observation.identity.manufacturerNote)).map(sanitizePublicText),
      ...(uniqueStrings(exact.map((observation) => observation.identity.condition))[0]
        ? { condition: sanitizePublicText(uniqueStrings(exact.map((observation) => observation.identity.condition))[0] as string) }
        : {}),
      ...(uniqueStrings(exact.map((observation) => observation.identity.fitmentType))[0]
        ? { fitmentType: sanitizePublicText(uniqueStrings(exact.map((observation) => observation.identity.fitmentType))[0] as string) }
        : {}),
      pncCodes: uniqueStrings(exact.map((observation) => observation.identity.pncCode)).map(sanitizePublicText),
      replacedBy: uniqueStrings(exact.map((observation) => observation.identity.replacedBy)).map(sanitizePublicText),
      replaces: uniqueStrings(exact.flatMap((observation) => observation.identity.replaces)).map(sanitizePublicText)
    },
    brandCoverage: {
      catalogBrands,
      fitmentBrands,
      crossoverStatus: new Set([...catalogBrands, ...fitmentBrands]).size > 1 ? 'MULTI_BRAND' : 'SINGLE_BRAND'
    },
    pricing: {
      currency: 'USD',
      observedQuoteCount: quotes.length,
      ...(median(listPrices) !== undefined ? { listPriceReference: median(listPrices) } : {}),
      ...(lowestCurrentPrice !== undefined ? { currentPriceLow: lowestCurrentPrice } : {}),
      ...(currentPriceHigh !== undefined ? { currentPriceHigh } : {}),
      anonymousQuotes: quotes
    },
    quickSale: lowestCurrentPrice === undefined
      ? { discountPercent, basis: 'UNAVAILABLE', disclaimer }
      : {
          targetPrice: roundMoney(lowestCurrentPrice * (1 - discountPercent / 100)),
          lowPrice: roundMoney(lowestCurrentPrice * 0.75),
          highPrice: roundMoney(lowestCurrentPrice * 0.85),
          discountPercent,
          basis: 'LOWEST_CURRENT_OEM_QUOTE',
          disclaimer
        },
    images,
    fitment,
    fitmentTotal: fitment.length,
    catalogChecks: {
      attempted: 3,
      exactMatches: exact.length,
      unavailable: 3 - exact.length,
      retrievedAt: (options.now ?? (() => new Date()))().toISOString()
    },
    dealerIdentityExposed: false,
    vinConfirmationRequired: true
  };
  assertDealerAnonymous(result);
  return result;
}
