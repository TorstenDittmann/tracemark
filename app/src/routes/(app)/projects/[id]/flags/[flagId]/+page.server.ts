import { error, fail, type RequestEvent, redirect } from '@sveltejs/kit';
import { type FlagDefinition, parseFlag } from '@tracemark/flags';
import { flagsHref, MAX_DESCRIPTION, MAX_PAYLOAD_BYTES } from '#lib/flags.js';
import { groupTypes, personPropertyNames } from '#lib/server/analytics.js';
import { listCohorts } from '#lib/server/cohorts.js';
import { getDb } from '#lib/server/db/index.js';
import {
	deleteFlag,
	flagDefinition,
	flagHistory,
	flagKeyTaken,
	getFlag,
	NEW_FLAG_RULES,
	updateFlag
} from '#lib/server/flags.js';
import { getProjectForUser } from '#lib/server/projects.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
	const { project } = await parent();
	const db = getDb();
	const row = await getFlag(db, project.id, params.flagId);
	if (!row) error(404, 'Flag not found');
	const definition = flagDefinition(row);
	const [history, cohorts, analytics] = await Promise.all([
		flagHistory(db, row.id),
		listCohorts(db, project.id),
		Promise.all([personPropertyNames(project.id), groupTypes(project.id)]).catch(
			(err): [string[], Awaited<ReturnType<typeof groupTypes>>] => {
				console.error('flag suggestions unavailable:', err);
				return [[], []];
			}
		)
	]);
	const [properties, types] = analytics;
	return {
		flag: {
			id: row.id,
			version: row.version,
			description: row.description,
			// A stored definition that no longer validates opens as a new flag would.
			definition: definition ?? { key: row.key, active: false, ...NEW_FLAG_RULES },
			invalid: definition === null
		},
		history: history.map((version) => ({
			version: version.version,
			active: version.active,
			createdAt: version.createdAt,
			changedBy: version.changedBy
		})),
		cohorts: cohorts.map((cohort) => ({ id: cohort.id, name: cohort.name })),
		properties,
		groupTypes: types.map((type) => type.type)
	};
};

/** Actions don't run layout loads, so each one checks access itself. */
async function access(event: RequestEvent<{ id: string; flagId: string }>) {
	const { locals, params } = event;
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	const flag = await getFlag(getDb(), row.project.id, params.flagId);
	if (!flag) error(404, 'Flag not found');
	return { project: row.project, flag, userId: locals.user.id };
}

async function checkFlag(projectId: string, flagId: string, flag: FlagDefinition) {
	for (const [name, payload] of Object.entries(flag.payloads)) {
		if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
			return `The payload for ${name} is over ${MAX_PAYLOAD_BYTES / 1000} KB.`;
		}
	}
	if (await flagKeyTaken(getDb(), projectId, flag.key, flagId)) {
		return `A flag called ${flag.key} already exists.`;
	}
	const cohorts = new Set((await listCohorts(getDb(), projectId)).map((c) => c.id));
	for (const condition of flag.conditions) {
		for (const filter of condition.filters) {
			if (filter.type === 'cohort' && !cohorts.has(filter.cohort)) {
				return 'A condition uses a cohort that no longer exists.';
			}
		}
	}
	return null;
}

const CONFLICT = 'Someone else changed this flag. Reload to see their changes.';

export const actions: Actions = {
	save: async (event) => {
		const { project, flag: row, userId } = await access(event);
		const form = await event.request.formData();
		const description = String(form.get('description') ?? '').trim();
		if (description.length > MAX_DESCRIPTION) {
			return fail(400, { action: 'save', message: 'Keep the description under 500 characters.' });
		}
		if (Number(form.get('version')) !== row.version) {
			return fail(409, { action: 'save', message: CONFLICT });
		}
		let flag: FlagDefinition;
		try {
			flag = parseFlag(JSON.parse(String(form.get('flag') ?? '')));
		} catch (err) {
			return fail(400, {
				action: 'save',
				message: err instanceof Error ? err.message : 'The flag is not valid.'
			});
		}
		const message = await checkFlag(project.id, row.id, flag);
		if (message) return fail(400, { action: 'save', message });
		const saved = await updateFlag(getDb(), row, { flag, description, userId });
		if (!saved) return fail(409, { action: 'save', message: CONFLICT });
		return { action: 'save', ok: true, message: 'Saved.' };
	},

	toggle: async (event) => {
		const { flag: row, userId } = await access(event);
		const flag = flagDefinition(row);
		if (!flag)
			return fail(400, { action: 'toggle', message: 'Fix the flag before turning it on.' });
		const saved = await updateFlag(getDb(), row, {
			flag: { ...flag, active: !flag.active },
			description: row.description,
			userId
		});
		if (!saved) return fail(409, { action: 'toggle', message: CONFLICT });
		return { action: 'toggle', ok: true, message: saved.active ? 'Turned on.' : 'Turned off.' };
	},

	delete: async (event) => {
		const { project, flag } = await access(event);
		await deleteFlag(getDb(), project.id, flag.id);
		redirect(303, flagsHref(project.id));
	}
};
