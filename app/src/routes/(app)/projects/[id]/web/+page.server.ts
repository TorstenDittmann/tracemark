import {
	type WebAnalytics,
	type WebVitals,
	webAnalytics,
	webVitals
} from '#lib/server/analytics.js';
import { parseFilters, parseRange } from '#lib/web.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const range = parseRange(url.searchParams.get('range'));
	const filters = parseFilters(url.searchParams);
	let web: WebAnalytics | null = null;
	let vitals: WebVitals | null = null;
	try {
		[web, vitals] = await Promise.all([
			webAnalytics(project.id, { range, filters }),
			webVitals(project.id, { range, filters })
		]);
	} catch (err) {
		console.error('web analytics unavailable:', err);
	}
	return { web, vitals, range, filters };
};
