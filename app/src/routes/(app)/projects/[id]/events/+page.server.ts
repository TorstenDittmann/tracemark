import { type ActivityPage, parseActivityParam, parseCursor } from '#lib/explore.js';
import {
	type EventName,
	eventNames,
	type PropertyName,
	propertyNames,
	recentEvents
} from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const query = parseActivityParam(url.searchParams.get('q'));
	const before = parseCursor(url.searchParams.get('before'));
	let activity: ActivityPage | null = null;
	let events: EventName[] = [];
	let properties: PropertyName[] = [];
	try {
		[activity, events, properties] = await Promise.all([
			recentEvents(project.id, query, { before }),
			eventNames(project.id),
			propertyNames(project.id)
		]);
	} catch (err) {
		console.error('events unavailable:', err);
	}
	return { query, paged: before !== undefined, activity, events, properties };
};
