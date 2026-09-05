import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('production configuration fail-closed behavior', () => {
  it('rejects default secrets in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow();
  });

  it('refuses production eBay writes in the pilot build', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        PARTQUILL_API_KEY: 'production-api-key-that-is-long-enough',
        OAUTH_STATE_SECRET: 'production-oauth-secret-long-enough',
        TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
        DATABASE_URL: 'postgres://example.invalid/partquill',
        EBAY_ENV: 'production',
        ALLOW_EBAY_WRITES: 'true'
      })
    ).toThrow('production eBay writes');
  });

  it('accepts a secured sandbox mock deployment with writes disabled', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PARTQUILL_API_KEY: 'production-api-key-that-is-long-enough',
      OAUTH_STATE_SECRET: 'production-oauth-secret-long-enough',
      TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      DATABASE_URL: 'postgres://example.invalid/partquill',
      EBAY_ENV: 'sandbox',
      EBAY_MODE: 'mock',
      ALLOW_EBAY_WRITES: 'false'
    });
    expect(config.ALLOW_EBAY_WRITES).toBe(false);
  });

  it('uses neutral workspace identity and normalizes configurable initials', () => {
    const defaults = loadConfig({});
    expect(defaults).toMatchObject({
      PARTQUILL_WORKSPACE_NAME: 'PartQuill Workspace',
      PARTQUILL_WORKSPACE_LABEL: 'Organization account',
      PARTQUILL_WORKSPACE_INITIALS: 'PQ'
    });

    const branded = loadConfig({
      PARTQUILL_WORKSPACE_NAME: 'Acme Parts',
      PARTQUILL_WORKSPACE_LABEL: 'Operations workspace',
      PARTQUILL_WORKSPACE_INITIALS: 'ap'
    });
    expect(branded.PARTQUILL_WORKSPACE_INITIALS).toBe('AP');
    expect(() => loadConfig({ PARTQUILL_WORKSPACE_INITIALS: 'TOO-LONG' })).toThrow();
  });

  it('requires production Browse API credentials for live reference discovery', () => {
    expect(() => loadConfig({ EBAY_REFERENCE_DISCOVERY_MODE: 'live' })).toThrow('production Browse API');
    expect(() => loadConfig({
      EBAY_ENV: 'production',
      EBAY_REFERENCE_DISCOVERY_MODE: 'live'
    })).toThrow('eBay application credentials');
    const config = loadConfig({
      EBAY_ENV: 'production',
      EBAY_CLIENT_ID: 'production-client-id',
      EBAY_CLIENT_SECRET: 'production-client-secret',
      EBAY_REFERENCE_DISCOVERY_MODE: 'live'
    });
    expect(config.EBAY_REFERENCE_CACHE_HOURS).toBeLessThanOrEqual(6);
    expect(config.EBAY_REFERENCE_MAX_IMAGES).toBe(3);
  });

  it('refuses live Image Studio without an explicit AI provider', () => {
    expect(() =>
      loadConfig({
        IMAGE_STUDIO_MODE: 'live',
        IMAGE_STUDIO_ACCESS_TOKEN: 'private-studio-token-long-enough'
      })
    ).toThrow('live Image Studio requires an explicit AI provider');
  });

  it('requires the complete Azure endpoint and deployment configuration', () => {
    expect(() => loadConfig({
      IMAGE_STUDIO_MODE: 'live',
      IMAGE_STUDIO_ACCESS_TOKEN: 'private-studio-token-long-enough',
      PARTQUILL_AI_PROVIDER: 'azure'
    })).toThrow('AZURE_OPENAI_ENDPOINT');

    const config = loadConfig({
      IMAGE_STUDIO_MODE: 'live',
      IMAGE_STUDIO_ACCESS_TOKEN: 'private-studio-token-long-enough',
      PARTQUILL_AI_PROVIDER: 'azure',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com/openai/v1',
      AZURE_OPENAI_API_KEY: 'azure-test-key',
      AZURE_OPENAI_REVIEW_DEPLOYMENT: 'partquill-review',
      AZURE_OPENAI_IMAGE_DEPLOYMENT: 'partquill-image'
    });
    expect(config.PARTQUILL_AI_PROVIDER).toBe('azure');
  });

  it('requires Foundry review credentials for conservative local editing', () => {
    expect(() => loadConfig({
      IMAGE_STUDIO_MODE: 'live',
      IMAGE_STUDIO_ACCESS_TOKEN: 'private-studio-token-long-enough',
      PARTQUILL_AI_PROVIDER: 'azure-local'
    })).toThrow('AZURE_FOUNDRY_ENDPOINT');

    const config = loadConfig({
      IMAGE_STUDIO_MODE: 'live',
      IMAGE_STUDIO_ACCESS_TOKEN: 'private-studio-token-long-enough',
      PARTQUILL_AI_PROVIDER: 'azure-local',
      AZURE_FOUNDRY_ENDPOINT: 'https://partquill.services.ai.azure.com',
      AZURE_FOUNDRY_API_KEY: 'foundry-test-key',
      AZURE_FOUNDRY_REVIEW_DEPLOYMENT: 'partquill-grok-review'
    });
    expect(config.PARTQUILL_AI_PROVIDER).toBe('azure-local');
  });

  it('permits an explicit fail-closed ephemeral owner preview', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      PARTQUILL_API_KEY: 'production-api-key-that-is-long-enough',
      OAUTH_STATE_SECRET: 'production-oauth-secret-long-enough',
      TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      EBAY_ENV: 'sandbox',
      EBAY_MODE: 'mock',
      ALLOW_EBAY_WRITES: 'false',
      PILOT_EPHEMERAL_MODE: 'true'
    });
    expect(config.PILOT_EPHEMERAL_MODE).toBe(true);
  });

  it('requires complete Azure catalog media configuration', () => {
    expect(() => loadConfig({ AZURE_STORAGE_ACCOUNT_NAME: 'pqdata50230827' }))
      .toThrow('both the storage account and container');
    const config = loadConfig({
      AZURE_STORAGE_ACCOUNT_NAME: 'pqdata50230827',
      GM_CATALOG_MEDIA_CONTAINER: 'partquill-gm-scans'
    });
    expect(config.GM_CATALOG_MEDIA_PREFIX).toBe('gm-scans/pages');
  });
});
