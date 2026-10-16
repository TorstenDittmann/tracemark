import { error, fail, redirect } from '@sveltejs/kit';
import { COHORT_KINDS, type CohortKind, cohortHref } from '#lib/cohorts.js';
import { cohortSize } from '#lib/server/analytics.js';
import { cohortSpec, createCohort, listCohorts } from '#lib/server/cohorts.js';
import { getDb } from '#lib/server/db/index.js';
import { getProjectForUser } from '#lib/server/projects.js';
import { validateName } from '#lib/server/saved.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { project } = await parent();
	const cohorts = await listCohorts(getDb(), project.id);
	const sizes = await Promise.all(
		cohorts.map((cohort) => cohortSize(project.id, cohortSpec(cohort)).catch(() => null))
	);
	return {
		cohorts: cohorts.map((cohort, i) => ({
			id: cohort.id,
			name: cohort.name,
			kind: cohort.kind,
			size: sizes[i],
			updatedAt: cohort.updatedAt
		}))
	};
};

export const actions: Actions = {
	create: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const kind = String(form.get('kind') ?? '');
		const message = validateName(name);
		if (message) return fail(400, { name, kind, message });
		if (!Object.hasOwn(COHORT_KINDS, kind)) {
			return fail(400, { name, kind, message: 'Choose what defines the cohort.' });
		}
		const cohort = await createCohort(getDb(), {
			projectId: row.project.id,
			name,
			kind: kind as CohortKind,
			userId: locals.user.id
		});
		redirect(303, cohortHref(row.project.id, cohort.id));
	}
};
