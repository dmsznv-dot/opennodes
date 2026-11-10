#!/usr/bin/env node
// Verify the exact archive shipped to Releases with the same checks used in-app.
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('macOS update validation requires a Mac.');
const [archive, app, version] = process.argv.slice(2);
if (!archive || !app || !version) throw new Error('Usage: node scripts/validate-macos-update.mjs archive.zip OpenNodes.app version');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'opennodes-archive-check-'));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}
try {
  const main = join(temp, 'main.swift'), executable = join(temp, 'validate-update');
  await writeFile(main, `import Foundation
try validateUpdateZIP(URL(fileURLWithPath: CommandLine.arguments[1]))
try validateUpdateBundle(URL(fileURLWithPath: CommandLine.arguments[2]).standardizedFileURL, version: CommandLine.arguments[3], architecture: VerifiedRelease.architecture)
print("Release archive and bundle pass native update validation.")
`);
  const cache = join(root, 'build/macos/ModuleCache');
  await mkdir(cache, { recursive: true });
  run('swiftc', ['-swift-version', '5', '-module-cache-path', cache, '-framework', 'Security', join(root, 'apps/desktop/native/UpdateSupport.swift'), main, '-o', executable]);
  run(executable, [resolve(archive), resolve(app), version]);
} finally { await rm(temp, { recursive: true, force: true }); }
