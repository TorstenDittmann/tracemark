import { error, fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { getProjectForUser } from '#lib/server/projects.js';
import { createDashboard, listDashboards, validateName } from '#lib/server/saved.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { project } = await parent();
	return { dashboards: await listDashboards(getDb(), project.id) };
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		const name = String((await request.formData()).get('name') ?? '').trim();
		const message = validateName(name);
		if (message) return fail(400, { name, message });
		const dashboard = await createDashboard(getDb(), row.project.id, name);
		redirect(303, `/projects/${row.project.id}/dashboards/${dashboard.id}`);
	}
};
