import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ExceptionEntry } from '../issues';
import { organizations } from './db/schema';
import { createProject } from './projects';
import {
	candidateNames,
	defaultSourcemapsDir,
	deleteProjectSourcemaps,
	deleteSourcemapRelease,
	displaySource,
	readMapBody,
	saveSourcemap,
	sourcemapReleases,
	symbolicate,
	TooLarge,
	validName
} from './sourcemaps';
import { createTestDb } from './test-db';

// `src/cart.ts`, minified to one line: `function add(n,r){return n+r}throw new Error('x');`
// Column 1 maps to line 1, column 31 (the throw) to line 4.
const source = "function add(a, b) {\n  return a + b;\n}\nthrow new Error('x');\n";
const map = (sources = ['src/cart.ts']) =>
	JSON.stringify({
		version: 3,
		file: 'cart.js',
		sources,
		sourcesContent: [source],
		names: [],
		mappings: 'AAAA,8BAGA'
	});

const exception = (filename: string, colno: number): ExceptionEntry[] => [
	{
		type: 'Error',
		value: 'x',
		frames: [
			{ filename, function: 'a', lineno: 1, colno, inApp: true },
			{ filename: 'node:internal/x', function: 'b', lineno: 1, colno: 1, inApp: false }
		]
	}
];

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'tracemark-maps-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function setup() {
	const db = await createTestDb();
	const [org] = await db.insert(organizations).values({ name: 'Acme', slug: 'acme' }).returning();
	const project = await createProject(db, org.id, 'Website');
	const other = await createProject(db, org.id, 'App');
	return { db, project, other };
}

describe('names', () => {
	it('accepts ~/ paths and absolute URLs', () => {
		expect(validName('~/assets/app.js')).toBe(true);
		expect(validName('https://cdn.example.com/app.js')).toBe(true);
		expect(validName('assets/app.js')).toBe(false);
		expect(validName('~/app.js?v=1')).toBe(false);
		expect(validName('~/')).toBe(false);
	});

	it('matches a frame by full URL, then by path on any origin', () => {
		expect(candidateNames('https://shop.example.com/assets/app.js?v=2#x')).toEqual([
			'https://shop.example.com/assets/app.js',
			'~/assets/app.js'
		]);
		expect(candidateNames('/srv/app/index.js')).toEqual([]);
		expect(candidateNames('node:internal/x')).toEqual([]);
	});

	it('shortens source paths for display', () => {
		expect(displaySource('../../src/cart.ts')).toBe('src/cart.ts');
		expect(displaySource('webpack://shop/./src/cart.ts')).toBe('src/cart.ts');
		expect(displaySource('src/cart.ts')).toBe('src/cart.ts');
	});

	it('defaults the directory next to a file database', () => {
		expect(defaultSourcemapsDir('file:/data/tracemark.db')).toBe('/data/sourcemaps');
		expect(defaultSourcemapsDir('file:///data/tracemark.db')).toBe('/data/sourcemaps');
		expect(defaultSourcemapsDir('libsql://db.example.com')).toMatch(/data\/sourcemaps$/);
	});
});

describe('source maps', () => {
	it('rejects what is not a source map', async () => {
		const { db, project } = await setup();
		const save = (text: string) =>
			saveSourcemap(db, dir, { projectId: project.id, release: '', name: '~/a.js', map: text });
		await expect(save('nope')).rejects.toThrow('not valid JSON');
		await expect(save('{"version":2}')).rejects.toThrow('version 3');
	});

	it('maps frames to the original source, preferring the event release', async () => {
		const { db, project, other } = await setup();
		await saveSourcemap(db, dir, {
			projectId: project.id,
			release: '',
			name: '~/assets/cart.js',
			map: map(['src/any-release.ts'])
		});
		await saveSourcemap(db, dir, {
			projectId: project.id,
			release: '1.0.0',
			name: '~/assets/cart.js',
			map: map()
		});

		const [entry] = await symbolicate(
			db,
			dir,
			project.id,
			'1.0.0',
			exception('https://shop.example.com/assets/cart.js', 31)
		);
		expect(entry?.frames[0]?.original).toEqual({
			source: 'src/cart.ts',
			line: 4,
			column: 1,
			name: undefined,
			context: {
				start: 1,
				lines: ['function add(a, b) {', '  return a + b;', '}', "throw new Error('x');", '']
			}
		});
		expect(entry?.frames[1]?.original).toBeUndefined();

		// Another release falls back to the map without a release.
		const [fallback] = await symbolicate(
			db,
			dir,
			project.id,
			'2.0.0',
			exception('https://shop.example.com/assets/cart.js', 1)
		);
		expect(fallback?.frames[0]?.original).toMatchObject({ source: 'src/any-release.ts', line: 1 });

		// Other projects and other files don't match.
		const [none] = await symbolicate(
			db,
			dir,
			other.id,
			'1.0.0',
			exception('https://shop.example.com/assets/cart.js', 31)
		);
		expect(none?.frames[0]?.original).toBeUndefined();
		const [miss] = await symbolicate(
			db,
			dir,
			project.id,
			'1.0.0',
			exception('https://shop.example.com/assets/other.js', 31)
		);
		expect(miss?.frames[0]?.original).toBeUndefined();
	});

	it('replaces, lists and deletes uploads', async () => {
		const { db, project } = await setup();
		const save = (release: string, name: string) =>
			saveSourcemap(db, dir, { projectId: project.id, release, name, map: map() });
		await save('1.0.0', '~/a.js');
		await save('1.0.0', '~/b.js');
		await save('1.0.0', '~/a.js');
		await save('1.1.0', '~/a.js');

		const releases = await sourcemapReleases(db, project.id);
		expect(releases.map((r) => [r.release, r.files, r.size])).toEqual([
			['1.1.0', 1, map().length],
			['1.0.0', 2, map().length * 2]
		]);
		expect(await readdir(join(dir, project.id))).toHaveLength(3);

		expect(await deleteSourcemapRelease(db, dir, project.id, '1.0.0')).toBe(2);
		expect(await readdir(join(dir, project.id))).toHaveLength(1);
		const [left] = await symbolicate(
			db,
			dir,
			project.id,
			'1.0.0',
			exception('https://x.example/a.js', 31)
		);
		expect(left?.frames[0]?.original).toBeUndefined();

		await deleteProjectSourcemaps(dir, project.id);
		expect(await readdir(dir)).toEqual([]);
	});
});

describe('upload bodies', () => {
	const stream = (bytes: Uint8Array) => new Response(new Uint8Array(bytes)).body;

	it('reads plain and gzipped bodies', async () => {
		const text = map();
		expect(await readMapBody(stream(new TextEncoder().encode(text)), null)).toBe(text);
		expect(await readMapBody(stream(gzipSync(text)), 'gzip')).toBe(text);
		expect(await readMapBody(null, null)).toBe('');
	});

	it('refuses bodies past the limit, uncompressed', async () => {
		const big = gzipSync('x'.repeat(1000));
		expect(big.byteLength).toBeLessThan(100);
		await expect(readMapBody(stream(big), 'gzip', 100)).rejects.toBeInstanceOf(TooLarge);
	});

	it('refuses broken gzip and other encodings', async () => {
		await expect(readMapBody(stream(new Uint8Array([1, 2, 3])), 'gzip')).rejects.toThrow(
			'not valid gzip'
		);
		await expect(readMapBody(stream(new Uint8Array([1])), 'br')).rejects.toThrow('br');
	});
});
