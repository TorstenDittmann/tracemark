import { parseFunnelParam } from '#lib/insights.js';
import {
	type EventName,
	eventNames,
	type FunnelResult,
	funnel,
	type PropertyName,
	propertyNames
} from '#lib/server/analytics.js';
import { insightActions, loadSaved } from '#lib/server/insight-page.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const { saved, storedQuery, dashboards, cohorts } = await loadSaved(project.id, url, 'funnel');
	const query = parseFunnelParam(url.searchParams.get('q') ?? storedQuery);
	let result: FunnelResult | null = null;
	let events: EventName[] = [];
	let properties: PropertyName[] = [];
	try {
		[result, events, properties] = await Promise.all([
			funnel(project.id, query),
			eventNames(project.id),
			propertyNames(project.id)
		]);
	} catch (err) {
		console.error('insights unavailable:', err);
	}
	return { query, result, events, properties, saved, dashboards, cohorts };
};

export const actions: Actions = insightActions('funnel');
