import { json } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { projectFlags } from '#lib/server/flags.js';
import { projectBySecretKey } from '#lib/server/projects.js';
import type { RequestHandler } from './$types';

/**
 * Every flag definition of a project, for server SDKs that evaluate locally. Needs the
 * project's secret key as a bearer token, see docs/flags-api.md.
 */
export const GET: RequestHandler = async ({ request }) => {
	const header = request.headers.get('authorization') ?? '';
	const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
	const project = key ? await projectBySecretKey(getDb(), key) : null;
	if (!project) return json({ error: 'invalid_secret_key' }, { status: 401 });
	const flags = await projectFlags(getDb(), project.id);
	return json({ flags }, { headers: { 'cache-control': 'no-store' } });
};
