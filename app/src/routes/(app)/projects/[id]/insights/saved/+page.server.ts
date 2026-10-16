import { error, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getProjectForUser } from '#lib/server/projects.js';
import { deleteInsight, listInsights } from '#lib/server/saved.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { project } = await parent();
	const rows = await listInsights(getDb(), project.id);
	return {
		insights: rows.map(({ id, name, kind, updatedAt }) => ({ id, name, kind, updatedAt }))
	};
};

export const actions: Actions = {
	delete: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		const id = String((await request.formData()).get('insight') ?? '');
		await deleteInsight(getDb(), row.project.id, id);
	}
};
