import type { AppConfig } from '../src/config.js';
import type { ListingPayload } from '../src/domain/types.js';
import { MockEbayGateway } from '../src/ebay/mock-gateway.js';
import { PartQuillService } from '../src/services/partquill-service.js';
import { MemoryStore } from '../src/store/memory-store.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    PORT: 3000,
    HOST: '127.0.0.1',
    PARTQUILL_API_KEY: 'test-api-key-that-is-long-enough',
    OAUTH_STATE_SECRET: 'test-oauth-secret-that-is-long-enough',
    DATABASE_AUTH_MODE: 'password',
    MIGRATION_GITHUB_OIDC_ENABLED: false,
    GM_CATALOG_SCAN_DIR: 'data/gm-scans/pages',
    GM_CATALOG_MEDIA_PREFIX: 'gm-scans/pages',
    PILOT_EPHEMERAL_MODE: false,
    EBAY_ENV: 'sandbox',
    EBAY_MODE: 'mock',
    ALLOW_EBAY_WRITES: true,
    EBAY_REFERENCE_DISCOVERY_MODE: 'disabled',
    EBAY_REFERENCE_CACHE_HOURS: 5.5,
    EBAY_REFERENCE_NEGATIVE_CACHE_HOURS: 24,
    EBAY_REFERENCE_MAX_IMAGES: 3,
    PUBLIC_BASE_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:5173',
    PARTQUILL_WORKSPACE_NAME: 'PartQuill Workspace',
    PARTQUILL_WORKSPACE_LABEL: 'Organization account',
    PARTQUILL_WORKSPACE_INITIALS: 'PQ',
    PARTQUILL_AI_PROVIDER: 'disabled',
    IMAGE_STUDIO_MODE: 'preview',
    IMAGE_STUDIO_STORAGE_MODE: 'local',
    IMAGE_STUDIO_STORAGE_DIR: '.partquill-image-studio-test',
    IMAGE_STUDIO_STORAGE_PREFIX: 'image-studio',
    IMAGE_STUDIO_MAX_IMAGES: 24,
    IMAGE_STUDIO_CONCURRENCY: 3,
    SHOPIFY_MEDIA_ENABLED: false,
    COMMUNITY_IMAGES_ENABLED: false,
    COMMUNITY_EDIT_MODE: 'chatgpt-manual',
    COMMUNITY_IMAGE_MAX_IMAGES: 50,
    COMMUNITY_UPLOAD_RATE_LIMIT_MAX: 3,
    COMMUNITY_UPLOAD_RATE_LIMIT_WINDOW_MS: 3_600_000,
    COMMUNITY_GITHUB_REPOSITORY: 'DFKKINGDOMS/ironvault-ferrari',
    COMMUNITY_GITHUB_BRANCH: 'main',
    OEM_RESEARCH_MODE: 'disabled',
    OEM_DATA_RIGHTS_CONFIRMED: false,
    MCP_RATE_LIMIT_MAX: 30,
    MCP_RATE_LIMIT_WINDOW_MS: 60_000,
    MCP_MAX_BODY_BYTES: 1_048_576,
    MCP_MAX_CONCURRENCY: 4,
    SELLER_PREVIEW_RATE_LIMIT_MAX: 60,
    SELLER_PREVIEW_RATE_LIMIT_WINDOW_MS: 60_000,
    SELLER_PREVIEW_MAX_CONCURRENCY: 8,
    SELLER_ASSISTANT_RATE_LIMIT_MAX: 20,
    SELLER_ASSISTANT_RATE_LIMIT_WINDOW_MS: 60_000,
    SELLER_ASSISTANT_MAX_CONCURRENCY: 3,
    ...overrides
  };
}

export function validPayload(overrides: Partial<ListingPayload> = {}): ListingPayload {
  return {
    sku: 'WIX-51040-1',
    title: 'WIX 51040 Engine Oil Filter New',
    description: 'New boxed WIX oil filter. Verify the part number before purchase.',
    condition: 'NEW',
    conditionId: '1000',
    categoryId: '33661',
    brand: 'WIX',
    mpn: '51040',
    price: { currency: 'USD', value: '12.99' },
    quantity: 1,
    aspects: {
      Brand: ['WIX'],
      'Manufacturer Part Number': ['51040'],
      'OE/OEM Part Number': ['51040'],
      'California Prop 65 Warning': ['No']
    },
    compatibility: [],
    internationalEligible: false,
    imageIds: [],
    ...overrides
  };
}

export function harness(overrides: Partial<AppConfig> = {}) {
  const config = testConfig(overrides);
  const store = new MemoryStore();
  const gateway = new MockEbayGateway();
  const service = new PartQuillService(store, gateway, config);
  return { config, store, gateway, service };
}

export async function createReadyItem(service: PartQuillService, overrides: Partial<ListingPayload> = {}) {
  return service.createItem({
    sellerId: 'seller-1',
    runId: 'run-1',
    inventoryAuthority: 'partquill_master',
    payload: validPayload(overrides)
  });
}

export async function stageAndApprove(service: PartQuillService) {
  const item = await createReadyItem(service);
  await service.acknowledgeInventoryApiOwnership(item.sellerId, 'seller-owner');
  await service.approvePreflight(item.id, 'reviewer-1', item.payloadHash);
  const staged = await service.stage(item.id, 'reviewer-1');
  await service.approvePublic(item.id, 'publisher-1', item.payloadHash, staged.listing.feeEstimate!.id);
  return { item, staged };
}
