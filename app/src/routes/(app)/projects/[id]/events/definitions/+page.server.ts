import type { EventDefinition } from '#lib/explore.js';
import { eventDefinitions } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { project } = await parent();
	let definitions: EventDefinition[] | null = null;
	try {
		definitions = await eventDefinitions(project.id);
	} catch (err) {
		console.error('event definitions unavailable:', err);
	}
	return { definitions };
};
