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
    PILOT_EPHEMERAL_MODE: false,
    EBAY_ENV: 'sandbox',
    EBAY_MODE: 'mock',
    ALLOW_EBAY_WRITES: true,
    PUBLIC_BASE_URL: 'http://localhost:3000',
    CORS_ORIGINS: 'http://localhost:5173',
    IMAGE_STUDIO_MODE: 'preview',
    IMAGE_STUDIO_STORAGE_DIR: '.partquill-image-studio-test',
    IMAGE_STUDIO_MAX_IMAGES: 24,
    IMAGE_STUDIO_CONCURRENCY: 3,
    OEM_RESEARCH_MODE: 'disabled',
    OEM_DATA_RIGHTS_CONFIRMED: false,
    MCP_RATE_LIMIT_MAX: 30,
    MCP_RATE_LIMIT_WINDOW_MS: 60_000,
    MCP_MAX_BODY_BYTES: 1_048_576,
    MCP_MAX_CONCURRENCY: 4,
    SELLER_PREVIEW_RATE_LIMIT_MAX: 60,
    SELLER_PREVIEW_RATE_LIMIT_WINDOW_MS: 60_000,
    SELLER_PREVIEW_MAX_CONCURRENCY: 8,
    ...overrides
  };
}

export function validPayload(overrides: Partial<ListingPayload> = {}): ListingPayload {
  return {
    sku: 'WIX-51040-1',
    title: 'WIX 51040 Engine Oil Filter New',
    description: 'New boxed WIX oil filter. Verify the part number before purchase.',
    condition: 'NEW',
    categoryId: '33661',
    brand: 'WIX',
    mpn: '51040',
    price: { currency: 'USD', value: '12.99' },
    quantity: 1,
    aspects: { Brand: ['WIX'], 'Manufacturer Part Number': ['51040'] },
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
