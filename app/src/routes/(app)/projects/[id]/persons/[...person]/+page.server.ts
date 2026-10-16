import { error, fail, redirect } from '@sveltejs/kit';
import { parseCohortId } from '#lib/cohorts.js';
import { type ActivityPage, parseCursor } from '#lib/explore.js';
import { personHref } from '#lib/persons.js';
import {
	addCohortPeople,
	deletePersonData,
	getPerson,
	type PersonDetail,
	recentEvents
} from '#lib/server/analytics.js';
import { getCohort, listCohorts } from '#lib/server/cohorts.js';
import { getDb } from '#lib/server/db/index.js';
import { canManage, getProjectForUser } from '#lib/server/projects.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params, url }) => {
	const { project } = await parent();
	if (!params.person || params.person.length > 200) error(404, 'Person not found');
	let person: PersonDetail | null;
	try {
		person = await getPerson(project.id, params.person);
	} catch (err) {
		console.error('person unavailable:', err);
		return { person: null, timeline: null, paged: false, cohorts: [] };
	}
	if (!person) error(404, 'Person not found');
	// An anonymous id that was identified shows its person's page.
	if (person.person !== params.person) redirect(307, personHref(project.id, person.person));
	const before = parseCursor(url.searchParams.get('before'));
	let timeline: ActivityPage | null = null;
	try {
		timeline = await recentEvents(
			project.id,
			{ filters: [] },
			{ before, distinctIds: person.distinctIds }
		);
	} catch (err) {
		console.error('person timeline unavailable:', err);
	}
	const cohorts = (await listCohorts(getDb(), project.id))
		.filter((cohort) => cohort.kind === 'static')
		.map(({ id, name }) => ({ id, name }));
	return { person, timeline, paged: before !== undefined, cohorts };
};

export const actions: Actions = {
	addToCohort: async ({ locals, params, request }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		const id = parseCohortId((await request.formData()).get('cohort'));
		const cohort = id ? await getCohort(getDb(), row.project.id, id) : null;
		if (cohort?.kind !== 'static') return fail(400, { message: 'Choose a static cohort.' });
		await addCohortPeople(row.project.id, cohort.id, [params.person]);
		return { message: `Added to ${cohort.name}.` };
	},

	delete: async ({ locals, params }) => {
		if (!locals.user) redirect(303, '/login');
		const row = await getProjectForUser(getDb(), locals.user.id, params.id);
		if (!row) error(404, 'Project not found');
		if (!canManage(row.role)) error(403, 'Only organization owners and admins can do this');
		const person = await getPerson(row.project.id, params.person);
		if (!person) error(404, 'Person not found');
		await deletePersonData(row.project.id, person.person, person.distinctIds);
		redirect(303, `/projects/${row.project.id}/persons?deleted=1`);
	}
};
