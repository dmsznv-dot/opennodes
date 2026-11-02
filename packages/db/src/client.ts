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
 * Creates an in-memory PGlite database instance for tests,
 * automatically applying the schema DDL so it is immediately ready.
 */
export async function createInMemoryDb(): Promise<PgliteDatabaseInstance> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema });
  await syncSchema(db);
  return db;
}
