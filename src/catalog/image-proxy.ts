import { createHash } from 'node:crypto';

const PUBLIC_IMAGE_ORIGIN = 'https://api.partquill.com';
const allowedHosts = new Set([
  'www.lexuspartsnow.com',
  'www.toyotapartsdeal.com',
  'cdn-product-images.revolutionparts.io'
]);
const registeredImages = new Map<string, string>();

function validateSourceUrl(sourceUrl: string): string {
  const parsed = new URL(sourceUrl);
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
    throw new Error('Catalog image source is not allowlisted.');
  }
  return parsed.toString();
}

export function registerCatalogImage(sourceUrl: string): string {
  const safeSource = validateSourceUrl(sourceUrl);
  const id = createHash('sha256').update(safeSource).digest('hex').slice(0, 40);
  registeredImages.set(id, safeSource);
  return `${PUBLIC_IMAGE_ORIGIN}/v1/catalog/images/${id}`;
}

export function resolveCatalogImage(id: string): string | undefined {
  if (!/^[a-f0-9]{40}$/.test(id)) return undefined;
  return registeredImages.get(id);
}

export function clearCatalogImagesForTest(): void {
  registeredImages.clear();
}
