import type { AppConfig } from '../config.js';
import type { GmCatalogPart } from '../catalog/gm-catalog.js';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import type { EbayReferenceCandidate, EbayReferenceImage } from './reference-types.js';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

export interface EbayBrowseItem {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  categoryId?: string;
  categoryPath?: string;
  categories?: Array<{ categoryId?: string; categoryName?: string }>;
  image?: { imageUrl?: string };
  additionalImages?: Array<{ imageUrl?: string }>;
  thumbnailImages?: Array<{ imageUrl?: string }>;
  localizedAspects?: Array<{ name?: string; value?: string }>;
}

interface SearchResponse {
  itemSummaries?: EbayBrowseItem[];
}

export interface EbayReferenceProvider {
  searchExact(partNumber: string, catalog: GmCatalogPart): Promise<EbayReferenceCandidate | undefined>;
}

const STOP_WORDS = new Set([
  'and', 'for', 'from', 'genuine', 'new', 'nos', 'oem', 'old', 'original', 'part', 'parts',
  'the', 'through', 'with', 'without', 'all', 'models', 'model', 'vehicle', 'vehicles'
]);

const AUTO_IDENTITY_WORDS = new Set([
  'brake', 'booster', 'cylinder', 'filter', 'kit', 'master', 'moraine', 'power', 'repair',
  'vacuum', 'valve', 'seal', 'gasket', 'switch', 'bracket', 'lamp', 'cleaner', 'element',
  'bearing', 'belt', 'pump', 'housing', 'steering', 'knuckle', 'spring', 'shaft', 'wheel'
]);

const KNOWN_AUTOMAKERS = new Set([
  'audi', 'bmw', 'cadillac', 'chevrolet', 'chrysler', 'dodge', 'ferrari', 'ford', 'gmc',
  'honda', 'hyundai', 'jeep', 'lexus', 'mazda', 'mercedes', 'nissan', 'oldsmobile',
  'pontiac', 'porsche', 'subaru', 'tesla', 'toyota', 'volkswagen', 'volvo'
]);

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [];
}

function exactToken(value: string, partNumber: string): boolean {
  const escaped = partNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Z0-9])${escaped}(?:$|[^A-Z0-9])`, 'i').test(value);
}

function aspectValues(item: EbayBrowseItem, names: RegExp): string[] {
  return (item.localizedAspects ?? [])
    .filter((aspect) => names.test(aspect.name ?? ''))
    .map((aspect) => aspect.value?.trim())
    .filter((value): value is string => Boolean(value));
}

function validEbayItemUrl(value: string | undefined, itemId: string): string | undefined {
  const legacyId = itemId.match(/(?:^|\|)(\d{9,15})(?:\||$)/)?.[1] ?? itemId.match(/^\d{9,15}$/)?.[0];
  if (!legacyId) return undefined;
  if (value) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !(url.hostname === 'ebay.com' || url.hostname.endsWith('.ebay.com'))) return undefined;
    } catch {
      return undefined;
    }
  }
  return `https://www.ebay.com/itm/${legacyId}`;
}

function validEbayImageUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'i.ebayimg.com') return undefined;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function catalogTerms(catalog: GmCatalogPart): Set<string> {
  const values = [
    catalog.productType,
    catalog.description,
    ...catalog.divisions,
    ...catalog.applications.flatMap((application) => [
      application.partName,
      application.description,
      application.groupHeading,
      application.componentFamily,
      application.supplier
    ])
  ].filter((value): value is string => Boolean(value));
  return new Set(values.flatMap(words).filter((word) => !STOP_WORDS.has(word)));
}

function hasConflictingBrand(item: EbayBrowseItem, catalog: GmCatalogPart): boolean {
  const allowed = new Set([
    'acdelco', 'delco', 'gm', 'general motors', 'moraine',
    ...catalog.divisions.map((division) => division.toLowerCase())
  ]);
  return aspectValues(item, /^brand$/i).some((brand) => {
    const normalized = brand.toLowerCase().trim();
    return KNOWN_AUTOMAKERS.has(normalized) && !allowed.has(normalized);
  });
}

export function selectExactEbayReference(
  partNumber: string,
  catalog: GmCatalogPart,
  item: EbayBrowseItem,
  maxImages = 3
): EbayReferenceCandidate | undefined {
  const exactPart = canonicalOemPartNumber(partNumber);
  const itemId = item.itemId?.trim();
  const title = item.title?.replace(/\s+/g, ' ').trim();
  if (!exactPart || !itemId || !title) return undefined;

  const mpnValues = aspectValues(item, /^(manufacturer part number|mpn|oem(?: part)? number)$/i);
  const exactMpn = mpnValues.some((value) => canonicalOemPartNumber(value) === exactPart);
  if (mpnValues.length && !exactMpn) return undefined;
  if (!exactMpn && !exactToken(title, exactPart)) return undefined;
  if (hasConflictingBrand(item, catalog)) return undefined;

  const terms = catalogTerms(catalog);
  const sharedTerms = [...new Set(words(title))]
    .filter((word) => terms.has(word) && AUTO_IDENTITY_WORDS.has(word));
  if (sharedTerms.length < 2) return undefined;

  const categoryId = item.categoryId ?? item.categories?.at(-1)?.categoryId ?? null;
  const categoryPath = item.categoryPath
    ?? item.categories?.map((category) => category.categoryName).filter(Boolean).join(' › ')
    ?? null;
  if (categoryPath && !/(motor|automotive|parts|brake)/i.test(categoryPath)) return undefined;

  const sourceUrl = validEbayItemUrl(item.itemWebUrl, itemId);
  if (!sourceUrl) return undefined;
  const imageUrls = [
    item.image?.imageUrl,
    ...(item.additionalImages ?? []).map((image) => image.imageUrl),
    ...(item.thumbnailImages ?? []).map((image) => image.imageUrl)
  ]
    .map(validEbayImageUrl)
    .filter((url): url is string => Boolean(url));
  const uniqueImages = [...new Set(imageUrls)].slice(0, Math.min(3, Math.max(1, maxImages)));
  if (!uniqueImages.length) return undefined;
  const images: EbayReferenceImage[] = uniqueImages.map((url, index) => ({
    url,
    alt: `Live eBay reference ${index + 1} for OEM part ${exactPart}`
  }));

  return {
    sourceItemId: itemId,
    sourceUrl,
    title,
    categoryId,
    categoryPath,
    images,
    matchEvidence: [
      exactMpn ? 'Exact Manufacturer Part Number aspect' : 'Exact OEM number token in title',
      `Automotive identity agrees: ${sharedTerms.slice(0, 5).join(', ')}`,
      'Search restricted to eBay Motors Parts & Accessories'
    ]
  };
}

export class EbayBrowseReferenceClient implements EbayReferenceProvider {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly config: AppConfig) {}

  private async applicationToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!this.config.EBAY_CLIENT_ID || !this.config.EBAY_CLIENT_SECRET) {
      throw new Error('eBay application credentials are not configured');
    }
    const credentials = Buffer.from(`${this.config.EBAY_CLIENT_ID}:${this.config.EBAY_CLIENT_SECRET}`).toString('base64');
    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope'
      }),
      signal: AbortSignal.timeout(8_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`eBay application token failed (${response.status})`);
    const parsed = JSON.parse(body) as TokenResponse;
    if (!parsed.access_token) throw new Error('eBay application token response was incomplete');
    this.token = {
      value: parsed.access_token,
      expiresAt: Date.now() + Math.max(300, parsed.expires_in ?? 7_200) * 1_000
    };
    return parsed.access_token;
  }

  private async request(path: string): Promise<unknown> {
    const response = await fetch(`https://api.ebay.com${path}`, {
      headers: {
        Authorization: `Bearer ${await this.applicationToken()}`,
        Accept: 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
      },
      signal: AbortSignal.timeout(10_000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`eBay Browse API failed (${response.status})`);
    return body ? JSON.parse(body) : {};
  }

  async searchExact(partNumber: string, catalog: GmCatalogPart): Promise<EbayReferenceCandidate | undefined> {
    const exactPart = canonicalOemPartNumber(partNumber);
    const query = new URLSearchParams({ q: exactPart, category_ids: '6028', limit: '20' });
    const search = await this.request(`/buy/browse/v1/item_summary/search?${query.toString()}`) as SearchResponse;
    const likely = (search.itemSummaries ?? [])
      .filter((item) => exactToken(item.title ?? '', exactPart))
      .slice(0, 5);
    for (const summary of likely) {
      if (!summary.itemId) continue;
      const detail = await this.request(`/buy/browse/v1/item/${encodeURIComponent(summary.itemId)}`) as EbayBrowseItem;
      const candidate = selectExactEbayReference(exactPart, catalog, { ...summary, ...detail }, this.config.EBAY_REFERENCE_MAX_IMAGES);
      if (candidate) return candidate;
    }
    return undefined;
  }
}
