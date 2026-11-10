import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';

test(
  'desktop starts a live editor, saves data, rejects a second owner and stops cleanly',
  { timeout: 120000 },
  async (t) => {
    // This round trip includes two disk-backed database boots, account setup/login
    // and two graceful shutdowns. The native host permits 60 s for one startup.
    const timed = async (name, action) => {
      const at = performance.now();
      try {
        return await action();
      } finally {
        t.diagnostic(`${name}: ${Math.round(performance.now() - at)} ms`);
      }
    };
    const module = await timed(
      'runtime module import',
      () => import('../runtime/desktop-server.mjs')
    ).catch(() => ({}));
    assert.equal(typeof module.startDesktop, 'function', 'desktop runtime must be implemented');
    const dir = await mkdtemp(join(tmpdir(), 'opennodes-desktop-'));
    const root = resolve(import.meta.dirname, '../../../docs');
    let app;
    let restarted;
    try {
      app = await timed('first disk-backed startup', () =>
        module.startDesktop({ dataDir: dir, webRoot: root })
      );
      assert.equal(new URL(app.url).hostname, '127.0.0.1');
      assert.match(await (await fetch(`${app.url}/config.js`)).text(), /api: '\/api\/v1'/);
      assert.equal((await fetch(`${app.url}/health/ready`)).status, 200);
      assert.equal((await fetch(`${app.url}/`)).status, 200);
      await assert.rejects(module.startDesktop({ dataDir: dir, webRoot: root }), /already in use/);
      const setup = await timed('owner setup', () =>
        fetch(`${app.url}/api/v1/setup`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'desktop@example.com', password: 'DesktopPassword123!' }),
        })
      );
      assert.equal(setup.status, 201);
      const { token, workspaceId } = await setup.json();
      const created = await timed('credential persistence', () =>
        fetch(`${app.url}/api/v1/workspaces/${workspaceId}/credentials`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            name: 'Persistent',
            type: 'openai',
            secrets: { apiKey: 'test-secret' },
          }),
        })
      );
      assert.equal(created.status, 201);
      const key = await readFile(join(dir, 'encryption.key'), 'utf8');
      const oldUrl = app.url;
      await timed('first shutdown', () => app.close());
      app = null;
      restarted = await timed('persisted database restart', () =>
        module.startDesktop({ dataDir: dir, webRoot: root })
      );
      assert.equal(restarted.url, oldUrl, 'editor origin is stable after restart');
      assert.equal(await readFile(join(dir, 'encryption.key'), 'utf8'), key);
      const login = await timed('login', () =>
        fetch(`${restarted.url}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'desktop@example.com', password: 'DesktopPassword123!' }),
        })
      );
      assert.equal(login.status, 200);
      const session = await login.json();
      const credentials = await fetch(
        `${restarted.url}/api/v1/workspaces/${workspaceId}/credentials`,
        {
          headers: { authorization: `Bearer ${session.token}` },
        }
      );
      assert.match(await credentials.text(), /Persistent/);
      await timed('second shutdown', () => restarted.close());
      restarted = null;
      await assert.rejects(fetch(oldUrl));
    } finally {
      await app?.close();
      await restarted?.close();
      await rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  'an occupied editor port selects a free port without opening the unrelated server',
  { timeout: 30000 },
  async () => {
    const module = await import('../runtime/desktop-server.mjs').catch(() => ({}));
    assert.equal(typeof module.startDesktop, 'function');
    const dir = await mkdtemp(join(tmpdir(), 'opennodes-port-'));
    const root = resolve(import.meta.dirname, '../../../docs');
    let app;
    let blocker;
    try {
      app = await module.startDesktop({ dataDir: dir, webRoot: root });
      const port = Number(new URL(app.url).port);
      await app.close();
      app = null;
      blocker = createServer();
      await new Promise((resolve) => blocker.listen(port, '127.0.0.1', resolve));
      app = await module.startDesktop({ dataDir: dir, webRoot: root });
      assert.notEqual(Number(new URL(app.url).port), port);
      assert.equal((await fetch(`${app.url}/health/ready`)).status, 200);
    } finally {
      await app?.close();
      if (blocker) await new Promise((resolve) => blocker.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  }
);
