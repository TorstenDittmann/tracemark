// Copies packages and everything they depend on out of bun's isolated node_modules,
// so the production image ships only what the built server and scripts load at runtime.
// Usage: bun scripts/copy-runtime-deps.ts <out-dir> <package>... [--exclude <substring>]...
// Store entries whose name contains an excluded substring (type-only packages, other libc builds) are skipped.
import { cp, mkdir, readdir, realpath, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const excluded: string[] = [];
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--exclude') excluded.push(args[++i] ?? '');
	else positional.push(args[i]);
}
const [outDir, ...packages] = positional;
if (!outDir || packages.length === 0) {
	console.error('usage: copy-runtime-deps.ts <out-dir> <package>...');
	process.exit(1);
}

const store = `${sep}node_modules${sep}.bun${sep}`;

/** `/repo/node_modules/.bun/<entry>` for a package directory that lives in bun's store. */
function entryOf(packageDir: string): string {
	const at = packageDir.indexOf(store);
	if (at === -1) throw new Error(`${packageDir} is not in bun's isolated store`);
	const entry = packageDir.slice(at + store.length).split(sep)[0];
	return packageDir.slice(0, at + store.length) + entry;
}

/** Package directories linked from an entry's node_modules (the package itself and its dependencies). */
async function linked(entry: string): Promise<string[]> {
	const modules = join(entry, 'node_modules');
	const dirs: string[] = [];
	for (const name of await readdir(modules)) {
		const names = name.startsWith('@')
			? (await readdir(join(modules, name))).map((sub) => join(name, sub))
			: [name];
		for (const pkg of names) dirs.push(await realpath(join(modules, pkg)));
	}
	return dirs;
}

const roots = await Promise.all(packages.map((name) => realpath(join('node_modules', name))));
const seen = new Set<string>();
const queue = roots.map(entryOf);
while (queue.length > 0) {
	const entry = queue.pop() as string;
	const name = entry.slice(entry.lastIndexOf(sep) + 1);
	if (seen.has(entry) || excluded.some((part) => part && name.includes(part))) continue;
	seen.add(entry);
	for (const dir of await linked(entry)) queue.push(entryOf(dir));
}

const outStore = resolve(outDir, 'node_modules', '.bun');
await mkdir(outStore, { recursive: true });
for (const entry of seen) {
	await cp(entry, join(outStore, entry.slice(entry.lastIndexOf(sep) + 1)), {
		recursive: true,
		verbatimSymlinks: true
	});
}
for (const [index, name] of packages.entries()) {
	const link = resolve(outDir, 'node_modules', name);
	const target = join(outStore, relative(dirname(entryOf(roots[index])), roots[index]));
	await mkdir(dirname(link), { recursive: true });
	await symlink(relative(dirname(link), target), link);
}
console.log(`copied ${seen.size} packages for ${packages.join(', ')}`);
