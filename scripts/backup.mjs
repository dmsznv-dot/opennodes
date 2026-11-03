#!/usr/bin/env node
/**
 * Backup of an OpenNodes installation: the database AND the encryption key. Connection
 * secrets in the database are encrypted with that key — a backup without it cannot
 * restore any connection, and the key alone is useless without the data.
 *
 *   pnpm backup                 # local install (pnpm start:local): ./.data → backups/
 *   pnpm backup -- --docker     # docker compose: pg_dump of Postgres + the key
 *
 * Local mode copies the whole data folder (embedded database + encryption.key); stop
 * `pnpm start:local` first so the database files are consistent (--force skips the check).
 * Docker mode reads ENCRYPTION_KEY from the environment or ./.env, like docker compose.
 *
 * Restore — local: stop the app, replace .data with the folder from the archive.
 * Docker: start postgres, then
 *   docker compose exec -T postgres pg_restore -U localflow -d localflow --clean < <file>.dump
 * and set ENCRYPTION_KEY to the value in <file>.key.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const docker = args.includes('--docker');
const force = args.includes('--force');
const outDir = resolve(process.env.BACKUP_DIR ?? join(root, 'backups'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const DEFAULT_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

mkdirSync(outDir, { recursive: true, mode: 0o700 });

const size = (file) => `${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`;

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
  if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`${cmd} exited with ${res.status}`);
}

function envFileValue(name) {
  const file = join(root, '.env');
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith(`${name}=`));
  return line
    ?.slice(line.indexOf('=') + 1)
    .trim()
    .replace(/^["']|["']$/g, '');
}

async function apiIsUp() {
  const port = process.env.API_PORT ?? 4000;
  try {
    const res = await fetch(`http://localhost:${port}/health/live`, {
      signal: AbortSignal.timeout(1_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

try {
  if (docker) {
    const key = process.env.ENCRYPTION_KEY ?? envFileValue('ENCRYPTION_KEY') ?? DEFAULT_KEY;
    const user = process.env.POSTGRES_USER ?? envFileValue('POSTGRES_USER') ?? 'localflow';
    const db = process.env.POSTGRES_DB ?? envFileValue('POSTGRES_DB') ?? 'localflow';
    const dump = join(outDir, `opennodes-${stamp}.dump`);
    const fd = openSync(dump, 'w', 0o600);
    try {
      run('docker', ['compose', 'exec', '-T', 'postgres', 'pg_dump', '-U', user, '-Fc', db], {
        cwd: root,
        stdio: ['ignore', fd, 'inherit'],
      });
    } finally {
      closeSync(fd);
    }
    writeFileSync(join(outDir, `opennodes-${stamp}.key`), `ENCRYPTION_KEY=${key}\n`, {
      mode: 0o600,
    });
    console.log(`Database: ${dump} (${size(dump)})`);
    console.log(`Key:      ${join(outDir, `opennodes-${stamp}.key`)}`);
    if (key === DEFAULT_KEY) {
      console.warn(
        'Warning: this install uses the built-in example ENCRYPTION_KEY. Set your own in .env.'
      );
    }
  } else {
    const dataDir = resolve(process.env.DATA_DIR ?? join(root, '.data'));
    if (!existsSync(join(dataDir, 'encryption.key'))) {
      throw new Error(`no local install in ${dataDir} (expected encryption.key there)`);
    }
    if (!force && (await apiIsUp())) {
      throw new Error('OpenNodes is running: stop pnpm start:local first (or pass --force).');
    }
    const archive = join(outDir, `opennodes-${stamp}.tar.gz`);
    run('tar', ['-czf', archive, '-C', dirname(dataDir), basename(dataDir)]);
    spawnSync('chmod', ['600', archive]);
    console.log(`Backup:   ${archive} (${size(archive)})`);
    console.log('Contains the database and encryption.key — keep it private.');
  }
} catch (err) {
  console.error(`Backup failed: ${err.message}`);
  process.exit(1);
}
