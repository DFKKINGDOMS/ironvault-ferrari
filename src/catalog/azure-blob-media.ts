import type { AppConfig } from '../config.js';
import { managedIdentityAccessToken } from '../azure/managed-identity.js';

const STORAGE_RESOURCE = 'https://storage.azure.com/';
const MAX_CATALOG_SCAN_BYTES = 20 * 1024 * 1024;

export interface AzureCatalogScan {
  bytes: Buffer;
  contentType: string;
}

export function azureCatalogScanUrl(config: AppConfig, pageFolder: string): URL | undefined {
  if (!config.AZURE_STORAGE_ACCOUNT_NAME || !config.GM_CATALOG_MEDIA_CONTAINER) return undefined;
  const prefix = config.GM_CATALOG_MEDIA_PREFIX.replace(/^\/+|\/+$/g, '');
  const path = [config.GM_CATALOG_MEDIA_CONTAINER, ...prefix.split('/'), pageFolder, 'full_page.png']
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return new URL(`https://${config.AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net/${path}`);
}

export async function loadAzureCatalogScan(config: AppConfig, pageFolder: string): Promise<AzureCatalogScan | undefined> {
  const url = azureCatalogScanUrl(config, pageFolder);
  if (!url) return undefined;

  const token = await managedIdentityAccessToken(STORAGE_RESOURCE);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-ms-version': '2023-11-03'
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Azure catalog blob request failed with HTTP ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_CATALOG_SCAN_BYTES) {
    throw new Error('Azure catalog blob returned an invalid image size');
  }
  const responseType = response.headers.get('content-type')?.split(';')[0]?.trim();
  const contentType = responseType?.startsWith('image/')
    ? responseType
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? 'image/png'
      : undefined;
  if (!contentType) throw new Error('Azure catalog blob returned a non-image response');
  return { bytes, contentType };
}
