import { parsePathsParam } from '#lib/insights.js';
import {
	type EventName,
	eventNames,
	type PathsResult,
	type PropertyName,
	pagePaths,
	paths,
	propertyNames
} from '#lib/server/analytics.js';
import { insightActions, loadSaved } from '#lib/server/insight-page.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const { saved, storedQuery, dashboards, cohorts } = await loadSaved(project.id, url, 'paths');
	const query = parsePathsParam(url.searchParams.get('q') ?? storedQuery);
	let result: PathsResult | null = null;
	let events: EventName[] = [];
	let pages: string[] = [];
	let properties: PropertyName[] = [];
	try {
		[result, events, pages, properties] = await Promise.all([
			paths(project.id, query),
			eventNames(project.id),
			pagePaths(project.id),
			propertyNames(project.id)
		]);
	} catch (err) {
		console.error('insights unavailable:', err);
	}
	return { query, result, events, pages, properties, saved, dashboards, cohorts };
};

export const actions: Actions = insightActions('paths');
