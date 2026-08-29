import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'partquill-migration';
const repositoryId = '1332273432';
const repositoryOwnerId = '98978443';
const migrationWorkflowRef =
  'DFKKINGDOMS/ironvault-ferrari/.github/workflows/azure-partquill-data-migrate.yml@refs/heads/main';
const githubJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`));

export async function verifyGithubMigrationOidcToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, githubJwks, { issuer, audience });
    return payload.repository_id === repositoryId
      && payload.repository_owner_id === repositoryOwnerId
      && payload.repository === 'DFKKINGDOMS/ironvault-ferrari'
      && payload.ref === 'refs/heads/main'
      && payload.workflow_ref === migrationWorkflowRef;
  } catch {
    return false;
  }
}
