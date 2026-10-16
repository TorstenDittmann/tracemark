import { error } from '@sveltejs/kit';
import { type ActivityPage, parseCursor } from '#lib/explore.js';
import { type GroupDetail, getGroup, recentEvents } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params, url }) => {
	const { project } = await parent();
	const { type, key } = params;
	if (!type || !key || type.length > 200 || key.length > 200) error(404, 'Group not found');
	let group: GroupDetail | null;
	try {
		group = await getGroup(project.id, type, key);
	} catch (err) {
		console.error('group unavailable:', err);
		return { group: null, timeline: null, paged: false };
	}
	if (!group) error(404, 'Group not found');
	const before = parseCursor(url.searchParams.get('before'));
	let timeline: ActivityPage | null = null;
	try {
		timeline = await recentEvents(project.id, { filters: [] }, { before, group: { type, key } });
	} catch (err) {
		console.error('group timeline unavailable:', err);
	}
	return { group, timeline, paged: before !== undefined };
};
