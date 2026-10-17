import { execFileSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org/';
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function readPackages(directory = root) {
	return readdirSync(join(directory, 'packages'))
		.sort()
		.flatMap((name) => {
			const path = join(directory, 'packages', name);
			if (!existsSync(join(path, 'package.json'))) return [];
			const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
			return manifest.private ? [] : [{ path, manifest }];
		});
}

// Publish SDKs before their framework adapters, including peer dependencies.
export function orderPackages(packages) {
	const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
	const visiting = new Set();
	const visited = new Set();
	const ordered = [];
	function visit(pkg) {
		const name = pkg.manifest.name;
		if (visiting.has(name)) throw new Error(`Circular release dependency: ${name}`);
		if (visited.has(name)) return;
		visiting.add(name);
		for (const dependency of Object.keys({
			...pkg.manifest.dependencies,
			...pkg.manifest.optionalDependencies,
			...pkg.manifest.peerDependencies
		})) {
			if (byName.has(dependency)) visit(byName.get(dependency));
		}
		visiting.delete(name);
		visited.add(name);
		ordered.push(pkg);
	}
	for (const pkg of packages) visit(pkg);
	return ordered;
}

function targets(value) {
	if (typeof value === 'string') return [value.replace(/^\.\//, '')];
	return Object.values(value ?? {}).flatMap(targets);
}

export function validatePackage(manifest, files, version) {
	const fail = (message) => {
		throw new Error(`${manifest.name}: ${message}`);
	};
	if (!stableVersion.test(version) || version === '0.0.0' || manifest.version !== version) {
		fail(`expected a shared, non-zero stable version (${version})`);
	}
	if (manifest.private || manifest.publishConfig?.access !== 'public') {
		fail('must explicitly publish publicly');
	}
	if (manifest.publishConfig?.registry !== registry) fail('unexpected npm registry');
	if (!manifest.repository?.url || !manifest.repository.directory) fail('missing repository');
	for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
		for (const [name, range] of Object.entries(manifest[section] ?? {})) {
			if (/^(workspace:|file:|link:)/.test(range)) fail(`local dependency ${name}`);
			if (['@tracemark/errors', '@tracemark/flags'].includes(name)) {
				fail(`private dependency ${name} must be bundled`);
			}
		}
	}
	for (const file of [
		'package.json',
		'README.md',
		'LICENSE',
		...targets(manifest.exports),
		...targets(manifest.bin),
		...targets(manifest.main),
		...targets(manifest.types),
		...targets(manifest.unpkg),
		...targets(manifest.jsdelivr)
	]) {
		if (!files.has(file)) fail(`missing packed file: ${file}`);
	}
	for (const file of files) {
		if (!file.startsWith('dist/') && !['package.json', 'README.md', 'LICENSE'].includes(file)) {
			fail(`unexpected packed file: ${file}`);
		}
	}
}

function setVersion(packages, version) {
	if (!stableVersion.test(version ?? '') || version === '0.0.0') {
		throw new Error('Usage: bun run release:version <stable version, e.g. 0.2.0>');
	}
	const names = new Set(packages.map((pkg) => pkg.manifest.name));
	for (const { path, manifest } of packages) {
		manifest.version = version;
		for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
			for (const name of Object.keys(manifest[section] ?? {})) {
				if (names.has(name)) manifest[section][name] = `^${version}`;
			}
		}
		writeFileSync(join(path, 'package.json'), `${JSON.stringify(manifest, null, '\t')}\n`);
		const sdkVersion = join(path, 'src/version.ts');
		if (existsSync(sdkVersion)) {
			writeFileSync(
				sdkVersion,
				readFileSync(sdkVersion, 'utf8').replace(
					/export const VERSION = '[^']+';/,
					`export const VERSION = '${version}';`
				)
			);
		}
	}
	console.log(
		`Set ${packages.length} public packages to ${version}. Run bun install to update bun.lock.`
	);
}

async function main() {
	const [command, argument] = process.argv.slice(2);
	const packages = orderPackages(readPackages());
	if (command === 'version') return setVersion(packages, argument);
	if (!['check', 'publish'].includes(command))
		throw new Error('Expected check, publish or version');
	if (!packages.length) throw new Error('No public packages found');
	const version = packages[0].manifest.version;
	if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `npm-v${version}`) {
		throw new Error(`Release tag must match npm-v${version}`);
	}

	const temporary = mkdtempSync(join(tmpdir(), 'tracemark-release-'));
	try {
		const packed = [];
		for (const { path, manifest } of packages) {
			// Stage only public assets. The repository's MIT license belongs in every tarball.
			const staging = join(temporary, manifest.name.replace('/', '-'));
			cpSync(join(path, 'dist'), join(staging, 'dist'), { recursive: true });
			for (const file of ['package.json', 'README.md'])
				cpSync(join(path, file), join(staging, file));
			cpSync(join(root, 'LICENSE'), join(staging, 'LICENSE'));
			const [result] = JSON.parse(
				execFileSync(
					'npm',
					['pack', '--json', '--ignore-scripts', '--pack-destination', temporary],
					{
						cwd: staging,
						encoding: 'utf8'
					}
				)
			);
			validatePackage(manifest, new Set(result.files.map((file) => file.path)), version);
			packed.push({ manifest, tarball: join(temporary, result.filename) });
			console.log(
				`Checked ${manifest.name}@${version}: ${result.files.length} files, ${result.size} B`
			);
		}
		if (command === 'check') return;
		for (const { manifest, tarball } of packed) {
			// npm versions are immutable. This lets a partially completed release be retried.
			const response = await fetch(`${registry}${encodeURIComponent(manifest.name)}/${version}`, {
				signal: AbortSignal.timeout(30_000)
			});
			if (response.ok) {
				console.log(`Skipping already published ${manifest.name}@${version}`);
				continue;
			}
			if (response.status !== 404) throw new Error(`Registry lookup failed: ${response.status}`);
			execFileSync(
				'npm',
				['publish', tarball, '--access', 'public', '--tag', 'latest', '--registry', registry],
				{
					cwd: root,
					stdio: 'inherit'
				}
			);
		}
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
