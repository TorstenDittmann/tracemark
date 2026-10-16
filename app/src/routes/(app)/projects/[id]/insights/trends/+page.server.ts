import { parseTrendsParam } from '#lib/insights.js';
import {
	type EventName,
	eventNames,
	type PropertyName,
	propertyNames,
	type TrendsResult,
	trends
} from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const query = parseTrendsParam(url.searchParams.get('q'));
	let result: TrendsResult | null = null;
	let events: EventName[] = [];
	let properties: PropertyName[] = [];
	try {
		[result, events, properties] = await Promise.all([
			trends(project.id, query),
			eventNames(project.id),
			propertyNames(project.id)
		]);
	} catch (err) {
		console.error('insights unavailable:', err);
	}
	return { query, result, events, properties };
};
