import { error, json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { projects } from '#lib/server/db/schema.js';
import { safeEqual } from '#lib/server/keys.js';
import { INTERNAL_TOKEN } from '$app/env/private';
import type { RequestHandler } from './$types';

/** Project keys for the ingest service, see docs/ingest-protocol.md. */
export const GET: RequestHandler = async ({ request }) => {
	const token = request.headers.get('x-internal-token') ?? '';
	if (!INTERNAL_TOKEN || !safeEqual(token, INTERNAL_TOKEN)) {
		error(401, 'invalid internal token');
	}

	const rows = await getDb()
		.select({ id: projects.id, public_key: projects.publicKey })
		.from(projects);
	return json({ projects: rows });
};
