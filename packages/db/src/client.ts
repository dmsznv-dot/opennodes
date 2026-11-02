import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite, PgliteDatabase } from 'drizzle-orm/pglite';
import { Pool, PoolConfig } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import * as schema from './schema/index.js';
import { syncSchema } from './migrator.js';

export type AppSchema = typeof schema;
export type PgDatabaseInstance = NodePgDatabase<AppSchema>;
export type PgliteDatabaseInstance = PgliteDatabase<AppSchema>;
export type DatabaseInstance = PgDatabaseInstance | PgliteDatabaseInstance;

export interface CreatePgDbOptions {
  connectionString?: string;
  poolConfig?: PoolConfig;
  pool?: Pool;
}

/**
 * Creates a Drizzle database client connected to a real PostgreSQL instance.
 */
export function createPgDb(options: CreatePgDbOptions = {}): PgDatabaseInstance {
  let pool: Pool;
  if (options.pool) {
    pool = options.pool;
  } else if (options.connectionString) {
    pool = new Pool({ connectionString: options.connectionString });
  } else if (options.poolConfig) {
    pool = new Pool(options.poolConfig);
  } else {
    const connStr =
      process.env.DATABASE_URL ??
      'postgres://localflow:localflow@localhost:5432/localflow';
    pool = new Pool({ connectionString: connStr });
  }
  return drizzlePg(pool, { schema });
}

/**
 * Creates an embedded PGlite database. With `dataDir` the data is persisted on disk
 * (single-process local runs); without it the database lives in memory.
 * Call `runMigrations` before use.
 */
export function createPgliteDb(dataDir?: string): PgliteDatabaseInstance {
  return drizzlePglite(dataDir ? new PGlite(dataDir) : new PGlite(), { schema });
}

/**
 * Releases the connection pool / embedded database behind a Drizzle client.
 */
export async function closeDb(db: DatabaseInstance): Promise<void> {
  const client = (db as { $client?: { end?: () => Promise<void>; close?: () => Promise<void> } })
    .$client;
  if (client?.end) await client.end();
  else if (client?.close) await client.close();
}

/**
 * Creates an in-memory PGlite database instance for tests,
 * automatically applying the schema DDL so it is immediately ready.
 */
export async function createInMemoryDb(): Promise<PgliteDatabaseInstance> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await syncSchema(db);
  return db;
}
