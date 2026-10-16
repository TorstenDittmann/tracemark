import { error, redirect } from '@sveltejs/kit';
import { getPerson, personEvents } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { getProjectForUser } from '#lib/server/projects.js';
import type { RequestHandler } from './$types';

/** Everything stored about one person as a JSON download, for data access requests. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	const id = url.searchParams.get('person') ?? '';
	if (!id || id.length > 200) error(404, 'Person not found');
	const person = await getPerson(row.project.id, id);
	if (!person) error(404, 'Person not found');
	const { events, truncated } = await personEvents(row.project.id, person.distinctIds);
	const body = JSON.stringify(
		{
			exportedAt: new Date().toISOString(),
			project: { id: row.project.id, name: row.project.name },
			person: person.person,
			distinctIds: person.distinctIds,
			properties: person.properties,
			firstSeen: person.firstSeen,
			lastSeen: person.lastSeen,
			events,
			truncated
		},
		null,
		2
	);
	const name = `person-${person.person.replace(/[^\w.@-]+/g, '_').slice(0, 80)}.json`;
	return new Response(body, {
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'content-disposition': `attachment; filename="${name}"`,
			'cache-control': 'no-store'
		}
	});
};
