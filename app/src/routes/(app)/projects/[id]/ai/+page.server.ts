import { type AiOverview, aiOverview } from '#lib/server/analytics.js';
import { parseRange } from '#lib/web.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const range = parseRange(url.searchParams.get('range'));
	let overview: AiOverview | null = null;
	try {
		overview = await aiOverview(project.id, { range });
	} catch (err) {
		console.error('AI overview unavailable:', err);
	}
	return { range, overview };
};
