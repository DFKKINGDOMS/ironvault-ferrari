import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { postgresPoolConfig, type DatabaseAuthMode } from './postgres-connection.js';

const { Pool } = pg;

export async function runMigrations(
  connectionString: string,
  production: boolean,
  authMode: DatabaseAuthMode = 'password'
): Promise<void> {
  const pool = new Pool(postgresPoolConfig(connectionString, production, authMode));
  const migrationsDirectory = resolve(process.cwd(), 'migrations');
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();

  try {
    for (const name of names) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('CREATE TABLE IF NOT EXISTS partquill_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
        const existing = await client.query<{ name: string }>('SELECT name FROM partquill_migrations WHERE name = $1', [name]);
        if (existing.rowCount === 0) {
          await client.query(await readFile(resolve(migrationsDirectory, name), 'utf8'));
          await client.query('INSERT INTO partquill_migrations(name) VALUES ($1)', [name]);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for migrations');
  const authMode = process.env.DATABASE_AUTH_MODE === 'azure-managed-identity'
    ? 'azure-managed-identity'
    : 'password';
  await runMigrations(connectionString, process.env.NODE_ENV === 'production', authMode);
}
