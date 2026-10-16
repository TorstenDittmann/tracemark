import { type GroupPage, type GroupTypeSummary, parseGroupCursor } from '#lib/groups.js';
import { groupTypes, listGroups } from '#lib/server/analytics.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const search = (url.searchParams.get('search') ?? '').trim().slice(0, 200);
	const before = parseGroupCursor(url.searchParams.get('before'));
	let types: GroupTypeSummary[] | null = null;
	let type: string | null = null;
	let groups: GroupPage | null = null;
	try {
		types = await groupTypes(project.id);
		const asked = url.searchParams.get('type');
		type = types.find((t) => t.type === asked)?.type ?? types[0]?.type ?? null;
		if (type) groups = await listGroups(project.id, type, { search: search || undefined, before });
	} catch (err) {
		console.error('groups unavailable:', err);
	}
	return { types, type, search, paged: before !== undefined, groups };
};
