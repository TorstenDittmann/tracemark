import { error, fail, redirect } from '@sveltejs/kit';
import { experimentHref, MAX_NAME } from '#lib/experiments.js';
import { MAX_DESCRIPTION } from '#lib/flags.js';
import { getDb } from '#lib/server/db/index.js';
import { createExperiment, listExperiments } from '#lib/server/experiments.js';
import { flagDefinition, getFlag, listFlags } from '#lib/server/flags.js';
import { getProjectForUser } from '#lib/server/projects.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { project } = await parent();
	const db = getDb();
	const [rows, flags] = await Promise.all([
		listExperiments(db, project.id),
		listFlags(db, project.id)
	]);
	return {
		experiments: rows.map(({ experiment, flagKey }) => ({
			id: experiment.id,
			name: experiment.name,
			status: experiment.status,
			flagKey,
			startedAt: experiment.startedAt,
			endedAt: experiment.endedAt
		})),
		// Only flags with variants to compare can back an experiment.
		flags: flags
			.filter((row) => (flagDefinition(row)?.variants.length ?? 0) >= 2)
			.map((row) => ({ id: row.id, key: row.key }))
	};
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const flagId = String(form.get('flag') ?? '');
		const description = String(form.get('description') ?? '').trim();
		const values = { name, flagId, description };
		if (!name || name.length > MAX_NAME) {
			return fail(400, { ...values, message: 'Give the experiment a name under 200 characters.' });
		}
		if (description.length > MAX_DESCRIPTION) {
			return fail(400, { ...values, message: 'Keep the description under 500 characters.' });
		}
		const flag = await getFlag(getDb(), row.project.id, flagId);
		const definition = flag && flagDefinition(flag);
		if (!definition || definition.variants.length < 2) {
			return fail(400, { ...values, message: 'Pick a flag with at least two variants.' });
		}
		const experiment = await createExperiment(getDb(), {
			projectId: row.project.id,
			flagId,
			name,
			description,
			userId: locals.user.id
		});
		redirect(303, experimentHref(row.project.id, experiment.id));
	}
};
