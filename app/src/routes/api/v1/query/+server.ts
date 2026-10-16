import { json } from '@sveltejs/kit';
import { runSaved } from '#lib/server/analytics.js';
import {
	failure,
	InvalidRequest,
	NO_STORE,
	parseQueryBody,
	readJson,
	secretKeyProject
} from '#lib/server/query-api.js';
import type { RequestHandler } from './$types';

/** Runs a trends, funnel or retention query, see docs/query-api.md. */
export const POST: RequestHandler = async ({ request }) => {
	const project = await secretKeyProject(request);
	if (!project) return failure(401, 'invalid_secret_key');
	let saved: ReturnType<typeof parseQueryBody>;
	try {
		saved = parseQueryBody(await readJson(request));
	} catch (err) {
		if (err instanceof InvalidRequest) return failure(400, 'invalid_request', err.message);
		throw err;
	}
	return json(await runSaved(project.id, saved), { headers: NO_STORE });
};
