import type { ActivityEvent } from '#lib/explore.js';
import {
	type EventStats,
	projectEventStats,
	recentEvents,
	type WebAnalytics,
	webAnalytics
} from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { listFlags } from '#lib/server/flags.js';
import { listMembers } from '#lib/server/members.js';
import { listInsights } from '#lib/server/saved.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url, depends }) => {
	// The page re-runs this while waiting for the first event and to keep the live feed fresh.
	depends('project:home');
	const { project } = await parent();
	const db = getDb();
	const [flags, insights, members] = await Promise.all([
		listFlags(db, project.id),
		listInsights(db, project.id),
		listMembers(db, project.organizationId)
	]);

	let stats: EventStats | null = null;
	let web: WebAnalytics | null = null;
	let recent: ActivityEvent[] = [];
	try {
		stats = await projectEventStats(project.id);
		if (stats.lastEventAt) {
			const [webResult, activity] = await Promise.all([
				webAnalytics(project.id, { range: '7d' }),
				recentEvents(project.id, { filters: [] }, { limit: 8 })
			]);
			web = webResult;
			recent = activity.events;
		}
	} catch (err) {
		console.error('event stats unavailable:', err);
	}
	return {
		stats,
		web,
		recent,
		host: url.origin,
		checklist: {
			flags: flags.length,
			insights: insights.length,
			members: members.length
		}
	};
};
