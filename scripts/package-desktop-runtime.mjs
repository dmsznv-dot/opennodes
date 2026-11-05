/** Copy the production dependency closure, preserving package-local resolution. */
import { cp, mkdir, readFile, realpath, stat, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';

export async function packageRuntime(source, destination) {
  const copied = new Map();
  const store = join(destination, 'node_modules', '.runtime');
  async function locate(from, name) {
    let dir = from;
    for (;;) {
      const candidate = join(dir, 'node_modules', name);
      try { if ((await stat(candidate)).isDirectory()) return realpath(candidate); } catch { /* continue */ }
      const parent = dirname(dir);
      if (parent === dir) throw new Error(`Cannot package production dependency ${name} from ${from}`);
      dir = parent;
    }
  }
  async function link(target, at) {
    await mkdir(dirname(at), { recursive: true });
    await symlink(relative(dirname(at), target), at, 'dir');
  }
  async function copyPackage(input) {
    input = await realpath(input);
    if (copied.has(input)) return copied.get(input);
    const manifest = JSON.parse(await readFile(join(input, 'package.json'), 'utf8'));
    const id = createHash('sha256').update(input).digest('hex').slice(0, 16);
    const output = join(store, id, 'node_modules', manifest.name);
    copied.set(input, output);
    await mkdir(output, { recursive: true });
    if (manifest.name.startsWith('@localflow/')) {
      await cp(join(input, 'dist'), join(output, 'dist'), { recursive: true });
      await writeFile(join(output, 'package.json'), JSON.stringify(manifest));
    } else {
      await cp(input, output, {
        recursive: true, dereference: false,
        filter: (p) => p === input || !relative(input, p).split(/[\\/]/).some((s) => ['node_modules', '.git'].includes(s)),
      });
    }
    const deps = { ...manifest.peerDependencies, ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const name of Object.keys(deps)) {
      let dependency;
      try { dependency = await locate(input, name); }
      catch (error) {
        if (manifest.optionalDependencies?.[name] || manifest.peerDependenciesMeta?.[name]?.optional) continue;
        throw error;
      }
      await link(await copyPackage(dependency), join(output, 'node_modules', name));
    }
    return output;
  }
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'package.json'), '{"type":"module"}\n');
  await cp(join(source, 'runtime'), join(destination, 'runtime'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  for (const name of Object.keys(manifest.dependencies))
    await link(await copyPackage(await locate(source, name)), join(destination, 'node_modules', name));
  return copied.size;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const count = await packageRuntime(resolve(process.argv[2]), resolve(process.argv[3]));
  console.log(`Packaged ${count} production packages.`);
}
