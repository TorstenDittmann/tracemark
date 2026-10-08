import { error, fail, redirect } from '@sveltejs/kit';
import { deleteProjectEvents } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import {
	canManage,
	deleteProject,
	getProjectForUser,
	renameProject,
	rotatePublicKey,
	validateProjectName
} from '#lib/server/projects.js';
import type { Actions, RequestEvent } from './$types';

/** Actions don't run layout loads, so each one checks access itself. */
async function access({ locals, params }: RequestEvent, managersOnly: boolean) {
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	if (managersOnly && !canManage(row.role))
		error(403, 'Only organization owners and admins can do this');
	return row.project;
}

export const actions: Actions = {
	rename: async (event) => {
		const project = await access(event, false);
		const name = String((await event.request.formData()).get('name') ?? '').trim();
		const message = validateProjectName(name);
		if (message) return fail(400, { action: 'rename', message });
		await renameProject(getDb(), project.id, name);
		return { action: 'rename', message: 'Saved.' };
	},

	rotate: async (event) => {
		const project = await access(event, true);
		await rotatePublicKey(getDb(), project.id);
		return { action: 'rotate', message: 'New key created. Update your SDK setup.' };
	},

	delete: async (event) => {
		const project = await access(event, true);
		const confirm = String((await event.request.formData()).get('confirm') ?? '');
		if (confirm !== project.name) {
			return fail(400, { action: 'delete', message: 'Type the project name to confirm.' });
		}
		await deleteProject(getDb(), project.id);
		try {
			await deleteProjectEvents(project.id);
		} catch (err) {
			// The project and its key are gone, so no new events arrive; old rows stay until removed by hand.
			console.error(`could not delete events of project ${project.id}:`, err);
		}
		redirect(303, '/projects');
	}
};
