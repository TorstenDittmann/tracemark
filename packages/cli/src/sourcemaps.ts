// Finds a build's source maps and uploads them to footprint, one `POST /sourcemaps` per map.
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);

const SCRIPT = /\.(?:m|c)?js$/;
const SKIP = new Set(['node_modules', '.git']);
/** `//# sourceMappingURL=…` on the last lines of a file. */
const COMMENT = /\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/;

export interface FoundMap {
	/** The minified file as footprint stores it: the URL prefix plus its path in the build. */
	name: string;
	script: string;
	/** The map file, or undefined for a map inlined as a data URL. */
	path?: string;
	/** Inlined maps only. */
	content?: string;
}

async function* walk(dir: string): AsyncGenerator<string> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else if (entry.isFile()) yield path;
	}
}

const exists = (path: string) =>
	stat(path).then(
		(s) => s.isFile(),
		() => false
	);

/** The prefix with exactly one trailing slash: `~/`, `~/static/` or a full URL. */
export function normalizePrefix(prefix: string): string {
	const trimmed = prefix.trim().replace(/\/+$/, '');
	if (trimmed !== '~' && !trimmed.startsWith('~/') && !/^https?:\/\/[^/]+/.test(trimmed)) {
		throw new Error(`--url-prefix must start with ~/ or http(s)://, got "${prefix}"`);
	}
	return `${trimmed}/`;
}

function inlineMap(url: string): string | undefined {
	const match = /^data:application\/json[^,]*?(;base64)?,(.*)$/s.exec(url);
	if (!match) return undefined;
	const data = match[2] ?? '';
	return match[1] ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
}

/**
 * Every script under `root` with a source map: the one its `sourceMappingURL` comment names, or
 * else a sibling `<script>.map`. Scripts without one are skipped.
 */
export async function findSourcemaps(root: string, prefix = '~/'): Promise<FoundMap[]> {
	const base = normalizePrefix(prefix);
	const found: FoundMap[] = [];
	for await (const script of walk(resolve(root))) {
		if (!SCRIPT.test(script)) continue;
		const name = base + relative(resolve(root), script).split(sep).join('/');
		const text = await readFile(script, 'utf8');
		const url = COMMENT.exec(text.slice(-4096).trimEnd())?.[1];
		if (url?.startsWith('data:')) {
			const content = inlineMap(url);
			if (content) found.push({ name, script, content });
			continue;
		}
		let path: string | undefined;
		if (url && !/^[a-z]+:/i.test(url)) {
			const candidate = resolve(dirname(script), decodeURIComponent(url.split(/[?#]/)[0] ?? ''));
			if (await exists(candidate)) path = candidate;
		}
		if (!path && (await exists(`${script}.map`))) path = `${script}.map`;
		if (path) found.push({ name, script, path });
	}
	return found.sort((a, b) => a.name.localeCompare(b.name));
}

export interface UploadOptions {
	host: string;
	secretKey: string;
	release?: string;
	/** Remove uploaded map files, so they aren't deployed with the build. */
	deleteAfter?: boolean;
	concurrency?: number;
	fetch?: typeof fetch;
	log?: (line: string) => void;
}

export interface UploadResult {
	uploaded: FoundMap[];
	failed: { map: FoundMap; error: string }[];
}

export async function uploadSourcemaps(
	maps: FoundMap[],
	options: UploadOptions
): Promise<UploadResult> {
	const send = options.fetch ?? fetch;
	const log = options.log ?? (() => {});
	const host = options.host.replace(/\/+$/, '');
	const result: UploadResult = { uploaded: [], failed: [] };
	const queue = [...maps];

	const upload = async (map: FoundMap) => {
		const content = map.content ?? (await readFile(map.path ?? '', 'utf8'));
		const url = new URL(`${host}/sourcemaps`);
		url.searchParams.set('name', map.name);
		if (options.release) url.searchParams.set('release', options.release);
		const res = await send(url, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${options.secretKey}`,
				'content-type': 'application/json',
				'content-encoding': 'gzip'
			},
			body: new Uint8Array(await gzipAsync(content))
		});
		// A wrong key fails every upload the same way; stop instead of trying the rest.
		if (res.status === 401) queue.length = 0;
		if (!res.ok) {
			const body = (await res.json().catch(() => null)) as {
				error?: string;
				message?: string;
			} | null;
			throw new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
		}
	};

	const worker = async () => {
		for (let map = queue.shift(); map; map = queue.shift()) {
			try {
				await upload(map);
				result.uploaded.push(map);
				log(`uploaded ${map.name}`);
				if (options.deleteAfter && map.path) await rm(map.path, { force: true });
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				result.failed.push({ map, error });
				log(`failed   ${map.name}: ${error}`);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 4) }, worker));
	return result;
}
