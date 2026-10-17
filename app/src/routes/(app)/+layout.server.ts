import { redirect } from '@sveltejs/kit';
import { hasUsers } from '#lib/server/accounts.js';
import { getDb } from '#lib/server/db/index.js';
import { listOrganizationsForUser, listProjectsForUser } from '#lib/server/projects.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
	const db = getDb();
	if (!locals.user) {
		if (!(await hasUsers(db))) redirect(303, '/setup');
		redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
	}
	const [organizations, projects] = await Promise.all([
		listOrganizationsForUser(db, locals.user.id),
		listProjectsForUser(db, locals.user.id)
	]);
	// The sidebar remembers whether it was collapsed, so the first paint matches.
	const sidebarOpen = cookies.get('sidebar_state') !== 'false';
	return { user: locals.user, organizations, projects, sidebarOpen };
};
