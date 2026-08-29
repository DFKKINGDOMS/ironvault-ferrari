import type { PoolConfig } from 'pg';
import { managedIdentityAccessToken } from '../azure/managed-identity.js';

export type DatabaseAuthMode = 'password' | 'azure-managed-identity';

const AZURE_POSTGRES_RESOURCE = 'https://ossrdbms-aad.database.windows.net';

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
      password: () => managedIdentityAccessToken(AZURE_POSTGRES_RESOURCE),
      ssl: production ? { rejectUnauthorized: false } : undefined
    };
  }

  return {
    connectionString,
    ssl: production ? { rejectUnauthorized: false } : undefined
  };
}
