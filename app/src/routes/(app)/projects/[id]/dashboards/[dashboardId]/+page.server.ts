import { error, fail, type RequestEvent, redirect } from '@sveltejs/kit';
import { runSaved, type SavedResult } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { getProjectForUser } from '#lib/server/projects.js';
import {
	dashboardItems,
	deleteDashboard,
	getDashboard,
	moveOnDashboard,
	parseSavedQuery,
	removeFromDashboard,
	renameDashboard,
	validateName
} from '#lib/server/saved.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { project } = await parent();
	const db = getDb();
	const dashboard = await getDashboard(db, project.id, params.dashboardId);
	if (!dashboard) error(404, 'Dashboard not found');
	const rows = await dashboardItems(db, dashboard.id);
	const items = await Promise.all(
		rows.map(async ({ insight }) => {
			let view: SavedResult | null = null;
			try {
				view = await runSaved(project.id, parseSavedQuery(insight.kind, insight.query));
			} catch (err) {
				console.error(`insight ${insight.id} unavailable:`, err);
			}
			return { id: insight.id, name: insight.name, kind: insight.kind, view };
		})
	);
	return { dashboard: { id: dashboard.id, name: dashboard.name }, items };
};

/** Actions don't run layout loads, so each one checks access itself. */
async function access({ locals, params }: RequestEvent<{ id: string; dashboardId: string }>) {
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	return { projectId: row.project.id, dashboardId: params.dashboardId };
}

export const actions: Actions = {
	rename: async (event) => {
		const { projectId, dashboardId } = await access(event);
		const name = String((await event.request.formData()).get('name') ?? '').trim();
		const message = validateName(name);
		if (message) return fail(400, { message });
		await renameDashboard(getDb(), projectId, dashboardId, name);
	},

	delete: async (event) => {
		const { projectId, dashboardId } = await access(event);
		await deleteDashboard(getDb(), projectId, dashboardId);
		redirect(303, `/projects/${projectId}/dashboards`);
	},

	remove: async (event) => {
		const { projectId, dashboardId } = await access(event);
		const insight = String((await event.request.formData()).get('insight') ?? '');
		await removeFromDashboard(getDb(), projectId, dashboardId, insight);
	},

	move: async (event) => {
		const { projectId, dashboardId } = await access(event);
		const form = await event.request.formData();
		const insight = String(form.get('insight') ?? '');
		const direction = form.get('direction') === 'up' ? -1 : 1;
		await moveOnDashboard(getDb(), projectId, dashboardId, insight, direction);
	}
};
