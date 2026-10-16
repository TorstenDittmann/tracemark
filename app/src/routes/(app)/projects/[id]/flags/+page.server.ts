import { KEY } from '@footprint/flags';
import { error, fail, redirect } from '@sveltejs/kit';
import { flagHref, MAX_DESCRIPTION } from '#lib/flags.js';
import { getDb } from '#lib/server/db/index.js';
import { createFlag, flagDefinition, flagKeyTaken, listFlags } from '#lib/server/flags.js';
import { getProjectForUser } from '#lib/server/projects.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { project } = await parent();
	const rows = await listFlags(getDb(), project.id);
	return {
		flags: rows.map((row) => ({
			id: row.id,
			key: row.key,
			description: row.description,
			active: row.active,
			definition: flagDefinition(row),
			updatedAt: row.updatedAt
		}))
	};
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		const form = await request.formData();
		const key = String(form.get('key') ?? '').trim();
		const description = String(form.get('description') ?? '').trim();
		if (!KEY.test(key)) {
			return fail(400, {
				key,
				description,
				message:
					'Use letters, digits, dots, dashes and underscores, starting with a letter or digit.'
			});
		}
		if (description.length > MAX_DESCRIPTION) {
			return fail(400, { key, description, message: 'Keep the description under 500 characters.' });
		}
		if (await flagKeyTaken(getDb(), row.project.id, key)) {
			return fail(400, { key, description, message: `A flag called ${key} already exists.` });
		}
		const flag = await createFlag(getDb(), {
			projectId: row.project.id,
			key,
			description,
			userId: locals.user.id
		});
		redirect(303, flagHref(row.project.id, flag.id));
	}
};
