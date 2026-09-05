import { basename } from 'node:path';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';

const NON_PRODUCT_TEXT = /(?:^|[._ -])(?:logo|logomark|brandmark|favicon|app[-_ ]?icon|social[-_ ]?icon|header|footer|banner|badge|payment|trust|placeholder|no[-_ ]?image|coming[-_ ]?soon|watermark[-_ ]?sample)(?:$|[._ -])/i;
const IMPORT_EXPORT_BRANDING = /(?:^|[._ -])import[-_ ]?export(?:[-_ ]?auto[-_ ]?parts)?[-_ ]?(?:logo|brand|mark|banner|header|watermark)(?:$|[._ -])/i;
const FILE_SUFFIX = /(?:[-_ ](?:verified|clean|edited|edit|final|white|web|shopify|front|rear|back|side|top|bottom|detail|angle|view|image|img|photo|pic|primary|hero))*(?:[-_ ]\d{1,3})*$/i;
const STRICT_KEY = /^[A-Z0-9][A-Z0-9./_-]{3,62}[A-Z0-9]$/;

export function mediaFilename(url: string): string {
  try {
    const path = new URL(url).pathname;
    return decodeURIComponent(basename(path)).slice(0, 240) || 'shopify-image';
  } catch {
    return 'shopify-image';
  }
}

export function isTextQuarantined(filename: string, alt?: string | null): boolean {
  const value = `${filename} ${alt ?? ''}`;
  return NON_PRODUCT_TEXT.test(value) || IMPORT_EXPORT_BRANDING.test(value);
}

function acceptedCandidate(value: string): string | null {
  const trimmed = value.trim().toUpperCase().replace(/[\u2010-\u2015\u2212]/g, '-');
  if (!STRICT_KEY.test(trimmed) || !/\d/.test(trimmed)) return null;
  const canonical = canonicalOemPartNumber(trimmed);
  return canonical.length >= 5 && canonical.length <= 64 ? canonical : null;
}

export function exactMediaPartNumbers(input: {
  filename: string;
  alt?: string | null;
  productSkus?: string[];
}): string[] {
  const exactSkus = [...new Set((input.productSkus ?? [])
    .map(canonicalOemPartNumber)
    .filter((value) => value.length >= 5 && value.length <= 64))];
  if (exactSkus.length === 1) return exactSkus;

  const stem = input.filename.replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(FILE_SUFFIX, '');
  const filenameKey = acceptedCandidate(stem);
  const altMatch = String(input.alt ?? '').trim().match(/^(?:(?:oem|oe|mpn|sku|part(?:\s+number)?)\s*(?:#|no\.?|number|:|-)?\s*)?([A-Z0-9][A-Z0-9./_-]{3,62}[A-Z0-9])(?:\s+(?:image|photo|view)\s*\d*)?$/i);
  const altKey = altMatch?.[1] ? acceptedCandidate(altMatch[1]) : null;

  if (exactSkus.length > 1) {
    const textual = new Set([filenameKey, altKey].filter((value): value is string => Boolean(value)));
    const matched = exactSkus.filter((sku) => textual.has(sku));
    return matched.length === 1 ? matched : [];
  }
  return [...new Set([filenameKey, altKey].filter((value): value is string => Boolean(value)))];
}

export function canonicalShopifyUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.shopify.com') return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}
