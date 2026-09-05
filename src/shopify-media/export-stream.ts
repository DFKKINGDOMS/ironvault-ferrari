import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { canonicalShopifyUrl, exactMediaPartNumbers, mediaFilename } from './policy.js';

type JsonObject = Record<string, unknown>;

export type ShopifyMediaQueuePass = 'MAPPED' | 'UNMAPPED';

export interface ShopifyMediaCandidate {
  id: string;
  filename: string;
  alt: string | null;
  url: string;
  canonicalUrl: string;
  mimeType: string;
  width: number;
  height: number;
  productIds: Set<string>;
  productSkus: string[];
  partNumbers: string[];
  source: 'SHOPIFY_PRODUCT_MEDIA' | 'SHOPIFY_CONTENT_FILE_EXACT_KEY';
}

export interface ShopifyExportScan {
  productSkus: Map<string, string[]>;
  mediaRows: number;
}

function parseLine(line: string): JsonObject {
  try {
    return JSON.parse(line) as JsonObject;
  } catch {
    throw new Error('SOURCE: Shopify export contains malformed JSONL');
  }
}

function imageData(row: JsonObject): { url: string; width: number; height: number; alt: string | null } | null {
  const image = row.image;
  if (!image || typeof image !== 'object') return null;
  const value = image as JsonObject;
  const url = String(value.url || '');
  return url ? {
    url,
    width: Number(value.width || 0),
    height: Number(value.height || 0),
    alt: value.altText == null ? null : String(value.altText).slice(0, 512)
  } : null;
}

function isMediaImage(row: JsonObject): boolean {
  const id = String(row.id || '');
  return String(row.__typename || '') === 'MediaImage' || id.startsWith('gid://shopify/MediaImage/');
}

export async function scanShopifyExport(path: string): Promise<ShopifyExportScan> {
  const productSkus = new Map<string, string[]>();
  let mediaRows = 0;
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = parseLine(line);
    const id = String(row.id || '');
    const parent = String(row.__parentId || '');
    if (id.startsWith('gid://shopify/ProductVariant/') && parent.startsWith('gid://shopify/Product/')) {
      const sku = String(row.sku || '').trim();
      if (sku) {
        const current = productSkus.get(parent) || [];
        if (!current.includes(sku)) current.push(sku);
        productSkus.set(parent, current);
      }
      continue;
    }
    if (!isMediaImage(row)) continue;
    const image = imageData(row);
    if (id && image && image.width > 0 && image.height > 0 && canonicalShopifyUrl(image.url)) mediaRows += 1;
  }
  return { productSkus, mediaRows };
}

export function shopifyCandidateFromRow(
  row: JsonObject,
  productSkusByProduct: ReadonlyMap<string, string[]>
): ShopifyMediaCandidate | null {
  const id = String(row.id || '');
  if (!id || !isMediaImage(row)) return null;
  const image = imageData(row);
  if (!image) return null;
  const canonicalUrl = canonicalShopifyUrl(image.url);
  if (!canonicalUrl || image.width < 1 || image.height < 1) return null;
  const parent = String(row.__parentId || '');
  const attachedToProduct = parent.startsWith('gid://shopify/Product/');
  const productSkus = attachedToProduct ? [...(productSkusByProduct.get(parent) || [])] : [];
  const filename = mediaFilename(image.url);
  const alt = row.alt == null ? image.alt : String(row.alt).slice(0, 512);
  const partNumbers = exactMediaPartNumbers({ filename, alt, productSkus }).sort();
  return {
    id,
    filename,
    alt,
    url: image.url,
    canonicalUrl,
    mimeType: String(row.mimeType || '').slice(0, 100),
    width: image.width,
    height: image.height,
    productIds: new Set(attachedToProduct ? [parent] : []),
    productSkus,
    partNumbers,
    source: attachedToProduct && partNumbers.length
      ? 'SHOPIFY_PRODUCT_MEDIA'
      : 'SHOPIFY_CONTENT_FILE_EXACT_KEY'
  };
}

export function shopifyCandidateKey(candidate: ShopifyMediaCandidate): string {
  return createHash('sha256')
    .update(JSON.stringify({
      id: candidate.id,
      source: candidate.source,
      productIds: [...candidate.productIds].sort(),
      partNumbers: candidate.partNumbers,
      canonicalUrl: candidate.canonicalUrl
    }))
    .digest('hex');
}

export async function* streamShopifyCandidates(
  path: string,
  productSkusByProduct: ReadonlyMap<string, string[]>,
  pass: ShopifyMediaQueuePass | 'ALL'
): AsyncGenerator<ShopifyMediaCandidate> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const candidate = shopifyCandidateFromRow(parseLine(line), productSkusByProduct);
    if (!candidate) continue;
    const mapped = candidate.partNumbers.length > 0;
    if (pass === 'MAPPED' && !mapped) continue;
    if (pass === 'UNMAPPED' && mapped) continue;
    yield candidate;
  }
}
