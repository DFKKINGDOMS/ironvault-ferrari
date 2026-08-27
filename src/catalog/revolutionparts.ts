import type { LexusPartFitment, LexusPartImage, LexusPartResearch, OemMake } from './lexuspartsnow.js';

const CATALOG_ORIGIN = 'https://parts.longotoyota.com';
type FetchLike = typeof fetch;

export interface RevolutionPartsOptions {
  fetch?: FetchLike;
  now?: () => Date;
  descriptionHints?: string[];
}

function normalizePartNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validatePartNumber(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{3,38}[A-Z0-9]$/.test(trimmed)) {
    throw new Error('Enter an exact OEM part number using only letters, numbers and hyphens.');
  }
  return trimmed;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function slugify(value: string): string {
  return value
    .replace(/\bS\s*\/\s*A\b/gi, 'S A')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseProductData(html: string): Record<string, unknown> {
  const match = html.match(/<script[^>]*type=["']application\/json["'][^>]*id=["']product_data["'][^>]*>\s*([\s\S]*?)\s*<\/script>/i);
  if (!match?.[1]) throw new Error('The third catalog returned no exact product data.');
  try {
    return objectValue(JSON.parse(match[1]));
  } catch {
    throw new Error('The third catalog product data could not be parsed safely.');
  }
}

function safeImageUrl(value: string): string | undefined {
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol !== 'https:' || url.hostname !== 'cdn-product-images.revolutionparts.io') return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseImages(data: Record<string, unknown>): LexusPartImage[] {
  if (!Array.isArray(data.images)) return [];
  const seen = new Set<string>();
  return data.images.flatMap((entry) => {
    const image = objectValue(entry);
    const main = objectValue(image.main);
    const url = safeImageUrl(stringValue(main.url) || '');
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const alt = stringValue(image.alt_text) || stringValue(data.title);
    return [{ url, type: 'CATALOG_ILLUSTRATION' as const, ...(alt ? { alt } : {}) }];
  });
}

function parseFitment(data: Record<string, unknown>): LexusPartFitment[] {
  if (!Array.isArray(data.fitment)) return [];
  return data.fitment.flatMap((entry) => {
    const row = objectValue(entry);
    const year = Number(row.year);
    const makeText = stringValue(row.make);
    const model = stringValue(row.model);
    if (!Number.isInteger(year) || !makeText || !model || !['Lexus', 'Toyota', 'Scion'].includes(makeText)) return [];
    const make = makeText as OemMake;
    const trims = Array.isArray(row.trims) ? row.trims.flatMap((value) => stringValue(value) || []) : [];
    const engines = Array.isArray(row.engines) ? row.engines.flatMap((value) => stringValue(value) || []) : [];
    const trimEngine = [...trims, ...engines].join(' | ') || undefined;
    return [{
      yearStart: year,
      yearEnd: year,
      make,
      model,
      ...(trimEngine ? { trimEngine } : {}),
      raw: `${year} ${make} ${model}${trimEngine ? ` | ${trimEngine}` : ''}`
    }];
  });
}

function replacedNumbers(data: Record<string, unknown>): string[] {
  const candidates = [data.superseded_skus, data.replaces, data.replaced_skus];
  return candidates.flatMap((value) => {
    if (Array.isArray(value)) return value.flatMap((entry) => stringValue(entry) || []);
    const text = stringValue(value);
    return text ? text.split(/\s*[,;]\s*/).filter(Boolean) : [];
  });
}

async function fetchCandidate(fetcher: FetchLike, url: string): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      referer: `${CATALOG_ORIGIN}/v-scion`,
      'user-agent': 'PartQuill/0.5 (+https://partquill.com)'
    },
    redirect: 'error',
    signal: AbortSignal.timeout(7_000)
  });
  if (!response.ok) throw new Error(`The third catalog returned HTTP ${response.status}.`);
  return parseProductData(await response.text());
}

export async function researchRevolutionParts(
  requestedPartNumber: string,
  options: RevolutionPartsOptions = {}
): Promise<LexusPartResearch> {
  const partNumber = validatePartNumber(requestedPartNumber);
  const normalized = normalizePartNumber(partNumber);
  const hints = [...new Set((options.descriptionHints || []).map(slugify).filter(Boolean))].slice(0, 4);
  if (hints.length === 0) throw new Error('The third catalog requires a verified description hint.');
  const fetcher = options.fetch ?? fetch;
  let data: Record<string, unknown> | undefined;
  let productUrl: string | undefined;
  const candidates = hints.map((hint) =>
    new URL(`/oem-parts/toyota-${hint}-${normalized.toLowerCase()}`, CATALOG_ORIGIN).toString()
  );
  const candidateResults = await Promise.allSettled(
    candidates.map(async (candidate) => ({ candidate, data: await fetchCandidate(fetcher, candidate) }))
  );
  for (const result of candidateResults) {
    if (result.status !== 'fulfilled') continue;
    const sku = stringValue(result.value.data.sku);
    if (sku && normalizePartNumber(sku) === normalized) {
      data = result.value.data;
      productUrl = result.value.candidate;
      break;
    }
  }
  if (!data || !productUrl) throw new Error(`No exact third-catalog result was found for ${partNumber}.`);

  const returnedPartNumber = stringValue(data.sku) as string;
  const rawTitle = stringValue(data.title) || 'OEM part';
  const description = rawTitle.replace(/\s*-\s*(?:Toyota|Lexus|Scion)\s*\([^)]*\)\s*$/i, '').trim();
  const alternateDescription = stringValue(data.also_known_as);
  const listPrice = numberValue(data.msrp);
  const dealerSalePrice = numberValue(data.price);
  const fitment = parseFitment(data);
  const discountPercent = 20;
  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const quickSale = dealerSalePrice === undefined
    ? {
        discountPercent,
        basis: 'UNAVAILABLE' as const,
        disclaimer: 'Anonymous catalog-reference estimate only; verify condition, fees, shipping, cost and margin.'
      }
    : {
        targetPrice: roundMoney(dealerSalePrice * 0.8),
        lowPrice: roundMoney(dealerSalePrice * 0.75),
        highPrice: roundMoney(dealerSalePrice * 0.85),
        discountPercent,
        basis: 'DEALER_SALE_PRICE' as const,
        disclaimer: 'Anonymous catalog-reference estimate only; verify condition, fees, shipping, cost and margin.'
      };

  return {
    source: {
      provider: 'RevolutionParts',
      url: productUrl,
      retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
      evidenceStatus: 'DEALER_CATALOG_REFERENCE',
      limitations: [
        'Catalog data can contain errors or change after retrieval.',
        'Catalog illustrations are not proof of the exact physical item.',
        'Vehicle fitment requires VIN confirmation before a compatibility claim or listing publication.'
      ]
    },
    identity: {
      manufacturer: 'Toyota',
      partNumber: returnedPartNumber,
      description,
      ...(alternateDescription && alternateDescription !== description ? { alternateDescription } : {}),
      replaces: replacedNumbers(data)
    },
    pricing: {
      currency: 'USD',
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(dealerSalePrice !== undefined ? { dealerSalePrice } : {}),
      ...(listPrice && dealerSalePrice !== undefined
        ? { savingsPercent: roundMoney(((listPrice - dealerSalePrice) / listPrice) * 100) }
        : {})
    },
    quickSale,
    images: parseImages(data),
    fitment,
    fitmentTotal: fitment.length,
    vinConfirmationRequired: true
  };
}
