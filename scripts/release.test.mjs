import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orderPackages, readPackages, validatePackage } from './release.mjs';

const manifest = {
	name: '@tracemark/example',
	version: '0.1.0',
	publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
	repository: {
		url: 'git+https://github.com/TorstenDittmann/tracemark.git',
		directory: 'packages/example'
	},
	exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } }
};
const files = new Set(['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']);

test('discovers only the ten public npm packages', () => {
	const packages = readPackages();
	assert.equal(packages.length, 10);
	assert.ok(packages.every((pkg) => !pkg.manifest.private));
	assert.ok(
		!packages.some((pkg) => ['@tracemark/errors', '@tracemark/flags'].includes(pkg.manifest.name))
	);
});

test('orders internal runtime and peer dependencies first', () => {
	const packages = orderPackages(readPackages());
	const names = packages.map((pkg) => pkg.manifest.name);
	for (const { manifest } of packages) {
		for (const dependency of Object.keys({
			...manifest.dependencies,
			...manifest.peerDependencies
		})) {
			if (names.includes(dependency))
				assert.ok(names.indexOf(dependency) < names.indexOf(manifest.name));
		}
	}
});

test('rejects dependency cycles', () => {
	assert.throws(
		() =>
			orderPackages([
				{ manifest: { name: 'a', peerDependencies: { b: '*' } } },
				{ manifest: { name: 'b', dependencies: { a: '*' } } }
			]),
		/Circular/
	);
});

test('accepts a complete public tarball', () => {
	assert.doesNotThrow(() => validatePackage(manifest, files, '0.1.0'));
});

test('requires every export, README and license in the tarball', () => {
	for (const file of ['dist/index.js', 'dist/index.d.ts', 'README.md', 'LICENSE']) {
		const incomplete = new Set(files);
		incomplete.delete(file);
		assert.throws(() => validatePackage(manifest, incomplete, '0.1.0'), /missing packed file/);
	}
});

test('rejects private, unversioned or mismatched releases', () => {
	assert.throws(() => validatePackage({ ...manifest, private: true }, files, '0.1.0'), /publicly/);
	for (const version of ['0.0.0', '0.2.0', '0.1.0-beta.1']) {
		assert.throws(() => validatePackage(manifest, files, version), /stable version/);
	}
});

test('rejects local and private runtime dependencies', () => {
	for (const dependencies of [{ sdk: 'workspace:*' }, { '@tracemark/flags': '*' }]) {
		assert.throws(
			() => validatePackage({ ...manifest, dependencies }, files, '0.1.0'),
			/dependency/
		);
	}
});

test('rejects accidental source or secret files', () => {
	for (const file of ['.env', 'src/index.ts', 'test/index.test.ts']) {
		assert.throws(
			() => validatePackage(manifest, new Set([...files, file]), '0.1.0'),
			/unexpected packed/
		);
	}
});
