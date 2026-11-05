#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageRuntime } from './package-desktop-runtime.mjs';

if (process.platform !== 'darwin') throw new Error('Build the macOS app on a Mac with Xcode Command Line Tools.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'build', 'macos');
const app = join(output, 'OpenNodes.app');
const contents = join(app, 'Contents');
const resources = join(contents, 'Resources');
const version = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8')).version;
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Desktop version must be a stable semantic version.');
const plist = await readFile(join(root, 'apps/desktop/native/Info.plist'), 'utf8');
if (!plist.includes(`<key>CFBundleShortVersionString</key><string>${version}</string>`)) throw new Error('Desktop package and Info.plist versions must match.');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}

// Bundle only reproducible build products; never copy .data, keys or the workspace.
run(process.execPath, [join(root, 'node_modules/turbo/bin/turbo'), 'run', 'build']);
await rm(app, { recursive: true, force: true });
await mkdir(join(contents, 'MacOS'), { recursive: true });
await mkdir(resources, { recursive: true });
const packages = await packageRuntime(join(root, 'apps/desktop'), join(resources, 'runtime'));
await cp(join(root, 'docs'), join(resources, 'editor'), {
  recursive: true,
  filter: (path) => !['development', 'superpowers'].some((name) => path === join(root, 'docs', name)),
});
await cp(process.execPath, join(resources, 'node'));
await cp(join(root, 'apps/desktop/native/Info.plist'), join(contents, 'Info.plist'));
await writeFile(join(resources, 'BUILD.txt'), `OpenNodes macOS alpha ${version}\nNode ${process.version}\nArchitecture: ${process.arch}\nProduction packages: ${packages}\n`);

const iconset = join(output, 'AppIcon.iconset');
await mkdir(iconset, { recursive: true });
for (const size of [16, 32, 128, 256, 512]) {
  run('sips', ['-z', String(size), String(size), join(root, 'assets/icon-1024.png'), '--out', join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
  run('sips', ['-z', String(size * 2), String(size * 2), join(root, 'assets/icon-1024.png'), '--out', join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
}
// PNG-backed ICNS chunks also work when iconutil's image service is unavailable
// in a build sandbox. All sizes are generated from the repository's official icon.
const chunks = [];
for (const [type, name] of [
  ['icp4', 'icon_16x16.png'], ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'], ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'], ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'], ['ic11', 'icon_16x16@2x.png'],
  ['ic12', 'icon_32x32@2x.png'], ['ic13', 'icon_128x128@2x.png'],
  ['ic14', 'icon_256x256@2x.png'],
]) {
  const png = await readFile(join(iconset, name));
  const header = Buffer.alloc(8); header.write(type); header.writeUInt32BE(png.length + 8, 4);
  chunks.push(header, png);
}
const header = Buffer.alloc(8); header.write('icns');
header.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4);
await writeFile(join(resources, 'AppIcon.icns'), Buffer.concat([header, ...chunks]));
run('swiftc', ['-swift-version', '5', '-O', '-module-cache-path', join(output, 'ModuleCache'),
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`,
  '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'Security',
  join(root, 'apps/desktop/native/UpdateSupport.swift'), join(root, 'apps/desktop/native/Updater.swift'),
  join(root, 'apps/desktop/native/main.swift'), '-o', join(contents, 'MacOS/OpenNodes')]);

run('swiftc', ['-swift-version', '5', '-O', '-module-cache-path', join(output, 'ModuleCache'),
  '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`,
  '-framework', 'AppKit', '-framework', 'Security',
  join(root, 'apps/desktop/native/UpdateSupport.swift'), join(root, 'apps/desktop/native/update-helper.swift'),
  '-o', join(resources, 'OpenNodesUpdateHelper')]);

// Node is redistributed with its full upstream license; dependency licenses stay in
// their packages. A release build must never quietly omit the runtime's license.
const nodeLicenseCandidates = [
  process.env.NODE_LICENSE_FILE,
  resolve(dirname(process.execPath), '../share/doc/node/LICENSE'),
  resolve(dirname(process.execPath), '../LICENSE'),
  join(root, 'apps/desktop/licenses/NODE_LICENSE'),
].filter(Boolean);
let foundLicense = false;
for (const candidate of nodeLicenseCandidates) {
  try { await access(candidate); await cp(candidate, join(resources, 'NODE_LICENSE')); foundLicense = true; break; }
  catch { /* try the next distribution layout */ }
}
if (!foundLicense) throw new Error('Set NODE_LICENSE_FILE to the LICENSE from the bundled Node distribution.');

run('codesign', ['--force', '--deep', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', app]);
const zip = join(output, `OpenNodes-macOS-${process.arch}.zip`);
await rm(zip, { force: true });
run('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--keepParent', app, zip]);
run(process.execPath, [join(root, 'scripts/validate-macos-update.mjs'), zip, app, version]);
console.log(`\nBuilt ${app}\nArchive: ${zip}`);
