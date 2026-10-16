import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { failure, NO_STORE, secretKeyProject } from '#lib/server/query-api.js';
import { listInsights, parseSavedQuery } from '#lib/server/saved.js';
import type { RequestHandler } from './$types';

/** The project's saved insights, most recently changed first, without results. */
export const GET: RequestHandler = async ({ request }) => {
	const project = await secretKeyProject(request);
	if (!project) return failure(401, 'invalid_secret_key');
	const rows = await listInsights(getDb(), project.id);
	const insights = rows.map((row) => ({
		id: row.id,
		name: row.name,
		...parseSavedQuery(row.kind, row.query),
		updatedAt: row.updatedAt.toISOString()
	}));
	return json({ insights }, { headers: NO_STORE });
};
