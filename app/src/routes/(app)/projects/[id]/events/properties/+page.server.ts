import type { PropertyDefinition } from '#lib/explore.js';
import { validName } from '#lib/insights.js';
import { type EventName, eventNames, propertyDefinitions } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const param = url.searchParams.get('event');
	const event = validName(param) ? param : undefined;
	let definitions: PropertyDefinition[] | null = null;
	let events: EventName[] = [];
	try {
		[definitions, events] = await Promise.all([
			propertyDefinitions(project.id, event),
			eventNames(project.id)
		]);
	} catch (err) {
		console.error('property definitions unavailable:', err);
	}
	return { event, definitions, events };
};
