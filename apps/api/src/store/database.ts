import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPgDb, createPgliteDb, runMigrations, type DatabaseInstance } from '@localflow/db';

/**
 * Opens the control-plane database and applies the idempotent schema migrations.
 *
 * - `postgres://…` / `postgresql://…` — PostgreSQL (Docker / production)
 * - `pglite://memory` — embedded, in-memory (tests)
 * - `pglite://<dir>` — embedded, persisted to a directory (single-process local runs)
 */
export async function openDatabase(databaseUrl: string): Promise<DatabaseInstance> {
  let db: DatabaseInstance;
  if (databaseUrl.startsWith('pglite://')) {
    const target = databaseUrl.slice('pglite://'.length);
    if (target === '' || target === 'memory') {
      db = createPgliteDb();
    } else {
      const dir = resolve(target);
      mkdirSync(dir, { recursive: true });
      db = createPgliteDb(dir);
    }
  } else if (/^postgres(ql)?:\/\//.test(databaseUrl)) {
    db = createPgDb({ connectionString: databaseUrl });
  } else {
    throw new Error(
      `Unsupported DATABASE_URL scheme. Use postgres://, pglite://memory or pglite://<dir>.`
    );
  }
  await runMigrations(db);
  return db;
}
