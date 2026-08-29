import type { PoolConfig } from 'pg';

export type DatabaseAuthMode = 'password' | 'azure-managed-identity';

const AZURE_POSTGRES_SCOPE = 'https://ossrdbms-aad.database.windows.net/.default';
let cachedToken: { token: string; expiresAt: number } | undefined;

async function managedIdentityToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 5 * 60_000) return cachedToken.token;

  const endpoint = process.env.IDENTITY_ENDPOINT;
  const identityHeader = process.env.IDENTITY_HEADER;
  if (!endpoint || !identityHeader) {
    throw new Error('Azure Container Apps managed identity endpoint is unavailable');
  }

  const url = new URL(endpoint);
  url.searchParams.set('api-version', '2019-08-01');
  url.searchParams.set('resource', AZURE_POSTGRES_SCOPE.replace('/.default', ''));
  const response = await fetch(url, {
    headers: {
      'X-IDENTITY-HEADER': identityHeader,
      Metadata: 'true'
    }
  });
  if (!response.ok) {
    throw new Error(`Azure managed identity token request failed with HTTP ${response.status}`);
  }

  const payload = await response.json() as {
    access_token?: string;
    expires_on?: string | number;
  };
  if (!payload.access_token) throw new Error('Azure managed identity did not return a PostgreSQL access token');

  const parsedExpiry = Number(payload.expires_on);
  cachedToken = {
    token: payload.access_token,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry * 1_000 : now + 45 * 60_000
  };
  return cachedToken.token;
}

export function postgresPoolConfig(
  connectionString: string,
  production: boolean,
  authMode: DatabaseAuthMode
): PoolConfig {
  if (authMode === 'azure-managed-identity') {
    // node-postgres reparses `connectionString` after merging the supplied
    // config. A password callback is therefore overwritten by the URL's empty
    // password. Split the URL into explicit fields so the managed-identity
    // token callback reaches PostgreSQL as the password.
    const parsed = new URL(connectionString);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 5432,
      database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
      user: decodeURIComponent(parsed.username),
      password: managedIdentityToken,
      ssl: production ? { rejectUnauthorized: false } : undefined
    };
  }

  return {
    connectionString,
    ssl: production ? { rejectUnauthorized: false } : undefined
  };
}
