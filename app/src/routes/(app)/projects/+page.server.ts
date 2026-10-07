import { fail, redirect } from '@sveltejs/kit';
import { getDb } from '#lib/server/db/index.js';
import { createProject, getMembership, validateProjectName } from '#lib/server/projects.js';
import type { Actions } from './$types';

export const actions: Actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) redirect(303, '/login');
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const organizationId = String(form.get('organization') ?? '');

		const error = validateProjectName(name);
		if (error) return fail(400, { name, error });

		const db = getDb();
		if (!(await getMembership(db, locals.user.id, organizationId))) {
			return fail(403, { name, error: 'You are not a member of that organization.' });
		}
		const project = await createProject(db, organizationId, name);
		redirect(303, `/projects/${project.id}`);
	}
};
