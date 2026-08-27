import { loadConfig } from './config.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LiveEbayGateway } from './ebay/live-gateway.js';
import { MockEbayGateway } from './ebay/mock-gateway.js';
import { buildApp } from './http/app.js';
import { StudioFileStore } from './image-studio/file-store.js';
import { DisabledImageEngine, OpenAiImageEngine } from './image-studio/openai-engine.js';
import { ImageStudioService } from './image-studio/service.js';
import { TokenVault } from './security/token-vault.js';
import { PartQuillService } from './services/partquill-service.js';
import { MemoryStore } from './store/memory-store.js';
import { runMigrations } from './store/migrate.js';
import { PostgresStore } from './store/postgres-store.js';

const config = loadConfig();
if (config.DATABASE_URL) {
  await runMigrations(config.DATABASE_URL, config.NODE_ENV === 'production');
}
const store = config.DATABASE_URL
  ? new PostgresStore(config.DATABASE_URL, config.NODE_ENV === 'production')
  : new MemoryStore();
if (store instanceof PostgresStore) {
  await store.initializeGmCatalog();
  await store.seedGmCatalogPart(resolve('data/gm-catalog-smoke-5459066.json'));
}
const ebay = config.EBAY_MODE === 'mock' ? new MockEbayGateway() : new LiveEbayGateway(config);
const tokenVault = config.TOKEN_ENCRYPTION_KEY ? new TokenVault(config.TOKEN_ENCRYPTION_KEY) : undefined;
const service = new PartQuillService(store, ebay, config, tokenVault);
const imageEngine = config.IMAGE_STUDIO_MODE === 'live' ? new OpenAiImageEngine(config.OPENAI_API_KEY) : new DisabledImageEngine();
const imageStudio = new ImageStudioService(
  new StudioFileStore(config.IMAGE_STUDIO_STORAGE_DIR),
  imageEngine,
  config.IMAGE_STUDIO_MAX_IMAGES,
  config.IMAGE_STUDIO_CONCURRENCY
);
await imageStudio.initialize();
const app = await buildApp({ config, store, service, imageStudio, ...(tokenVault ? { tokenVault } : {}) });

await app.listen({ host: config.HOST, port: config.PORT });

if (store instanceof PostgresStore) {
  const catalogPath = resolve('data/gm-catalog-v1.ndjson.gz');
  if (existsSync(catalogPath)) {
    void store.importGmCatalog(catalogPath).catch((error: unknown) => {
      app.log.error({ error }, 'GM catalog import failed');
    });
  }
}

const close = async (): Promise<void> => {
  await app.close();
  if (store instanceof PostgresStore) await store.close();
};
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
