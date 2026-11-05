import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('native updater validates manifests, archives and replacement rollback', { skip: process.platform !== 'darwin', timeout: 120_000 }, async () => {
  const root = resolve(import.meta.dirname, '../../..');
  const temp = await mkdtemp(join(tmpdir(), 'opennodes-native-tests-'));
  try {
    const binary = join(temp, 'updater-tests');
    const compile = spawnSync('swiftc', ['-swift-version', '5', '-module-cache-path', join(root, 'build/macos/ModuleCache'),
      '-framework', 'Security', join(root, 'apps/desktop/native/UpdateSupport.swift'),
      join(root, 'apps/desktop/tests/UpdateSupportTests.swift'), '-o', binary], { encoding: 'utf8', timeout: 100_000 });
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(binary, [], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /updater checks passed/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
