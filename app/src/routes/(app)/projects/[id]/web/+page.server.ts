import { type WebAnalytics, webAnalytics } from '#lib/server/analytics.js';
import { parseFilters, parseRange } from '#lib/web.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const range = parseRange(url.searchParams.get('range'));
	const filters = parseFilters(url.searchParams);
	let web: WebAnalytics | null = null;
	try {
		web = await webAnalytics(project.id, { range, filters });
	} catch (err) {
		console.error('web analytics unavailable:', err);
	}
	return { web, range, filters };
};
