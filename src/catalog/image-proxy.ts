import { createHash } from 'node:crypto';

const PUBLIC_IMAGE_ORIGIN = 'https://api.partquill.com';
const allowedHosts = new Set([
  'www.lexuspartsnow.com',
  'www.toyotapartsdeal.com',
  'cdn-product-images.revolutionparts.io'
]);
const registeredImages = new Map<string, string>();

export interface CatalogImageAttachment {
  data: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface LoadCatalogImageOptions {
  fetch?: typeof fetch;
}

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

function imageIdFromPublicUrl(publicUrl: string): string | undefined {
  try {
    const parsed = new URL(publicUrl);
    if (parsed.origin !== PUBLIC_IMAGE_ORIGIN) return undefined;
    return parsed.pathname.match(/^\/v1\/catalog\/images\/([a-f0-9]{40})$/)?.[1];
  } catch {
    return undefined;
  }
}

export async function loadCatalogImageAttachment(
  publicUrl: string,
  options: LoadCatalogImageOptions = {}
): Promise<CatalogImageAttachment | undefined> {
  const imageId = imageIdFromPublicUrl(publicUrl);
  const sourceUrl = imageId ? resolveCatalogImage(imageId) : undefined;
  if (!sourceUrl) return undefined;
  const response = await (options.fetch ?? fetch)(sourceUrl, {
    headers: {
      accept: 'image/webp,image/png,image/jpeg',
      'user-agent': 'PartQuill/0.6 (+https://partquill.com)'
    },
    redirect: 'error',
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) return undefined;
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
  if (!mimeType || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) return undefined;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 6 * 1024 * 1024) return undefined;
  return { data: bytes.toString('base64'), mimeType: mimeType as CatalogImageAttachment['mimeType'] };
}

export function clearCatalogImagesForTest(): void {
  registeredImages.clear();
}
