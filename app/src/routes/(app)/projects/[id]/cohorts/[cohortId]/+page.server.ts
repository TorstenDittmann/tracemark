import { error, fail, type RequestEvent, redirect } from '@sveltejs/kit';
import { parseIdList } from '#lib/cohorts.js';
import { parsePropertyFilters } from '#lib/insights.js';
import { type PersonPage, parsePersonCursor } from '#lib/persons.js';
import {
	addCohortPeople,
	cohortSize,
	deleteCohortPeople,
	listPersons,
	personPropertyNames,
	removeCohortPerson
} from '#lib/server/analytics.js';
import { cohortSpec, deleteCohort, getCohort, updateCohort } from '#lib/server/cohorts.js';
import { getDb } from '#lib/server/db/index.js';
import { getProjectForUser } from '#lib/server/projects.js';
import { validateName } from '#lib/server/saved.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params, url }) => {
	const { project } = await parent();
	const cohort = await getCohort(getDb(), project.id, params.cohortId);
	if (!cohort) error(404, 'Cohort not found');
	const spec = cohortSpec(cohort);
	const before = parsePersonCursor(url.searchParams.get('before'));
	let size: number | null = null;
	let people: PersonPage | null = null;
	let properties: string[] = [];
	try {
		[size, people, properties] = await Promise.all([
			cohortSize(project.id, spec),
			listPersons(project.id, { cohort: spec, before }),
			cohort.kind === 'properties' ? personPropertyNames(project.id) : []
		]);
	} catch (err) {
		console.error('cohort unavailable:', err);
	}
	return {
		cohort: { id: cohort.id, name: cohort.name, kind: cohort.kind },
		filters: spec.kind === 'properties' ? spec.filters : [],
		size,
		people,
		paged: before !== undefined,
		properties
	};
};

/** Actions don't run layout loads, so each one checks access itself. */
async function access(event: RequestEvent<{ id: string; cohortId: string }>) {
	const { locals, params } = event;
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	const cohort = await getCohort(getDb(), row.project.id, params.cohortId);
	if (!cohort) error(404, 'Cohort not found');
	return { project: row.project, cohort };
}

export const actions: Actions = {
	rename: async (event) => {
		const { project, cohort } = await access(event);
		const name = String((await event.request.formData()).get('name') ?? '').trim();
		const message = validateName(name);
		if (message) return fail(400, { action: 'rename', message });
		await updateCohort(getDb(), project.id, cohort.id, { name });
	},

	filters: async (event) => {
		const { project, cohort } = await access(event);
		if (cohort.kind !== 'properties')
			return fail(400, { action: 'filters', message: 'Not a property cohort.' });
		let raw: unknown = [];
		try {
			raw = JSON.parse(String((await event.request.formData()).get('filters') ?? '[]'));
		} catch {}
		await updateCohort(getDb(), project.id, cohort.id, {
			name: cohort.name,
			filters: parsePropertyFilters(raw)
		});
		return { action: 'filters', message: 'Filters saved.' };
	},

	add: async (event) => {
		const { project, cohort } = await access(event);
		if (cohort.kind !== 'static')
			return fail(400, { action: 'add', message: 'Not a static cohort.' });
		const ids = parseIdList(String((await event.request.formData()).get('ids') ?? ''));
		if (!ids.length) return fail(400, { action: 'add', message: 'Enter at least one id.' });
		await addCohortPeople(project.id, cohort.id, ids);
		// Bumps the cohort's updated time.
		await updateCohort(getDb(), project.id, cohort.id, { name: cohort.name });
		return { action: 'add', message: `Added ${ids.length === 1 ? '1 id' : `${ids.length} ids`}.` };
	},

	remove: async (event) => {
		const { project, cohort } = await access(event);
		const person = String((await event.request.formData()).get('person') ?? '');
		if (cohort.kind !== 'static' || !person)
			return fail(400, { action: 'remove', message: 'Nothing to remove.' });
		await removeCohortPerson(project.id, cohort.id, person);
		await updateCohort(getDb(), project.id, cohort.id, { name: cohort.name });
	},

	delete: async (event) => {
		const { project, cohort } = await access(event);
		await deleteCohortPeople(project.id, cohort.id);
		await deleteCohort(getDb(), project.id, cohort.id);
		redirect(303, `/projects/${project.id}/cohorts`);
	}
};
