import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'partquill-migration';
const repositoryId = '1332273432';
const repositoryOwnerId = '98978443';
const migrationRef = 'refs/heads/partquill-azure-container-app';
const migrationWorkflowRef =
  'DFKKINGDOMS/ironvault-ferrari/.github/workflows/azure-partquill-data-migrate.yml@refs/heads/partquill-azure-container-app';
const githubJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));

export async function verifyGithubMigrationOidcToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, githubJwks, { issuer, audience });
    return payload.repository_id === repositoryId
      && payload.repository_owner_id === repositoryOwnerId
      && payload.repository === 'DFKKINGDOMS/ironvault-ferrari'
      && payload.ref === migrationRef
      && payload.workflow_ref === migrationWorkflowRef;
  } catch {
    return false;
  }
}
