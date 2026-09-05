import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    PARTQUILL_API_KEY: z.string().min(24).default('development-only-api-key-change-me'),
    TOKEN_ENCRYPTION_KEY: z.string().optional(),
    OAUTH_STATE_SECRET: z.string().min(24).default('development-only-oauth-state-change-me'),
    DATABASE_URL: z.string().optional(),
    DATABASE_AUTH_MODE: z.enum(['password', 'azure-managed-identity']).default('password'),
    GM_IMPORT_TOKEN: z.string().min(32).optional(),
    MIGRATION_TRANSFER_TOKEN: z.string().min(32).optional(),
    MIGRATION_GITHUB_OIDC_ENABLED: booleanString,
    GM_CATALOG_SCAN_DIR: z.string().default('data/gm-scans/pages'),
    GM_CATALOG_MEDIA_BASE_URL: z.string().url().optional(),
    AZURE_STORAGE_ACCOUNT_NAME: z.string().regex(/^[a-z0-9]{3,24}$/).optional(),
    GM_CATALOG_MEDIA_CONTAINER: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/).optional(),
    GM_CATALOG_MEDIA_PREFIX: z.string().regex(/^[A-Za-z0-9._/-]*$/).default('gm-scans/pages'),
    GM_CATALOG_MEDIA_SAS: z.string().min(16).optional(),
    GM_CATALOG_MEDIA_UPLOAD_SAS: z.string().min(16).optional(),
    PILOT_EPHEMERAL_MODE: booleanString,
    EBAY_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    EBAY_MODE: z.enum(['mock', 'live']).default('mock'),
    ALLOW_EBAY_WRITES: booleanString,
    EBAY_CLIENT_ID: z.string().optional(),
    EBAY_CLIENT_SECRET: z.string().optional(),
    EBAY_RU_NAME: z.string().optional(),
    EBAY_REFERENCE_DISCOVERY_MODE: z.enum(['disabled', 'live']).default('disabled'),
    EBAY_REFERENCE_CACHE_HOURS: z.coerce.number().min(0.25).max(6).default(5.5),
    EBAY_REFERENCE_NEGATIVE_CACHE_HOURS: z.coerce.number().min(1).max(168).default(24),
    EBAY_REFERENCE_MAX_IMAGES: z.coerce.number().int().min(1).max(3).default(3),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),
    PARTQUILL_WORKSPACE_NAME: z.string().trim().min(1).max(80).default('PartQuill Workspace'),
    PARTQUILL_WORKSPACE_LABEL: z.string().trim().min(1).max(80).default('Organization account'),
    PARTQUILL_WORKSPACE_INITIALS: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{1,3}$/)
      .default('PQ')
      .transform((value) => value.toUpperCase()),
    PARTQUILL_AI_PROVIDER: z.enum(['disabled', 'openai', 'azure', 'azure-local']).default('disabled'),
    OPENAI_API_KEY: z.string().optional(),
    AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
    AZURE_OPENAI_API_KEY: z.string().optional(),
    AZURE_OPENAI_REVIEW_DEPLOYMENT: z.string().min(1).optional(),
    AZURE_OPENAI_IMAGE_DEPLOYMENT: z.string().min(1).optional(),
    AZURE_FOUNDRY_ENDPOINT: z.string().url().optional(),
    AZURE_FOUNDRY_API_KEY: z.string().optional(),
    AZURE_FOUNDRY_REVIEW_DEPLOYMENT: z.string().min(1).optional(),
    AZURE_FOUNDRY_IMAGE_DEPLOYMENT: z.string().min(1).optional(),
    IMAGE_STUDIO_MODE: z.enum(['preview', 'live']).default('preview'),
    IMAGE_STUDIO_ACCESS_TOKEN: z.string().min(16).optional(),
    IMAGE_STUDIO_STORAGE_MODE: z.enum(['local', 'azure-blob']).default('local'),
    IMAGE_STUDIO_STORAGE_DIR: z.string().default('.partquill-image-studio'),
    IMAGE_STUDIO_STORAGE_ACCOUNT_URL: z.string().url().optional(),
    IMAGE_STUDIO_STORAGE_CONTAINER: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/).optional(),
    IMAGE_STUDIO_STORAGE_SAS: z.string().min(16).optional(),
    IMAGE_STUDIO_STORAGE_PREFIX: z.string().regex(/^[A-Za-z0-9._/-]+$/).default('image-studio'),
    IMAGE_STUDIO_MAX_IMAGES: z.coerce.number().int().min(1).max(24).default(24),
    IMAGE_STUDIO_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(3),
    SHOPIFY_MEDIA_ENABLED: booleanString,
    COMMUNITY_IMAGES_ENABLED: booleanString,
    COMMUNITY_EDIT_MODE: z.enum(['chatgpt-manual', 'provider']).default('chatgpt-manual'),
    COMMUNITY_IMAGE_MAX_IMAGES: z.coerce.number().int().min(1).max(50).default(50),
    COMMUNITY_UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(3),
    COMMUNITY_UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
    COMMUNITY_GITHUB_REPOSITORY: z.string().default('DFKKINGDOMS/ironvault-ferrari'),
    COMMUNITY_GITHUB_BRANCH: z.string().default('main'),
    COMMUNITY_GITHUB_TOKEN: z.string().min(24).optional(),
    OEM_RESEARCH_MODE: z.enum(['disabled', 'private-pilot']).default('disabled'),
    OEM_DATA_RIGHTS_CONFIRMED: booleanString,
    MCP_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1_000).default(30),
    MCP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    MCP_MAX_BODY_BYTES: z.coerce.number().int().min(1_024).max(4 * 1024 * 1024).default(1_048_576),
    MCP_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    SELLER_PREVIEW_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(2_000).default(60),
    SELLER_PREVIEW_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
    SELLER_PREVIEW_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(8)
  })
  .superRefine((env, context) => {
    if (Boolean(env.AZURE_STORAGE_ACCOUNT_NAME) !== Boolean(env.GM_CATALOG_MEDIA_CONTAINER)) {
      context.addIssue({
        code: 'custom',
        path: ['GM_CATALOG_MEDIA_CONTAINER'],
        message: 'Azure catalog media requires both the storage account and container'
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.TOKEN_ENCRYPTION_KEY) {
        context.addIssue({ code: 'custom', path: ['TOKEN_ENCRYPTION_KEY'], message: 'required in production' });
      }
      if (!env.DATABASE_URL && !env.PILOT_EPHEMERAL_MODE) {
        context.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'required in production' });
      }
      if (env.PARTQUILL_API_KEY.startsWith('development-only')) {
        context.addIssue({ code: 'custom', path: ['PARTQUILL_API_KEY'], message: 'production API key is required' });
      }
      if (env.OAUTH_STATE_SECRET.startsWith('development-only')) {
        context.addIssue({ code: 'custom', path: ['OAUTH_STATE_SECRET'], message: 'production OAuth state secret is required' });
      }
    }
    if (env.PILOT_EPHEMERAL_MODE && (env.EBAY_MODE !== 'mock' || env.ALLOW_EBAY_WRITES)) {
      context.addIssue({
        code: 'custom',
        path: ['PILOT_EPHEMERAL_MODE'],
        message: 'ephemeral pilot mode requires mock eBay mode with all eBay writes disabled'
      });
    }
    if (env.EBAY_MODE === 'live' && (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET || !env.EBAY_RU_NAME)) {
      context.addIssue({ code: 'custom', path: ['EBAY_MODE'], message: 'live mode requires all eBay OAuth credentials' });
    }
    if (env.EBAY_ENV === 'production' && env.ALLOW_EBAY_WRITES) {
      context.addIssue({
        code: 'custom',
        path: ['ALLOW_EBAY_WRITES'],
        message: 'production eBay writes are intentionally disabled in this pilot build'
      });
    }
    if (env.EBAY_REFERENCE_DISCOVERY_MODE === 'live') {
      if (env.EBAY_ENV !== 'production') {
        context.addIssue({
          code: 'custom',
          path: ['EBAY_REFERENCE_DISCOVERY_MODE'],
          message: 'live eBay reference discovery requires the production Browse API'
        });
      }
      if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
        context.addIssue({
          code: 'custom',
          path: ['EBAY_REFERENCE_DISCOVERY_MODE'],
          message: 'live eBay reference discovery requires eBay application credentials'
        });
      }
    }
    if (env.IMAGE_STUDIO_MODE === 'live') {
      if (env.PARTQUILL_AI_PROVIDER === 'disabled') {
        context.addIssue({ code: 'custom', path: ['PARTQUILL_AI_PROVIDER'], message: 'live Image Studio requires an explicit AI provider' });
      }
      if (env.PARTQUILL_AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
        context.addIssue({ code: 'custom', path: ['OPENAI_API_KEY'], message: 'OpenAI provider requires an OpenAI API key' });
      }
      if (env.PARTQUILL_AI_PROVIDER === 'azure') {
        const required = [
          ['AZURE_OPENAI_ENDPOINT', env.AZURE_OPENAI_ENDPOINT],
          ['AZURE_OPENAI_API_KEY', env.AZURE_OPENAI_API_KEY],
          ['AZURE_OPENAI_REVIEW_DEPLOYMENT', env.AZURE_OPENAI_REVIEW_DEPLOYMENT],
          ['AZURE_OPENAI_IMAGE_DEPLOYMENT', env.AZURE_OPENAI_IMAGE_DEPLOYMENT]
        ] as const;
        for (const [path, value] of required) {
          if (!value) context.addIssue({ code: 'custom', path: [path], message: `Azure provider requires ${path}` });
        }
      }
      if (env.PARTQUILL_AI_PROVIDER === 'azure-local') {
        const required = [
          ['AZURE_FOUNDRY_ENDPOINT', env.AZURE_FOUNDRY_ENDPOINT],
          ['AZURE_FOUNDRY_API_KEY', env.AZURE_FOUNDRY_API_KEY],
          ['AZURE_FOUNDRY_REVIEW_DEPLOYMENT', env.AZURE_FOUNDRY_REVIEW_DEPLOYMENT]
        ] as const;
        for (const [path, value] of required) {
          if (!value) context.addIssue({ code: 'custom', path: [path], message: `Azure local provider requires ${path}` });
        }
      }
      if (env.NODE_ENV === 'production' && !env.IMAGE_STUDIO_ACCESS_TOKEN) {
        context.addIssue({
          code: 'custom',
          path: ['IMAGE_STUDIO_ACCESS_TOKEN'],
          message: 'production live Image Studio requires a private pilot access token'
        });
      }
    }
    if (env.IMAGE_STUDIO_STORAGE_MODE === 'azure-blob') {
      const required = [
        ['IMAGE_STUDIO_STORAGE_ACCOUNT_URL', env.IMAGE_STUDIO_STORAGE_ACCOUNT_URL],
        ['IMAGE_STUDIO_STORAGE_CONTAINER', env.IMAGE_STUDIO_STORAGE_CONTAINER],
        ['IMAGE_STUDIO_STORAGE_SAS', env.IMAGE_STUDIO_STORAGE_SAS]
      ] as const;
      for (const [path, value] of required) {
        if (!value) context.addIssue({ code: 'custom', path: [path], message: `Azure image storage requires ${path}` });
      }
    }
    if (env.COMMUNITY_IMAGES_ENABLED && env.NODE_ENV === 'production' && !env.DATABASE_URL) {
      context.addIssue({ code: 'custom', path: ['COMMUNITY_IMAGES_ENABLED'], message: 'community image intake requires PostgreSQL persistence' });
    }
  });

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(source);
}
