import { json } from '@sveltejs/kit';
import { getPerson } from '#lib/server/analytics.js';
import { failure, NO_STORE, secretKeyProject } from '#lib/server/query-api.js';
import type { RequestHandler } from './$types';

/** The person a distinct id belongs to, with their properties and every distinct id. */
export const GET: RequestHandler = async ({ request, params }) => {
	const project = await secretKeyProject(request);
	if (!project) return failure(401, 'invalid_secret_key');
	const person = await getPerson(project.id, params.distinctId);
	if (!person) return failure(404, 'not_found');
	return json(person, { headers: NO_STORE });
};
