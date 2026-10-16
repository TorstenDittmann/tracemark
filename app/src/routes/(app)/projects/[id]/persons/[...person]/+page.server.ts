import { error, redirect } from '@sveltejs/kit';
import { type ActivityPage, parseCursor } from '#lib/explore.js';
import { personHref } from '#lib/persons.js';
import { getPerson, type PersonDetail, recentEvents } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params, url }) => {
	const { project } = await parent();
	if (!params.person || params.person.length > 200) error(404, 'Person not found');
	let person: PersonDetail | null;
	try {
		person = await getPerson(project.id, params.person);
	} catch (err) {
		console.error('person unavailable:', err);
		return { person: null, timeline: null, paged: false };
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
	return { person, timeline, paged: before !== undefined };
};
