import { error, fail, redirect } from '@sveltejs/kit';
import {
	internalRuleKey,
	MAX_INTERNAL_RULES,
	parseInternalRule,
	parseInternalRulesJson
} from '#lib/internal-users.js';
import { parseRetention, retentionLabel } from '#lib/retention.js';
import {
	deleteModelPrice,
	modelPrices,
	parsePriceForm,
	setModelPrice
} from '#lib/server/ai-prices.js';
import { addMockData, deleteProjectEvents, removeMockData } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { setRetention } from '#lib/server/privacy.js';
import {
	canManage,
	deleteProject,
	getProjectForUser,
	renameProject,
	rotatePublicKey,
	rotateSecretKey,
	setFilterInternal,
	setInternalRules,
	validateProjectName
} from '#lib/server/projects.js';
import {
	deleteProjectSourcemaps,
	deleteSourcemapRelease,
	sourcemapReleases
} from '#lib/server/sourcemaps.js';
import { sourcemapsDir } from '#lib/server/sourcemaps-dir.js';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	return {
		secretKey: canManage(row.role) ? row.project.secretKey : null,
		sourcemaps: await sourcemapReleases(getDb(), row.project.id),
		modelPrices: await modelPrices(getDb(), row.project.id),
		internalRules: parseInternalRulesJson(row.project.internalUsers).map((rule) => ({
			...rule,
			key: internalRuleKey(rule)
		}))
	};
};

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

	rotateSecret: async (event) => {
		const project = await access(event, true);
		await rotateSecretKey(getDb(), project.id);
		return {
			action: 'rotateSecret',
			message: 'New secret key created. Update your server SDK setup.'
		};
	},

	setRetention: async (event) => {
		const project = await access(event, true);
		const days = parseRetention((await event.request.formData()).get('retention'));
		if (days === undefined)
			return fail(400, { action: 'setRetention', message: 'Choose a period.' });
		await setRetention(getDb(), project.id, days);
		return {
			action: 'setRetention',
			message:
				days === null
					? 'Events are kept forever.'
					: `Events older than ${retentionLabel(days).toLowerCase()} are deleted within a few hours.`
		};
	},

	addInternalRule: async (event) => {
		const project = await access(event, true);
		const form = await event.request.formData();
		const rule = parseInternalRule({
			kind: form.get('kind'),
			property: form.get('property'),
			value: form.get('value')
		});
		if (typeof rule === 'string') return fail(400, { action: 'internalUsers', message: rule });
		const rules = parseInternalRulesJson(project.internalUsers);
		if (rules.some((r) => internalRuleKey(r) === internalRuleKey(rule))) {
			return fail(400, { action: 'internalUsers', message: 'That rule is already there.' });
		}
		if (rules.length >= MAX_INTERNAL_RULES) {
			return fail(400, {
				action: 'internalUsers',
				message: `Use at most ${MAX_INTERNAL_RULES} rules.`
			});
		}
		await setInternalRules(getDb(), project.id, [...rules, rule]);
		return { action: 'internalUsers', message: 'Added the rule.' };
	},

	removeInternalRule: async (event) => {
		const project = await access(event, true);
		const key = String((await event.request.formData()).get('key') ?? '');
		const rules = parseInternalRulesJson(project.internalUsers);
		await setInternalRules(
			getDb(),
			project.id,
			rules.filter((rule) => internalRuleKey(rule) !== key)
		);
		return { action: 'internalUsers', message: 'Removed the rule.' };
	},

	setFilterInternal: async (event) => {
		const project = await access(event, true);
		const filter = (await event.request.formData()).get('filter') !== null;
		await setFilterInternal(getDb(), project.id, filter);
		return {
			action: 'internalUsers',
			message: filter
				? 'Internal users are left out of analytics.'
				: 'Internal users are included in analytics.'
		};
	},

	deleteSourcemaps: async (event) => {
		const project = await access(event, true);
		const release = String((await event.request.formData()).get('release') ?? '');
		const count = await deleteSourcemapRelease(getDb(), sourcemapsDir(), project.id, release);
		return {
			action: 'deleteSourcemaps',
			message: `Deleted ${count} source ${count === 1 ? 'map' : 'maps'}.`
		};
	},

	setModelPrice: async (event) => {
		const project = await access(event, true);
		const price = parsePriceForm(await event.request.formData());
		if (typeof price === 'string') return fail(400, { action: 'setModelPrice', message: price });
		await setModelPrice(getDb(), project.id, price);
		return { action: 'setModelPrice', message: `Saved the price of ${price.model}.` };
	},

	deleteModelPrice: async (event) => {
		const project = await access(event, true);
		const model = String((await event.request.formData()).get('model') ?? '');
		await deleteModelPrice(getDb(), project.id, model);
		return { action: 'deleteModelPrice', message: `Removed your price for ${model}.` };
	},

	addMockData: async (event) => {
		const project = await access(event, false);
		const user = event.locals.user;
		if (!user) redirect(303, '/login');
		try {
			const count = await addMockData(project.id, user.id);
			return {
				action: 'addMockData',
				message: `Added ${count.toLocaleString('en')} mock events and their flags, experiment, cohorts and insights.`
			};
		} catch (err) {
			console.error('could not add mock data:', err);
			return fail(500, {
				action: 'addMockData',
				message: 'Could not add mock data. Is ClickHouse running?'
			});
		}
	},

	removeMockData: async (event) => {
		const project = await access(event, false);
		try {
			await removeMockData(project.id);
			return { action: 'removeMockData', message: 'Removed the mock data.' };
		} catch (err) {
			console.error('could not remove mock data:', err);
			return fail(500, {
				action: 'removeMockData',
				message: 'Could not remove mock data. Is ClickHouse running?'
			});
		}
	},

	delete: async (event) => {
		const project = await access(event, true);
		const confirm = String((await event.request.formData()).get('confirm') ?? '');
		if (confirm !== project.name) {
			return fail(400, { action: 'delete', message: 'Type the project name to confirm.' });
		}
		await deleteProject(getDb(), project.id);
		await deleteProjectSourcemaps(sourcemapsDir(), project.id).catch((err) =>
			console.error(`could not delete source maps of project ${project.id}:`, err)
		);
		try {
			await deleteProjectEvents(project.id);
		} catch (err) {
			// The project and its key are gone, so no new events arrive; old rows stay until removed by hand.
			console.error(`could not delete events of project ${project.id}:`, err);
		}
		redirect(303, '/projects');
	}
};
