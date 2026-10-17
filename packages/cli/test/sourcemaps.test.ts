import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findSourcemaps, normalizePrefix, uploadSourcemaps } from '../src/sourcemaps';

const MAP = '{"version":3,"sources":["a.ts"],"mappings":"AAAA"}';

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'tracemark-cli-'));
	await mkdir(join(dir, 'assets/chunks'), { recursive: true });
	await mkdir(join(dir, 'node_modules/x'), { recursive: true });
	// Named by its comment, in another folder.
	await writeFile(join(dir, 'assets/app.js'), 'x();\n//# sourceMappingURL=../maps/app.js.map\n');
	await mkdir(join(dir, 'maps'));
	await writeFile(join(dir, 'maps/app.js.map'), MAP);
	// A sibling map without a comment.
	await writeFile(join(dir, 'assets/chunks/b.mjs'), 'y();');
	await writeFile(join(dir, 'assets/chunks/b.mjs.map'), MAP);
	// Inlined.
	await writeFile(
		join(dir, 'inline.js'),
		`z();\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(MAP).toString('base64')}`
	);
	// No map, not a script, or a dependency.
	await writeFile(join(dir, 'plain.js'), 'w();');
	await writeFile(join(dir, 'style.css.map'), MAP);
	await writeFile(join(dir, 'node_modules/x/index.js'), 'v();');
	await writeFile(join(dir, 'node_modules/x/index.js.map'), MAP);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('finding source maps', () => {
	it('finds each script with a map and names it by its URL path', async () => {
		const maps = await findSourcemaps(dir);
		expect(maps.map((m) => [m.name, m.path?.slice(dir.length), m.content])).toEqual([
			['~/assets/app.js', '/maps/app.js.map', undefined],
			['~/assets/chunks/b.mjs', '/assets/chunks/b.mjs.map', undefined],
			['~/inline.js', undefined, MAP]
		]);
	});

	it('applies the URL prefix', async () => {
		const maps = await findSourcemaps(dir, 'https://cdn.example.com/app');
		expect(maps[0]?.name).toBe('https://cdn.example.com/app/assets/app.js');
		expect(normalizePrefix('~')).toBe('~/');
		expect(normalizePrefix('~/static//')).toBe('~/static/');
		expect(() => normalizePrefix('static/')).toThrow('--url-prefix');
	});
});

describe('uploading', () => {
	it('posts each map gzipped with the release and secret key', async () => {
		const requests: { url: string; headers: Record<string, string>; body: string }[] = [];
		const fake = (async (url: URL, init: RequestInit) => {
			requests.push({
				url: String(url),
				headers: init.headers as Record<string, string>,
				body: gunzipSync(init.body as Uint8Array).toString('utf8')
			});
			return new Response('{}', { status: 201 });
		}) as unknown as typeof fetch;
		const maps = await findSourcemaps(dir);
		const result = await uploadSourcemaps(maps, {
			host: 'https://fp.example.com/',
			secretKey: 'fp_sec_x',
			release: '1.4.0',
			deleteAfter: true,
			fetch: fake
		});
		expect(result.failed).toEqual([]);
		expect(requests.map((r) => r.url).sort()).toEqual([
			'https://fp.example.com/sourcemaps?name=%7E%2Fassets%2Fapp.js&release=1.4.0',
			'https://fp.example.com/sourcemaps?name=%7E%2Fassets%2Fchunks%2Fb.mjs&release=1.4.0',
			'https://fp.example.com/sourcemaps?name=%7E%2Finline.js&release=1.4.0'
		]);
		expect(requests.every((r) => r.body === MAP)).toBe(true);
		expect(requests[0]?.headers).toMatchObject({
			authorization: 'Bearer fp_sec_x',
			'content-encoding': 'gzip'
		});
		// Uploaded map files are gone; scripts stay.
		expect(await readdir(join(dir, 'maps'))).toEqual([]);
		expect((await readdir(join(dir, 'assets/chunks'))).sort()).toEqual(['b.mjs']);
	});

	it('reports failures and stops when the key is refused', async () => {
		let calls = 0;
		const refuse = (async () => {
			calls += 1;
			return Response.json({ error: 'invalid_secret_key' }, { status: 401 });
		}) as unknown as typeof fetch;
		const maps = await findSourcemaps(dir);
		const result = await uploadSourcemaps(maps, {
			host: 'https://fp.example.com',
			secretKey: 'nope',
			concurrency: 1,
			fetch: refuse
		});
		expect(calls).toBe(1);
		expect(result.uploaded).toEqual([]);
		expect(result.failed).toEqual([{ map: maps[0], error: 'invalid_secret_key' }]);
	});

	it('shows the server message for a rejected map', async () => {
		const reject = (async () =>
			Response.json(
				{ error: 'invalid_sourcemap', message: 'The source map is not valid JSON.' },
				{ status: 400 }
			)) as unknown as typeof fetch;
		const [map] = await findSourcemaps(dir);
		const result = await uploadSourcemaps(map ? [map] : [], {
			host: 'https://fp.example.com',
			secretKey: 'fp_sec_x',
			fetch: reject
		});
		expect(result.failed[0]?.error).toBe('The source map is not valid JSON.');
	});
});
