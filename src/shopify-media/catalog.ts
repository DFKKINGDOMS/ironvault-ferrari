import { z } from 'zod';
import { canonicalOemPartNumber } from '../catalog/gm-catalog-quality.js';
import type { ImageJobStore } from '../image-studio/file-store.js';
import {
  SHOPIFY_MEDIA_JOB_ID,
  SHOPIFY_MEDIA_PROFILE,
  SHOPIFY_MEDIA_PUBLIC_SOURCE,
  SHOPIFY_MEDIA_SOURCE_STORE,
  type PublicShopifyMediaMatch,
  type PublicShopifyMediaPipelineStatus,
  type ShopifyMediaPipelineStatus,
  type ShopifyPartMediaIndex
} from './types.js';

const assetSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{16,64}$/),
  source: z.enum(['SHOPIFY_PRODUCT_MEDIA', 'SHOPIFY_CONTENT_FILE_EXACT_KEY']),
  sourceStore: z.literal(SHOPIFY_MEDIA_SOURCE_STORE),
  shopifyFileId: z.string().min(1).max(160),
  shopifyProductId: z.string().max(160).optional(),
  shopifyMediaId: z.string().max(160).optional(),
  filename: z.string().min(1).max(240),
  alt: z.string().max(512).nullable(),
  partNumbers: z.array(z.string().regex(/^[A-Z0-9]{5,64}$/)).min(1).max(20),
  sourceUrl: z.string().url(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  originalPath: z.string().min(1).max(500),
  derivativePath: z.string().min(1).max(500),
  derivativeSha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  qa: z.object({
    status: z.literal('PASSED'),
    profile: z.literal(SHOPIFY_MEDIA_PROFILE),
    classifierModel: z.string().min(1).max(120),
    comparisonModel: z.string().min(1).max(120),
    editModel: z.string().min(1).max(120),
    reason: z.string().min(1).max(1_000),
    checkedAt: z.string(),
    output: z.object({
      width: z.literal(2000),
      height: z.literal(2000),
      mediaType: z.literal('image/jpeg'),
      colorSpace: z.literal('srgb'),
      metadataStripped: z.literal(true),
      background: z.literal('#FFFFFF')
    })
  }),
  createdAt: z.string(),
  updatedAt: z.string()
});

const indexSchema = z.object({
  id: z.string(),
  schemaVersion: z.literal(1),
  partNumber: z.string().regex(/^[A-Z0-9]{5,64}$/),
  sourceStore: z.literal(SHOPIFY_MEDIA_SOURCE_STORE),
  profile: z.literal(SHOPIFY_MEDIA_PROFILE),
  assets: z.array(assetSchema).max(50),
  updatedAt: z.string()
});

const statusSchema = z.object({
  id: z.literal(SHOPIFY_MEDIA_JOB_ID),
  schemaVersion: z.literal(1),
  sourceStore: z.literal(SHOPIFY_MEDIA_SOURCE_STORE),
  phase: z.enum(['AWAITING_EXPORT', 'CANARY', 'PROCESSING', 'COMPLETE', 'CONFIGURATION_HOLD']),
  canaryPartNumber: z.string(),
  canaryPassed: z.boolean(),
  exportOperationId: z.string().optional(),
  exportObjectCount: z.number().int().nonnegative().optional(),
  discovered: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  quarantinedLogos: z.number().int().nonnegative(),
  quarantinedNonProduct: z.number().int().nonnegative(),
  unmapped: z.number().int().nonnegative(),
  retrying: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  updatedAt: z.string()
});

function notFound(error: unknown): boolean {
  const value = error as { statusCode?: number; code?: string };
  return value.statusCode === 404 || value.code === 'ENOENT';
}

export class ShopifyMediaCatalog {
  constructor(private readonly store: ImageJobStore) {}

  indexPath(partNumber: string): string {
    const key = canonicalOemPartNumber(partNumber);
    return this.store.artifactPath(SHOPIFY_MEDIA_JOB_ID, 'indexes', `${key}.json`);
  }

  async lookup(partNumber: string): Promise<PublicShopifyMediaMatch | null> {
    const key = canonicalOemPartNumber(partNumber);
    if (key.length < 5 || key.length > 64) return null;
    let raw: Uint8Array;
    try {
      raw = await this.store.readBytes(this.indexPath(key));
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
    const index = indexSchema.parse(JSON.parse(Buffer.from(raw).toString('utf8'))) as ShopifyPartMediaIndex;
    if (index.partNumber !== key) return null;
    const exactAssets = index.assets.filter((asset) => asset.partNumbers.includes(key));
    if (!exactAssets.length) return null;
    return {
      partNumber: key,
      sourceStore: SHOPIFY_MEDIA_PUBLIC_SOURCE,
      updatedAt: index.updatedAt,
      assets: exactAssets.map((asset, index) => ({
        id: asset.id,
        filename: `${key}-${String(index + 1).padStart(2, '0')}.jpg`,
        alt: `Merchant product image ${index + 1} for part ${key}`,
        width: asset.qa.output.width,
        height: asset.qa.output.height,
        viewUrl: `/v1/shopify-media/parts/${encodeURIComponent(key)}/images/${asset.id}`,
        source: asset.source,
        rightsState: 'MERCHANT_OWNED_OR_AUTHORIZED',
        mappingState: asset.source === 'SHOPIFY_PRODUCT_MEDIA' ? 'EXACT_SHOPIFY_SKU' : 'EXACT_FILE_KEY',
        qaState: 'FERRARI_RULES_PASSED',
        sourceSha256: asset.sourceSha256,
        derivativeSha256: asset.derivativeSha256,
        requiresActualItemConfirmation: true
      }))
    };
  }

  async readImage(partNumber: string, assetId: string): Promise<Uint8Array | null> {
    const key = canonicalOemPartNumber(partNumber);
    if (!/^[a-f0-9]{16,64}$/.test(assetId)) return null;
    let raw: Uint8Array;
    try {
      raw = await this.store.readBytes(this.indexPath(key));
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
    const index = indexSchema.parse(JSON.parse(Buffer.from(raw).toString('utf8')));
    if (index.partNumber !== key) return null;
    const asset = index.assets.find((row) => row.id === assetId);
    if (!asset || asset.qa.status !== 'PASSED' || asset.qa.profile !== SHOPIFY_MEDIA_PROFILE) return null;
    if (!asset.partNumbers.includes(key)) return null;
    const expectedPath = this.store.artifactPath(
      SHOPIFY_MEDIA_JOB_ID,
      'derivatives',
      `${asset.sourceSha256}-${SHOPIFY_MEDIA_PROFILE}.jpg`
    );
    if (asset.derivativePath !== expectedPath) return null;
    try {
      return await this.store.readBytes(asset.derivativePath);
    } catch (error) {
      if (notFound(error)) return null;
      throw error;
    }
  }

  async status(): Promise<PublicShopifyMediaPipelineStatus | null> {
    const value = await this.store.getJob<ShopifyMediaPipelineStatus>(SHOPIFY_MEDIA_JOB_ID);
    if (!value) return null;
    const { exportOperationId: _exportOperationId, lastError: _lastError, ...status } = statusSchema.parse(value);
    return {
      ...status,
      sourceStore: SHOPIFY_MEDIA_PUBLIC_SOURCE,
      configurationBlocked: status.phase === 'CONFIGURATION_HOLD'
    };
  }
}
