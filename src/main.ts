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
import { EbayBrowseReferenceClient } from './ebay/reference-discovery.js';
import { EbayReferenceService } from './ebay/reference-service.js';
import { CuratedEbayReferenceProvider } from './ebay/curated-reference.js';
import { CommunityImageService } from './community/service.js';
import { DisabledCommunityModerator, OpenAiCommunityModerator } from './community/moderation.js';
import { DisabledCommunityArchive, GitHubCommunityArchive } from './community/github-archive.js';
import { ConservativeBackgroundEngine } from './image-studio/local-background-engine.js';
import { startEbayCategoryTaxonomySync } from './ebay/category-taxonomy-sync.js';

const config = loadConfig();
if (config.DATABASE_URL) {
  await runMigrations(config.DATABASE_URL, config.NODE_ENV === 'production', config.DATABASE_AUTH_MODE);
}
const store = config.DATABASE_URL
  ? new PostgresStore(config.DATABASE_URL, config.NODE_ENV === 'production', config.DATABASE_AUTH_MODE)
  : new MemoryStore();
if (store instanceof PostgresStore) {
  await store.initializeGmCatalog();
  for (const curatedRecord of [
    'data/gm-catalog-smoke-5459066.json',
    'data/gm-catalog-curated-602698.json'
  ]) {
    await store.seedGmCatalogPart(resolve(curatedRecord));
  }
}
const ebay = config.EBAY_MODE === 'mock' ? new MockEbayGateway() : new LiveEbayGateway(config);
const tokenVault = config.TOKEN_ENCRYPTION_KEY ? new TokenVault(config.TOKEN_ENCRYPTION_KEY) : undefined;
const service = new PartQuillService(store, ebay, config, tokenVault);
const aiKey = config.PARTQUILL_AI_PROVIDER === 'azure-local'
  ? config.AZURE_FOUNDRY_API_KEY
  : config.PARTQUILL_AI_PROVIDER === 'azure'
  ? config.AZURE_OPENAI_API_KEY
  : config.PARTQUILL_AI_PROVIDER === 'openai'
    ? config.OPENAI_API_KEY
    : undefined;
const aiOptions = config.PARTQUILL_AI_PROVIDER === 'azure-local'
  ? {
      baseUrl: `${config.AZURE_FOUNDRY_ENDPOINT?.replace(/\/$/, '')}/openai/v1`,
      authMode: 'api-key' as const,
      reviewModel: config.AZURE_FOUNDRY_REVIEW_DEPLOYMENT
    }
  : config.PARTQUILL_AI_PROVIDER === 'azure'
  ? {
      baseUrl: config.AZURE_OPENAI_ENDPOINT,
      authMode: 'api-key' as const,
      reviewModel: config.AZURE_OPENAI_REVIEW_DEPLOYMENT,
      premiumImageModel: config.AZURE_OPENAI_IMAGE_DEPLOYMENT,
      economyImageModel: config.AZURE_OPENAI_IMAGE_DEPLOYMENT,
      supportsBackgroundControl: true
    }
  : {};
const completeAiEngine = Boolean(aiKey
  && (config.PARTQUILL_AI_PROVIDER !== 'azure'
    || (config.AZURE_OPENAI_ENDPOINT && config.AZURE_OPENAI_REVIEW_DEPLOYMENT && config.AZURE_OPENAI_IMAGE_DEPLOYMENT))
  && (config.PARTQUILL_AI_PROVIDER !== 'azure-local'
    || (config.AZURE_FOUNDRY_ENDPOINT && config.AZURE_FOUNDRY_REVIEW_DEPLOYMENT)));
const comparisonEngine = completeAiEngine ? new OpenAiImageEngine(aiKey, fetch, aiOptions) : new DisabledImageEngine();
const selectedImageEngine = config.PARTQUILL_AI_PROVIDER === 'azure-local'
  ? new ConservativeBackgroundEngine(comparisonEngine)
  : comparisonEngine;
const imageEngine = config.IMAGE_STUDIO_MODE === 'live' && completeAiEngine
  ? selectedImageEngine
  : new DisabledImageEngine();
const imageStudio = new ImageStudioService(
  new StudioFileStore(config.IMAGE_STUDIO_STORAGE_DIR),
  imageEngine,
  config.IMAGE_STUDIO_MAX_IMAGES,
  config.IMAGE_STUDIO_CONCURRENCY
);
await imageStudio.initialize();
const communityImages = config.COMMUNITY_IMAGES_ENABLED
  ? new CommunityImageService(
      store,
      completeAiEngine ? new OpenAiCommunityModerator(aiKey, fetch, aiOptions) : new DisabledCommunityModerator(),
      completeAiEngine ? selectedImageEngine : new DisabledImageEngine(),
      config.COMMUNITY_GITHUB_TOKEN
        ? new GitHubCommunityArchive(
            config.COMMUNITY_GITHUB_REPOSITORY,
            config.COMMUNITY_GITHUB_BRANCH,
            config.COMMUNITY_GITHUB_TOKEN
          )
        : new DisabledCommunityArchive(),
      config.COMMUNITY_IMAGE_MAX_IMAGES,
      true,
      { editMode: config.COMMUNITY_EDIT_MODE, handoffSecret: config.OAUTH_STATE_SECRET }
    )
  : undefined;
const ebayReferenceProvider = config.EBAY_REFERENCE_DISCOVERY_MODE === 'live'
  ? new EbayBrowseReferenceClient(config)
  : undefined;
const ebayReference = new EbayReferenceService(
  store,
  ebayReferenceProvider,
  config,
  () => new Date(),
  new CuratedEbayReferenceProvider()
);
await ebayReference.purgeExpired();
const ebayReferenceCleanup = setInterval(() => {
  void ebayReference.purgeExpired().catch((error: unknown) => {
    console.error('eBay reference cache cleanup failed', error);
  });
}, 15 * 60_000);
ebayReferenceCleanup.unref();
const app = await buildApp({
  config,
  store,
  service,
  imageStudio,
  ...(communityImages ? { communityImages } : {}),
  ebayReference,
  ...(tokenVault ? { tokenVault } : {})
});

await app.listen({ host: config.HOST, port: config.PORT });

// Read-only eBay Motors taxonomy import and resumable PartQuill category mapping.
// This uses application-level Taxonomy API reads only; seller/listing writes remain disabled.
const ebayCategorySync = startEbayCategoryTaxonomySync(config);

const recoverCommunityQueue = async () => {
  if (!communityImages) return;
  for (const row of await communityImages.listReviewQueue(25)) {
    if (row.images.some((image) => ['QUARANTINED','AWAITING_AUTOMATED_REVIEW'].includes(image.status))) {
      await communityImages.screenSubmission(row.submission.id);
    }
    if (row.images.some((image) => ['APPROVED_FOR_EDIT','READY_FOR_ARCHIVE'].includes(image.status))) {
      await communityImages.processApproved(row.submission.id);
    }
  }
};
void recoverCommunityQueue().catch((error: unknown) => app.log.error({ error }, 'community image queue recovery failed'));
const communityRecovery = setInterval(() => {
  void recoverCommunityQueue().catch((error: unknown) => app.log.error({ error }, 'community image queue recovery failed'));
}, 60_000);
communityRecovery.unref();

if (store instanceof PostgresStore) {
  const catalogPath = resolve('data/gm-catalog-v1.ndjson.gz');
  if (existsSync(catalogPath)) {
    void store.importGmCatalog(catalogPath).catch((error: unknown) => {
      app.log.error({ error }, 'GM catalog import failed');
    });
  }
}

const close = async (): Promise<void> => {
  clearInterval(ebayReferenceCleanup);
  clearInterval(communityRecovery);
  await app.close();
  await ebayCategorySync?.stop();
  if (store instanceof PostgresStore) await store.close();
};
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
