import { describe, expect, it } from 'vitest';
import { isTrustedGithubMediaMigrationClaims } from '../src/security/github-migration-oidc.js';

const trustedClaims = {
  repository_id: '1316643567',
  repository_owner_id: '98978443',
  repository: 'DFKKINGDOMS/ironvault-fitment-pro',
  ref: 'refs/heads/partquill-gm-crawl-100001-235000',
  workflow_ref:
    'DFKKINGDOMS/ironvault-fitment-pro/.github/workflows/partquill-gm-evidence-to-azure.yml@refs/heads/partquill-gm-crawl-100001-235000'
};

describe('GitHub media migration OIDC claims', () => {
  it('accepts only the preserved crawl workflow on its exact branch', () => {
    expect(isTrustedGithubMediaMigrationClaims(trustedClaims)).toBe(true);
    expect(isTrustedGithubMediaMigrationClaims({ ...trustedClaims, repository_id: '1332273432' })).toBe(false);
    expect(isTrustedGithubMediaMigrationClaims({ ...trustedClaims, ref: 'refs/heads/main' })).toBe(false);
    expect(isTrustedGithubMediaMigrationClaims({ ...trustedClaims, workflow_ref: 'untrusted.yml' })).toBe(false);
  });
});
