import { mkdir, readFile, writeFile, access, chmod } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { LocalFlowApiServer } from '@localflow/api';
import { createWebServer } from '@localflow/web/server';

const exists = async (file) => access(file).then(() => true, () => false);

async function acquireLock(dataDir) {
  const helper = fileURLToPath(new URL('./opennodes-lock', import.meta.url));
  const child = spawn(helper, [join(dataDir, 'desktop.lock')], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', () => resolve());
    child.once('exit', (code) => reject(new Error(code === 73
      ? 'OpenNodes data directory is already in use.' : 'Cannot lock the OpenNodes data directory.')));
  });
  return async () => { child.stdin.end(); await exited; };
}

async function listen(server, port) {
  return new Promise((resolve, reject) => {
    const failed = (error) => { server.off('listening', ready); reject(error); };
    const ready = () => { server.off('error', failed); resolve(server.address().port); };
    server.once('error', failed);
    server.once('listening', ready);
    server.listen(port, '127.0.0.1');
  });
}

/** A complete embedded installation, owned by the desktop application. */
export async function startDesktop({ dataDir, webRoot }) {
  dataDir = resolve(dataDir);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
  const release = await acquireLock(dataDir);
  let api;
  let web;
  let closing;
  const close = () => closing ??= (async () => {
    try {
      if (web?.listening) {
        web.closeAllConnections();
        await new Promise((resolve, reject) => web.close((err) => err ? reject(err) : resolve()));
      }
      await api?.close();
    } finally { await release(); }
  })();
  try {
    const keyFile = join(dataDir, 'encryption.key');
    if (!(await exists(keyFile))) {
      if (await exists(join(dataDir, 'pglite', 'PG_VERSION')))
        throw new Error('Encryption key is missing. Restore encryption.key from your OpenNodes backup.');
      await writeFile(keyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    }
    const key = (await readFile(keyFile, 'utf8')).trim();
    if (!/^[a-f\d]{64}$/i.test(key)) throw new Error('The OpenNodes encryption key is invalid. Restore it from your backup.');
    api = new LocalFlowApiServer({
      databaseUrl: `pglite://${join(dataDir, 'pglite')}`,
      host: '127.0.0.1', encryptionKey: key, executionMode: 'embedded', logLevel: 'warn',
      allowedFsRoot: join(dataDir, 'files'),
      ssrfAllowlist: (process.env.SSRF_ALLOWLIST ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    });
    await mkdir(join(dataDir, 'files'), { recursive: true, mode: 0o700 });
    const apiPort = await api.listen(0, '127.0.0.1');
    web = createWebServer({ root: webRoot, apiUrl: `http://127.0.0.1:${apiPort}` });
    let preferred = 0;
    try {
      const saved = Number(await readFile(join(dataDir, 'web-port'), 'utf8'));
      if (Number.isInteger(saved) && saved >= 1024 && saved <= 65535) preferred = saved;
    } catch { /* first launch */ }
    let webPort;
    try { webPort = await listen(web, preferred); }
    catch (error) {
      if (!preferred || error.code !== 'EADDRINUSE') throw error;
      webPort = await listen(web, 0);
    }
    await writeFile(join(dataDir, 'web-port'), String(webPort), { mode: 0o600 });
    return { url: `http://127.0.0.1:${webPort}`, close };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  let app;
  let startup;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10_000);
    try { const running = app ?? await startup; await running?.close(); clearTimeout(deadline); process.exit(0); }
    catch { process.exit(1); }
  };
  // The native host keeps this pipe open. If it dies, the worker closes its database.
  if (process.env.OPENNODES_DESKTOP_PARENT === '1') {
    process.stdin.resume();
    process.stdin.on('end', stop);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    startup = startDesktop({
      dataDir: process.env.OPENNODES_DATA_DIR ?? join(homedir(), 'Library/Application Support/OpenNodes'),
      webRoot: process.env.OPENNODES_WEB_ROOT ?? resolve(here, '../../../docs'),
    });
    app = await startup;
    if (stopping) await app.close();
    else process.stdout.write(JSON.stringify({ event: 'ready', url: app.url }) + '\n');
  } catch (error) {
    // Do not print configuration or credentials to the host's startup log.
    process.stderr.write(`OpenNodes could not start: ${error.message}\n`);
    process.exit(1);
  }
}
