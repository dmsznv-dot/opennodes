#!/usr/bin/env node
/**
 * Runs OpenNodes on this computer with no Docker, Postgres or Redis: the API with an
 * embedded database in ./.data and the web app. Build first: pnpm build.
 *
 *   pnpm start:local        → http://localhost:3000
 *
 * Environment: WEB_PORT (3000), API_PORT (4000), DATA_DIR (./.data), and anything the
 * API reads, e.g. SSRF_ALLOWLIST=localhost:1234 for a local model server.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiEntry = join(root, 'apps/api/dist/index.js');
const webEntry = join(root, 'apps/web/dist/server.js');
for (const entry of [apiEntry, webEntry]) {
  if (!existsSync(entry)) {
    console.error(`Missing ${entry}. Build first: pnpm build`);
    process.exit(1);
  }
}

const dataDir = resolve(process.env.DATA_DIR ?? join(root, '.data'));
mkdirSync(dataDir, { recursive: true });
// One key per installation, kept next to the data it encrypts (never commit .data/).
const keyFile = join(dataDir, 'encryption.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const encryptionKey = process.env.ENCRYPTION_KEY ?? readFileSync(keyFile, 'utf8').trim();

const apiPort = process.env.API_PORT ?? '4000';
const webPort = process.env.WEB_PORT ?? '3000';

const children = [];
function run(name, entry, env) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => {
    console.error(`${name} stopped (${signal ?? code}); stopping OpenNodes.`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('API', apiEntry, {
  PORT: apiPort,
  HOST: '127.0.0.1',
  DATABASE_URL: process.env.DATABASE_URL ?? `pglite://${join(dataDir, 'pglite')}`,
  ENCRYPTION_KEY: encryptionKey,
  EXECUTION_MODE: process.env.EXECUTION_MODE ?? 'embedded',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn',
});
run('Web', webEntry, {
  PORT: webPort,
  HOST: '127.0.0.1',
  API_URL: `http://127.0.0.1:${apiPort}`,
});
console.log(`OpenNodes: http://localhost:${webPort}  (data: ${dataDir})`);
