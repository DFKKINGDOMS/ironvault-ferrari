import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'partquill-migration';
const repositoryId = '1332273432';
const repositoryOwnerId = '98978443';
const migrationRef = 'refs/heads/main';
const migrationWorkflowRefs = new Set([
  'DFKKINGDOMS/ironvault-ferrari/.github/workflows/azure-partquill-data-migrate.yml@refs/heads/main',
  'DFKKINGDOMS/ironvault-ferrari/.github/workflows/azure-partquill-gm-catalog-import.yml@refs/heads/main'
]);
const mediaMigrationAudience = 'partquill-media-migration';
const mediaMigrationRepositoryId = '1316643567';
const mediaMigrationRef = 'refs/heads/partquill-gm-crawl-100001-235000';
const mediaMigrationWorkflowRef =
  'DFKKINGDOMS/ironvault-fitment-pro/.github/workflows/partquill-gm-evidence-to-azure.yml@refs/heads/partquill-gm-crawl-100001-235000';
const deereWorkerAudience = 'partquill-deere-worker';
const deereWorkerRepositoryId = '1316643567';
const deereWorkerRef = 'refs/heads/main';
const deereWorkerWorkflowRef =
  'DFKKINGDOMS/ironvault-fitment-pro/.github/workflows/deere-azure-collection-worker.yml@refs/heads/main';
const githubJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));

export async function verifyGithubMigrationOidcToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, githubJwks, { issuer, audience });
    return payload.repository_id === repositoryId
      && payload.repository_owner_id === repositoryOwnerId
      && payload.repository === 'DFKKINGDOMS/ironvault-ferrari'
      && payload.ref === migrationRef
      && typeof payload.workflow_ref === 'string'
      && migrationWorkflowRefs.has(payload.workflow_ref);
  } catch {
    return false;
  }
}

export function isTrustedGithubMediaMigrationClaims(payload: JWTPayload): boolean {
  return payload.repository_id === mediaMigrationRepositoryId
    && payload.repository_owner_id === repositoryOwnerId
    && payload.repository === 'DFKKINGDOMS/ironvault-fitment-pro'
    && payload.ref === mediaMigrationRef
    && payload.workflow_ref === mediaMigrationWorkflowRef;
}

export async function verifyGithubMediaMigrationOidcToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, githubJwks, { issuer, audience: mediaMigrationAudience });
    return isTrustedGithubMediaMigrationClaims(payload);
  } catch {
    return false;
  }
}

export function isTrustedGithubDeereWorkerClaims(payload: JWTPayload): boolean {
  return payload.repository_id === deereWorkerRepositoryId
    && payload.repository_owner_id === repositoryOwnerId
    && payload.repository === 'DFKKINGDOMS/ironvault-fitment-pro'
    && payload.ref === deereWorkerRef
    && payload.workflow_ref === deereWorkerWorkflowRef;
}

export async function verifyGithubDeereWorkerOidcToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, githubJwks, { issuer, audience: deereWorkerAudience });
    return isTrustedGithubDeereWorkerClaims(payload);
  } catch {
    return false;
  }
}
