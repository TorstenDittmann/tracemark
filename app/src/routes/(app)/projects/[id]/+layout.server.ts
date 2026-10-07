import { error, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getProjectForUser } from '#lib/server/projects.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	return { project: row.project, role: row.role };
};
