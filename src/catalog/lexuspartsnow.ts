const LEXUS_PARTS_NOW_ORIGIN = 'https://www.lexuspartsnow.com';
const TOYOTA_PARTS_DEAL_ORIGIN = 'https://www.toyotapartsdeal.com';
const DEFAULT_QUICK_SALE_DISCOUNT_PERCENT = 20;

type FetchLike = typeof fetch;
export type OemMake = 'Lexus' | 'Toyota' | 'Scion';

interface CatalogConfig {
  origin: string;
  siteHeader: 'LPN' | 'TPD';
  provider: 'LexusPartsNow' | 'ToyotaPartsDeal';
  make: 'Lexus' | 'Toyota';
  productPathPrefix: '/parts/' | '/oem/';
}

const LEXUS_CATALOG: CatalogConfig = {
  origin: LEXUS_PARTS_NOW_ORIGIN,
  siteHeader: 'LPN',
  provider: 'LexusPartsNow',
  make: 'Lexus',
  productPathPrefix: '/parts/'
};

const TOYOTA_CATALOG: CatalogConfig = {
  origin: TOYOTA_PARTS_DEAL_ORIGIN,
  siteHeader: 'TPD',
  provider: 'ToyotaPartsDeal',
  make: 'Toyota',
  productPathPrefix: '/oem/'
};

export interface LexusPartImage {
  url: string;
  type: 'ACTUAL_PRODUCT_PHOTO' | 'CATALOG_ILLUSTRATION';
  alt?: string;
}

export interface LexusPartFitment {
  yearStart?: number;
  yearEnd?: number;
  make: OemMake;
  model: string;
  trimEngine?: string;
  optionDetails?: string;
  raw: string;
}

export interface LexusPartResearch {
  source: {
    provider: 'LexusPartsNow' | 'ToyotaPartsDeal' | 'RevolutionParts';
    url: string;
    retrievedAt: string;
    evidenceStatus: 'DEALER_CATALOG_REFERENCE';
    limitations: string[];
  };
  identity: {
    manufacturer: 'Lexus' | 'Toyota';
    partNumber: string;
    description: string;
    alternateDescription?: string;
    manufacturerNote?: string;
    condition?: string;
    fitmentType?: string;
    pncCode?: string;
    replacedBy?: string;
    replaces: string[];
  };
  pricing: {
    currency: 'USD';
    listPrice?: number;
    dealerSalePrice?: number;
    savingsPercent?: number;
    status?: string;
  };
  quickSale: {
    targetPrice?: number;
    lowPrice?: number;
    highPrice?: number;
    discountPercent: number;
    basis: 'DEALER_SALE_PRICE' | 'UNAVAILABLE';
    disclaimer: string;
  };
  images: LexusPartImage[];
  fitment: LexusPartFitment[];
  fitmentTotal: number;
  vinConfirmationRequired: true;
}

export interface ResearchLexusPartOptions {
  fetch?: FetchLike;
  now?: () => Date;
  quickSaleDiscountPercent?: number;
}

function normalizePartNumber(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validatePartNumber(value: string, make: string): string {
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{3,38}[A-Z0-9]$/.test(trimmed)) {
    throw new Error(`Enter an exact ${make} part number using only letters, numbers and hyphens.`);
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
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replace(/[$,%\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const parsed = stringValue(entry);
      return parsed ? [parsed] : [];
    });
  }
  const single = stringValue(value);
  return single ? single.split(/\s*[,;]\s*/).filter(Boolean) : [];
}

function safeDealerUrl(value: string, config: CatalogConfig): string | undefined {
  try {
    const url = new URL(value, config.origin);
    if (url.protocol !== 'https:' || url.origin !== config.origin) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function parseInitialStore(html: string, provider: string): Record<string, unknown> {
  const match = html.match(
    /<script[^>]*id=["']initialState["'][^>]*>\s*window\.__INITIAL_STORE__\s*=\s*([\s\S]*?);?\s*<\/script>/i
  );
  if (!match?.[1]) throw new Error(`${provider} returned a page without readable catalog data.`);
  const json = match[1]
    .replace(/:\s*undefined(?=\s*[,}])/g, ':null')
    .replace(/([[,]\s*)undefined(?=\s*[,\]])/g, '$1null');
  try {
    return objectValue(JSON.parse(json));
  } catch {
    throw new Error(`${provider} catalog data could not be parsed safely.`);
  }
}

function parseFitment(value: unknown, defaultMake: 'Lexus' | 'Toyota'): LexusPartFitment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const yearMakeModel = stringValue(row[0]);
    if (!yearMakeModel) return [];
    const match = yearMakeModel.match(/^(\d{4})(?:-(\d{4}))?(?:,\s*\d{4}(?:-\d{4})?)*\s+(Lexus|Toyota|Scion)\s+(.+)$/i);
    const parsedMake = match?.[3]
      ? (`${match[3][0]?.toUpperCase()}${match[3].slice(1).toLowerCase()}` as OemMake)
      : defaultMake;
    const fitment: LexusPartFitment = {
      make: parsedMake,
      model: match?.[4]?.trim() || yearMakeModel.replace(/^.*?\s+(?:Lexus|Toyota|Scion)\s+/i, '').trim(),
      raw: [yearMakeModel, stringValue(row[1]), stringValue(row[2])].filter(Boolean).join(' | ')
    };
    if (match?.[1]) fitment.yearStart = Number(match[1]);
    if (match?.[2] || match?.[1]) fitment.yearEnd = Number(match?.[2] || match?.[1]);
    const trimEngine = stringValue(row[1]);
    const optionDetails = stringValue(row[2]);
    if (trimEngine) fitment.trimEngine = trimEngine;
    if (optionDetails) fitment.optionDetails = optionDetails;
    return [fitment];
  });
}

function parseImages(
  partNumber: Record<string, unknown>,
  partInfo: Record<string, unknown>,
  config: CatalogConfig
): LexusPartImage[] {
  const seen = new Set<string>();
  const images: LexusPartImage[] = [];
  const addImages = (value: unknown, type: LexusPartImage['type']) => {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      const image = objectValue(entry);
      const url = safeDealerUrl(stringValue(image.largeImg) || stringValue(image.img) || '', config);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const alt = stringValue(image.alt) || stringValue(image.title);
      images.push({ url, type, ...(alt ? { alt } : {}) });
    }
  };
  addImages(partInfo.actualPictures, 'ACTUAL_PRODUCT_PHOTO');
  addImages(partNumber.imageList, 'CATALOG_ILLUSTRATION');
  return images;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function quickSalePricing(dealerSalePrice: number | undefined, discountPercent: number): LexusPartResearch['quickSale'] {
  const disclaimer =
    'Dealer-anchored estimate only—not verified resale-market value. Confirm condition, shipping, marketplace fees, cost and margin before using it; PartQuill will not apply or publish it automatically.';
  if (dealerSalePrice === undefined) {
    return { discountPercent, basis: 'UNAVAILABLE', disclaimer };
  }
  return {
    targetPrice: roundMoney(dealerSalePrice * (1 - discountPercent / 100)),
    lowPrice: roundMoney(dealerSalePrice * 0.75),
    highPrice: roundMoney(dealerSalePrice * 0.85),
    discountPercent,
    basis: 'DEALER_SALE_PRICE',
    disclaimer
  };
}

async function getJson(fetcher: FetchLike, url: URL, config: CatalogConfig): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      referer: `${config.origin}/`,
      site: config.siteHeader,
      'user-agent': 'PartQuill/0.4 (+https://partquill.com)'
    },
    signal: AbortSignal.timeout(7_000)
  });
  if (!response.ok) throw new Error(`${config.provider} search failed with HTTP ${response.status}.`);
  return objectValue(await response.json());
}

async function getHtml(fetcher: FetchLike, url: string, config: CatalogConfig): Promise<string> {
  const response = await fetcher(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      referer: `${config.origin}/`,
      site: config.siteHeader,
      'user-agent': 'PartQuill/0.4 (+https://partquill.com)'
    },
    signal: AbortSignal.timeout(7_000)
  });
  if (!response.ok) throw new Error(`${config.provider} product lookup failed with HTTP ${response.status}.`);
  return response.text();
}

async function researchAutoPartsPrime(
  requestedPartNumber: string,
  config: CatalogConfig,
  options: ResearchLexusPartOptions = {}
): Promise<LexusPartResearch> {
  const partNumberInput = validatePartNumber(requestedPartNumber, config.make);
  const requestedNormalized = normalizePartNumber(partNumberInput);
  const discountPercent = options.quickSaleDiscountPercent ?? DEFAULT_QUICK_SALE_DISCOUNT_PERCENT;
  if (!Number.isFinite(discountPercent) || discountPercent < 10 || discountPercent > 40) {
    throw new Error('Quick-sale discount must be between 10% and 40%.');
  }
  const fetcher = options.fetch ?? fetch;
  const searchUrl = new URL('/api/search/search-words', config.origin);
  searchUrl.searchParams.set('searchText', partNumberInput);
  searchUrl.searchParams.set('isConflict', 'false');
  const searchPayload = await getJson(fetcher, searchUrl, config);
  const redirectPath = stringValue(objectValue(searchPayload.data).redirectUrl);
  if (!redirectPath) throw new Error(`No ${config.provider} catalog result was found for ${partNumberInput}.`);
  const productUrl = safeDealerUrl(redirectPath, config);
  if (!productUrl || !new URL(productUrl).pathname.startsWith(config.productPathPrefix)) {
    throw new Error(`${config.provider} returned an unsafe or unexpected catalog URL.`);
  }

  const store = parseInitialStore(await getHtml(fetcher, productUrl, config), config.provider);
  const partNumber = objectValue(store.partNumber);
  const partInfo = objectValue(partNumber.partInfo);
  const priceInfo = objectValue(partInfo.priceInfo ?? partNumber.priceInfo);
  const returnedPartNumber = stringValue(partInfo.partNumber) || stringValue(partInfo.partNumberAbbr);
  if (!returnedPartNumber || normalizePartNumber(returnedPartNumber) !== requestedNormalized) {
    throw new Error(`The dealer result did not exactly match requested part number ${partNumberInput}.`);
  }

  const specifications = new Map<string, string>();
  if (Array.isArray(partInfo.specificationList)) {
    for (const entry of partInfo.specificationList) {
      const specification = objectValue(entry);
      const name = stringValue(specification.name);
      const description = stringValue(specification.desc);
      if (name && description) specifications.set(name.toLowerCase(), description);
    }
  }
  const description =
    stringValue(partInfo.mainDesc) || specifications.get('part description') || stringValue(partInfo.subDesc) || 'Lexus part';
  const alternateDescription =
    specifications.get('other names') || stringValue(partInfo.subDesc) || specifications.get('part description');
  const manufacturerNote = specifications.get('manufacturer note');
  const condition = specifications.get('condition');
  const fitmentType = specifications.get('fitment type');
  const pncCode = stringValue(partInfo.pncCode) || specifications.get('pnc code');
  const replacedBy = stringValue(partInfo.replacedBy);
  const replaces = stringList(partInfo.replaces);
  const listPrice = numberValue(priceInfo.retail);
  const dealerSalePrice = numberValue(priceInfo.price) ?? numberValue(priceInfo.rawPrice);
  const rawSavings = stringValue(priceInfo.save);
  const savingsPercent = rawSavings?.includes('%')
    ? numberValue(rawSavings)
    : listPrice !== undefined && dealerSalePrice !== undefined && listPrice > 0
      ? roundMoney(((listPrice - dealerSalePrice) / listPrice) * 100)
      : undefined;
  const status = stringValue(priceInfo.partStatus);
  const fitment = parseFitment(partNumber.fitVehicleList, config.make);

  return {
    source: {
      provider: config.provider,
      url: productUrl,
      retrievedAt: (options.now ?? (() => new Date()))().toISOString(),
      evidenceStatus: 'DEALER_CATALOG_REFERENCE',
      limitations: [
        'Dealer catalog data can contain errors or change after retrieval.',
        'Catalog diagrams may be general illustrations and are not proof of the exact physical item.',
        'Vehicle fitment requires VIN confirmation before a compatibility claim or listing publication.'
      ]
    },
    identity: {
      manufacturer: config.make,
      partNumber: returnedPartNumber,
      description,
      ...(alternateDescription && alternateDescription !== description ? { alternateDescription } : {}),
      ...(manufacturerNote ? { manufacturerNote } : {}),
      ...(condition ? { condition } : {}),
      ...(fitmentType ? { fitmentType } : {}),
      ...(pncCode ? { pncCode } : {}),
      ...(replacedBy ? { replacedBy } : {}),
      replaces
    },
    pricing: {
      currency: 'USD',
      ...(listPrice !== undefined ? { listPrice } : {}),
      ...(dealerSalePrice !== undefined ? { dealerSalePrice } : {}),
      ...(savingsPercent !== undefined ? { savingsPercent } : {}),
      ...(status ? { status } : {})
    },
    quickSale: quickSalePricing(dealerSalePrice, discountPercent),
    images: parseImages(partNumber, partInfo, config),
    fitment,
    fitmentTotal: fitment.length,
    vinConfirmationRequired: true
  };
}

export async function researchLexusPart(
  requestedPartNumber: string,
  options: ResearchLexusPartOptions = {}
): Promise<LexusPartResearch> {
  return researchAutoPartsPrime(requestedPartNumber, LEXUS_CATALOG, options);
}

export async function researchToyotaPart(
  requestedPartNumber: string,
  options: ResearchLexusPartOptions = {}
): Promise<LexusPartResearch> {
  return researchAutoPartsPrime(requestedPartNumber, TOYOTA_CATALOG, options);
}
