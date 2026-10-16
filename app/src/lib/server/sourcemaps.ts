// Source maps: stored gzipped on disk, indexed in libSQL, and used to show original source
// locations for minified stack frames on the issue page.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { originalPositionFor, sourceContentFor, TraceMap } from '@jridgewell/trace-mapping';
import { and, desc, eq, inArray, max, sql, sum } from 'drizzle-orm';
import type { ExceptionEntry, StackFrame } from '../issues';
import type { Db } from './db/client';
import { type Sourcemap, sourcemaps } from './db/schema';

/** Largest map accepted, uncompressed. */
export const MAX_MAP_BYTES = 64 * 1024 * 1024;
export const MAX_NAME = 1000;
export const MAX_RELEASE = 200;
/** Source lines shown around a frame's line, on each side. */
const CONTEXT = 3;
/** Parsed maps kept in memory. */
const CACHE_SIZE = 16;

/** Where maps go by default: `sourcemaps/` beside a file database, else `./data/sourcemaps`. */
export function defaultSourcemapsDir(databaseUrl: string): string {
	if (databaseUrl.startsWith('file:')) {
		const path = databaseUrl.startsWith('file://')
			? fileURLToPath(databaseUrl)
			: databaseUrl.slice('file:'.length);
		if (path && path !== ':memory:') return join(dirname(resolve(path)), 'sourcemaps');
	}
	return resolve('data/sourcemaps');
}

/** A minified file's name as maps are stored: `~/path` for any origin, or a full URL. */
export function validName(name: string): boolean {
	return (
		name.length > 2 &&
		name.length <= MAX_NAME &&
		(name.startsWith('~/') || /^https?:\/\/[^/]+\//.test(name)) &&
		!/[\s?#]/.test(name)
	);
}

export const validRelease = (release: string) =>
	release.length <= MAX_RELEASE && !/[\n\r\0]/.test(release);

/** Names a frame's file could be stored under, most specific first. */
export function candidateNames(filename: string): string[] {
	let url: URL;
	try {
		url = new URL(filename);
	} catch {
		return [];
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return [];
	return [`${url.origin}${url.pathname}`, `~${url.pathname}`];
}

const fileOf = (dir: string, projectId: string, release: string, name: string) =>
	join(
		dir,
		projectId,
		`${createHash('sha256').update(`${release}\0${name}`).digest('hex')}.map.gz`
	);

/** Checks a map parses; throws with a readable message otherwise. */
function parseMap(text: string): TraceMap {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error('The source map is not valid JSON.');
	}
	const map = json as { version?: unknown; mappings?: unknown; sources?: unknown };
	if (map?.version !== 3 || typeof map.mappings !== 'string' || !Array.isArray(map.sources)) {
		throw new Error('Only version 3 source maps with mappings and sources are supported.');
	}
	return new TraceMap(map as ConstructorParameters<typeof TraceMap>[0]);
}

/** Stores a map, replacing one uploaded before for the same release and file. */
export async function saveSourcemap(
	db: Db,
	dir: string,
	values: { projectId: string; release: string; name: string; map: string }
): Promise<Sourcemap> {
	parseMap(values.map);
	const file = fileOf(dir, values.projectId, values.release, values.name);
	await mkdir(dirname(file), { recursive: true });
	const temp = `${file}.${crypto.randomUUID()}.tmp`;
	await writeFile(temp, gzipSync(values.map));
	await rename(temp, file);
	const size = Buffer.byteLength(values.map);
	const [row] = await db
		.insert(sourcemaps)
		.values({ projectId: values.projectId, release: values.release, name: values.name, size })
		.onConflictDoUpdate({
			target: [sourcemaps.projectId, sourcemaps.release, sourcemaps.name],
			set: { size, createdAt: new Date() }
		})
		.returning();
	if (!row) throw new Error('failed to store source map');
	cache.delete(file);
	return row;
}

/** Uploads per release, newest first. */
export async function sourcemapReleases(db: Db, projectId: string) {
	return db
		.select({
			release: sourcemaps.release,
			files: sql<number>`count(*)`,
			size: sum(sourcemaps.size).mapWith(Number),
			uploadedAt: max(sourcemaps.createdAt).mapWith((value: number) => new Date(value))
		})
		.from(sourcemaps)
		.where(eq(sourcemaps.projectId, projectId))
		.groupBy(sourcemaps.release)
		.orderBy(desc(max(sourcemaps.createdAt)), desc(sourcemaps.release));
}

export async function deleteSourcemapRelease(
	db: Db,
	dir: string,
	projectId: string,
	release: string
) {
	const rows = await db
		.delete(sourcemaps)
		.where(and(eq(sourcemaps.projectId, projectId), eq(sourcemaps.release, release)))
		.returning();
	for (const row of rows) {
		const file = fileOf(dir, projectId, row.release, row.name);
		cache.delete(file);
		await rm(file, { force: true });
	}
	return rows.length;
}

/** Removes a deleted project's files; its rows go with the project. */
export async function deleteProjectSourcemaps(dir: string, projectId: string) {
	await rm(join(dir, projectId), { recursive: true, force: true });
}

const cache = new Map<string, TraceMap | null>();

async function load(file: string): Promise<TraceMap | null> {
	if (cache.has(file)) {
		const hit = cache.get(file) ?? null;
		// Most recently used last.
		cache.delete(file);
		cache.set(file, hit);
		return hit;
	}
	let map: TraceMap | null = null;
	try {
		map = parseMap(gunzipSync(await readFile(file)).toString('utf8'));
	} catch {}
	cache.set(file, map);
	if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
	return map;
}

/** A map's source path without bundler prefixes or leading `../`: `src/cart.ts`. */
export const displaySource = (source: string) =>
	source.replace(/^(?:webpack:\/\/[^/]*\/|file:\/\/)?(?:\.{1,2}\/)*/, '');

function resolveFrame(map: TraceMap, frame: StackFrame): StackFrame {
	if (frame.lineno === undefined) return frame;
	const position = originalPositionFor(map, {
		line: frame.lineno,
		// Stack traces count columns from 1, source maps from 0.
		column: Math.max(0, (frame.colno ?? 1) - 1)
	});
	if (!position.source || position.line === null) return frame;
	const content = sourceContentFor(map, position.source);
	let context: { start: number; lines: string[] } | undefined;
	if (content) {
		const lines = content.split(/\r?\n/);
		const start = Math.max(1, position.line - CONTEXT);
		context = {
			start,
			lines: lines.slice(start - 1, position.line + CONTEXT).map((line) => line.slice(0, 300))
		};
	}
	return {
		...frame,
		original: {
			source: displaySource(position.source),
			line: position.line,
			column: position.column === null ? undefined : position.column + 1,
			name: position.name ?? undefined,
			context
		}
	};
}

/**
 * Exceptions with original locations for frames a stored map covers. Maps uploaded for the
 * event's release win over ones uploaded without a release.
 */
export async function symbolicate(
	db: Db,
	dir: string,
	projectId: string,
	release: string,
	exceptions: ExceptionEntry[]
): Promise<ExceptionEntry[]> {
	const names = [
		...new Set(exceptions.flatMap((e) => e.frames.flatMap((f) => candidateNames(f.filename))))
	];
	if (!names.length) return exceptions;
	const rows = await db
		.select()
		.from(sourcemaps)
		.where(
			and(
				eq(sourcemaps.projectId, projectId),
				inArray(sourcemaps.name, names),
				inArray(sourcemaps.release, release ? [release, ''] : [''])
			)
		);
	if (!rows.length) return exceptions;
	const find = (filename: string) => {
		for (const name of candidateNames(filename)) {
			const row =
				rows.find((r) => r.name === name && r.release === release) ??
				rows.find((r) => r.name === name && r.release === '');
			if (row) return row;
		}
		return undefined;
	};
	const result: ExceptionEntry[] = [];
	for (const entry of exceptions) {
		const frames: StackFrame[] = [];
		for (const frame of entry.frames) {
			const row = find(frame.filename);
			const map = row && (await load(fileOf(dir, projectId, row.release, row.name)));
			frames.push(map ? resolveFrame(map, frame) : frame);
		}
		result.push({ ...entry, frames });
	}
	return result;
}

export class TooLarge extends Error {}

/**
 * A request body as text, gunzipped when sent with `content-encoding: gzip`. Throws `TooLarge`
 * past `limit` bytes uncompressed, without reading the rest.
 */
export async function readMapBody(
	body: ReadableStream<Uint8Array> | null,
	encoding: string | null,
	limit = MAX_MAP_BYTES
): Promise<string> {
	if (!body) return '';
	let stream = body;
	if (encoding?.trim().toLowerCase() === 'gzip') {
		stream = body.pipeThrough(
			new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>
		);
	} else if (encoding && encoding.trim().toLowerCase() !== 'identity') {
		throw new Error(`Unsupported content-encoding ${encoding}; send gzip or nothing.`);
	}
	const chunks: Uint8Array[] = [];
	let size = 0;
	const reader = stream.getReader();
	for (;;) {
		let next: Awaited<ReturnType<typeof reader.read>>;
		try {
			next = await reader.read();
		} catch {
			throw new Error('The body is not valid gzip.');
		}
		if (next.done) break;
		size += next.value.byteLength;
		if (size > limit) {
			await reader.cancel().catch(() => {});
			throw new TooLarge('The source map is too large.');
		}
		chunks.push(next.value);
	}
	return Buffer.concat(chunks).toString('utf8');
}
