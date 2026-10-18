// The read API under /api/v1: secret-key auth and request parsing, see docs/query-api.md.
import { json } from '@sveltejs/kit';
import { ACTIVITY_PAGE_SIZE, type ActivityPage, formatCursor } from '../explore';
import { getDb } from './db/index';
import { projectBySecretKey } from './projects';
import { isInsightKind, parseSavedQuery, type SavedQuery, withFilterInternal } from './saved';

/** Largest request body the API reads. */
export const MAX_BODY_BYTES = 64 * 1024;
/** Most events one page returns. */
export const MAX_EVENTS_PAGE = 500;

export const NO_STORE = { 'cache-control': 'no-store' };

export const failure = (status: number, error: string, message?: string) =>
	json(message ? { error, message } : { error }, { status, headers: NO_STORE });

/** The key from `Authorization: Bearer …`, or an empty string. */
export function bearerKey(request: Request): string {
	const header = request.headers.get('authorization') ?? '';
	return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** The project whose secret key the request carries, or null. */
export async function secretKeyProject(request: Request) {
	const key = bearerKey(request);
	return key ? await projectBySecretKey(getDb(), key) : null;
}

export class InvalidRequest extends Error {}

/**
 * A query body: `{"kind": "trends" | "funnel" | "retention" | "paths" | "lifecycle", "query": {…}}`,
 * with an optional boolean `filterInternal`. The kind must be valid; the query is read like the
 * editors read it, so invalid parts fall back to defaults and the response shows the query that
 * ran. Without `filterInternal` (here or in the query) the project's setting applies.
 */
export function parseQueryBody(input: unknown): SavedQuery {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		throw new InvalidRequest('The body must be a JSON object.');
	}
	const { kind, query, filterInternal } = input as Record<string, unknown>;
	if (!isInsightKind(kind)) {
		throw new InvalidRequest(
			'kind must be "trends", "funnel", "retention", "paths" or "lifecycle".'
		);
	}
	if (
		query !== undefined &&
		(typeof query !== 'object' || query === null || Array.isArray(query))
	) {
		throw new InvalidRequest('query must be an object.');
	}
	if (filterInternal !== undefined && typeof filterInternal !== 'boolean') {
		throw new InvalidRequest('filterInternal must be true or false.');
	}
	const saved = parseSavedQuery(kind, JSON.stringify(query ?? {}));
	return filterInternal === undefined ? saved : withFilterInternal(saved, filterInternal, true);
}

/** Reads a JSON body up to MAX_BODY_BYTES. */
export async function readJson(request: Request): Promise<unknown> {
	const raw = await request.text();
	if (raw.length > MAX_BODY_BYTES) throw new InvalidRequest('The body is over 64 KB.');
	try {
		return JSON.parse(raw);
	} catch {
		throw new InvalidRequest('The body is not valid JSON.');
	}
}

/** `?limit=`: a whole number from 1 to `max`, else the default. */
export function parseLimit(value: string | null, max: number, fallback = ACTIVITY_PAGE_SIZE) {
	const n = Number(value);
	return value && Number.isInteger(n) && n >= 1 ? Math.min(n, max) : fallback;
}

/** An events page with its cursor as the string `?before=` takes. */
export function eventsResponse(page: ActivityPage) {
	return { events: page.events, next: page.next ? formatCursor(page.next) : null };
}
