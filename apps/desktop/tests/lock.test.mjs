import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const helper = fileURLToPath(new URL('../runtime/opennodes-lock', import.meta.url));
function attempt(file) {
  const child = spawn(helper, [file], { stdio: ['pipe', 'pipe', 'pipe'] });
  const exit = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.stdout.once('data', () => resolve(true));
    child.once('exit', () => resolve(false));
  });
  return { child, exit, ready };
}
test('only one owner wins a stale lock; process death releases it without PID reclamation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opennodes-lock-'));
  const file = join(dir, 'desktop.lock');
  const children = [];
  try {
    await writeFile(file, '999999999\n');
    const tries = Array.from({ length: 8 }, () => attempt(file)); children.push(...tries);
    const results = await Promise.all(tries.map((t) => t.ready));
    assert.equal(results.filter(Boolean).length, 1);
    const owner = tries[results.indexOf(true)];
    owner.child.kill('SIGKILL'); await owner.exit;
    const next = attempt(file); children.push(next);
    assert.equal(await next.ready, true);
    next.child.stdin.end(); assert.equal(await next.exit, 0);
  } finally {
    for (const t of children) { t.child.stdin.destroy(); if (t.child.exitCode === null) t.child.kill(); }
    await Promise.all(children.map((t) => t.exit));
    await rm(dir, { recursive: true, force: true });
  }
});
