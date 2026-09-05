import { describe, expect, it } from 'vitest';
import {
  isTrustedGithubDeereWorkerClaims,
  isTrustedGithubMigrationClaims,
  isTrustedGithubMediaMigrationClaims
} from '../src/security/github-migration-oidc.js';

const trustedSellerListingClaims = {
  repository_id: '1332273432',
  repository_owner_id: '98978443',
  repository: 'DFKKINGDOMS/ironvault-ferrari',
  ref: 'refs/heads/main',
  workflow_ref:
    'DFKKINGDOMS/ironvault-ferrari/.github/workflows/azure-partquill-seller-listing-import.yml@refs/heads/main'
};

describe('GitHub seller listing import OIDC claims', () => {
  it('accepts only the exact import workflow on main', () => {
    expect(isTrustedGithubMigrationClaims(trustedSellerListingClaims)).toBe(true);
    expect(isTrustedGithubMigrationClaims({ ...trustedSellerListingClaims, ref: 'refs/heads/feature' })).toBe(false);
    expect(isTrustedGithubMigrationClaims({ ...trustedSellerListingClaims, workflow_ref: 'untrusted.yml' })).toBe(false);
    expect(isTrustedGithubMigrationClaims({ ...trustedSellerListingClaims, repository_id: '1316643567' })).toBe(false);
  });
});

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

const trustedDeereWorkerClaims = {
  repository_id: '1316643567',
  repository_owner_id: '98978443',
  repository: 'DFKKINGDOMS/ironvault-fitment-pro',
  ref: 'refs/heads/main',
  workflow_ref:
    'DFKKINGDOMS/ironvault-fitment-pro/.github/workflows/deere-azure-collection-worker.yml@refs/heads/main'
};

describe('GitHub Deere worker OIDC claims', () => {
  it('accepts only the production Deere worker on main', () => {
    expect(isTrustedGithubDeereWorkerClaims(trustedDeereWorkerClaims)).toBe(true);
    expect(isTrustedGithubDeereWorkerClaims({ ...trustedDeereWorkerClaims, repository_id: '1332273432' })).toBe(false);
    expect(isTrustedGithubDeereWorkerClaims({ ...trustedDeereWorkerClaims, ref: 'refs/heads/not-main' })).toBe(false);
    expect(isTrustedGithubDeereWorkerClaims({ ...trustedDeereWorkerClaims, workflow_ref: 'untrusted.yml' })).toBe(false);
  });
});
