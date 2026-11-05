import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = resolve(root, 'build/native-temp');
mkdirSync(temporary, { recursive: true });
if (!['darwin', 'linux'].includes(process.platform)) throw new Error('Desktop runtime currently supports macOS and Linux development hosts.');
const result = spawnSync('cc', ['-O2', '-Wall', '-Wextra', '-Werror',
  resolve(root, 'apps/desktop/native/lock.c'), '-o', resolve(root, 'apps/desktop/runtime/opennodes-lock')], {
  stdio: 'inherit', env: { ...process.env, TMPDIR: temporary },
});
if (result.error || result.status) throw result.error ?? new Error('Cannot build the desktop lock helper.');
