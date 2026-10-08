import { type EventStats, projectEventStats } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	let stats: EventStats | null = null;
	try {
		stats = await projectEventStats(project.id);
	} catch (err) {
		console.error('event stats unavailable:', err);
	}
	return { stats, host: url.origin };
};
