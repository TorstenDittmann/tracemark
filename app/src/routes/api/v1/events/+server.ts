import { json } from '@sveltejs/kit';
import { parseActivity, parseCursor } from '#lib/explore.js';
import { recentEvents } from '#lib/server/analytics.js';
import {
	eventsResponse,
	failure,
	MAX_EVENTS_PAGE,
	NO_STORE,
	parseLimit,
	secretKeyProject
} from '#lib/server/query-api.js';
import type { RequestHandler } from './$types';

/**
 * The newest events, newest first: `?event=` narrows to one name, `?filters=` takes property
 * filters as JSON, `?before=` continues from a page's `next`.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	const project = await secretKeyProject(request);
	if (!project) return failure(401, 'invalid_secret_key');
	let filters: unknown = [];
	const raw = url.searchParams.get('filters');
	if (raw) {
		try {
			filters = JSON.parse(raw);
		} catch {
			return failure(400, 'invalid_request', 'filters must be a JSON array.');
		}
	}
	const query = parseActivity({ event: url.searchParams.get('event') ?? undefined, filters });
	const page = await recentEvents(project.id, query, {
		before: parseCursor(url.searchParams.get('before')),
		limit: parseLimit(url.searchParams.get('limit'), MAX_EVENTS_PAGE)
	});
	return json(eventsResponse(page), { headers: NO_STORE });
};
