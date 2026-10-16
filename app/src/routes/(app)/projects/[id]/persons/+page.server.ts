import { type PersonPage, parsePersonCursor } from '#lib/persons.js';
import { listPersons } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const search = (url.searchParams.get('search') ?? '').trim().slice(0, 200);
	const before = parsePersonCursor(url.searchParams.get('before'));
	let people: PersonPage | null = null;
	try {
		people = await listPersons(project.id, { search: search || undefined, before });
	} catch (err) {
		console.error('people unavailable:', err);
	}
	return { search, paged: before !== undefined, people };
};
