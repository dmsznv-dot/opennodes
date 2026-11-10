import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { packageRuntime } from '../../../scripts/package-desktop-runtime.mjs';

test('packaged runtime resolves production packages and their peer dependencies after relocation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opennodes-package-'));
  try {
    const first = join(root, 'first');
    await packageRuntime(resolve(import.meta.dirname, '..'), first);
    const moved = join(root, 'moved');
    await cp(first, moved, { recursive: true, verbatimSymlinks: true });
    await rm(first, { recursive: true });
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      "await import('@localflow/api'); await import('@localflow/web/server');"], { cwd: moved, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally { await rm(root, { recursive: true, force: true }); }
});
