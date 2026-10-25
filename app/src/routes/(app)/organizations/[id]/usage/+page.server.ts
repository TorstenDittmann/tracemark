import {
	type StorageUsage,
	storageUsage,
	type UsageVolume,
	usageVolume
} from '#lib/server/analytics.js';
import { canManage } from '#lib/server/projects.js';
import { parseUsageRange } from '#lib/usage.js';
import type { PageServerLoad } from './$types';

/**
 * Any member sees their organization's event volume. Storage covers the whole ClickHouse server,
 * not just this organization, so only owners and admins see it.
 */
export const load: PageServerLoad = async ({ params, parent, url }) => {
	const { role, projects } = await parent();
	const range = parseUsageRange(url.searchParams.get('range'));
	const own = projects.filter((p) => p.organizationId === params.id);
	const ids = own.map((p) => p.id);
	// Not `projects`: that's the layout's list for the sidebar.
	const names: Record<string, string> = Object.fromEntries(own.map((p) => [p.id, p.name]));
	const manager = canManage(role);
	let volume: UsageVolume | null = null;
	let storage: StorageUsage | null = null;
	try {
		[volume, storage] = await Promise.all([
			usageVolume(ids, { range }),
			manager ? storageUsage(ids) : null
		]);
	} catch (err) {
		console.error('usage unavailable:', err);
	}
	return { range, names, volume, storage, manager };
};
