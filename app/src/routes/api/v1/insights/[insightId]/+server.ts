import { json } from '@sveltejs/kit';
import { runSaved } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { failure, NO_STORE, secretKeyProject } from '#lib/server/query-api.js';
import { getInsight, parseSavedQuery } from '#lib/server/saved.js';
import type { RequestHandler } from './$types';

/** One saved insight with its result, computed now. */
export const GET: RequestHandler = async ({ request, params }) => {
	const project = await secretKeyProject(request);
	if (!project) return failure(401, 'invalid_secret_key');
	const row = await getInsight(getDb(), project.id, params.insightId);
	if (!row) return failure(404, 'not_found');
	const result = await runSaved(project.id, parseSavedQuery(row.kind, row.query));
	return json(
		{ id: row.id, name: row.name, ...result, updatedAt: row.updatedAt.toISOString() },
		{ headers: NO_STORE }
	);
};
