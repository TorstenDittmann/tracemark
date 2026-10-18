// Loading and saving for the insight editor pages, shared by every insight kind.
import { error, fail, type RequestEvent, redirect } from '@sveltejs/kit';
import { listCohorts } from './cohorts';
import { getDb } from './db/index';
import { getProjectForUser } from './projects';
import {
	addToDashboard,
	createInsight,
	getInsight,
	type InsightKind,
	listDashboards,
	parseSavedQuery,
	updateInsight,
	validateName
} from './saved';

/** The saved insight named by `?insight=`, if it is this kind and in the project, and the project's dashboards and cohorts. */
export async function loadSaved(projectId: string, url: URL, kind: InsightKind) {
	const db = getDb();
	const id = url.searchParams.get('insight');
	const insight = id ? await getInsight(db, projectId, id) : null;
	const saved = insight?.kind === kind ? insight : null;
	return {
		saved: saved ? { id: saved.id, name: saved.name } : null,
		/** The stored query, used when the URL has none. */
		storedQuery: saved ? saved.query : null,
		dashboards: (await listDashboards(db, projectId)).map(({ id, name }) => ({ id, name })),
		cohorts: (await listCohorts(db, projectId)).map(({ id, name }) => ({ id, name }))
	};
}

/** Actions don't run layout loads, so each one checks access itself. */
async function access(event: RequestEvent<{ id: string }>) {
	const { locals, params } = event;
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	return { project: row.project, user: locals.user };
}

function editorUrl(event: RequestEvent, insightId: string): string {
	return `${event.url.pathname}?insight=${encodeURIComponent(insightId)}`;
}

/** `save` creates or updates a saved insight; `addToDashboard` puts the saved one on a dashboard. */
export function insightActions(kind: InsightKind) {
	return {
		save: async (event: RequestEvent<{ id: string }>) => {
			const { project, user } = await access(event);
			const form = await event.request.formData();
			const name = String(form.get('name') ?? '').trim();
			const message = validateName(name);
			if (message) return fail(400, { action: 'save', message });
			const saved = parseSavedQuery(kind, String(form.get('query') ?? ''));
			const id = String(form.get('insight') ?? '');
			const db = getDb();
			if (id && form.get('as_new') === null) {
				if (!(await updateInsight(db, project.id, id, { name, saved }))) {
					return fail(404, { action: 'save', message: 'That insight no longer exists.' });
				}
				redirect(303, editorUrl(event, id));
			}
			const created = await createInsight(db, {
				projectId: project.id,
				name,
				saved,
				userId: user.id
			});
			redirect(303, editorUrl(event, created.id));
		},

		addToDashboard: async (event: RequestEvent<{ id: string }>) => {
			const { project } = await access(event);
			const form = await event.request.formData();
			const insight = String(form.get('insight') ?? '');
			const dashboard = String(form.get('dashboard') ?? '');
			if (!(await addToDashboard(getDb(), project.id, dashboard, insight))) {
				return fail(404, { action: 'addToDashboard', message: 'Save the insight first.' });
			}
			return { action: 'addToDashboard', message: 'Added to the dashboard.', dashboard };
		}
	};
}
