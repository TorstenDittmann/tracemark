import { error, fail, redirect } from '@sveltejs/kit';
import { alertsHref } from '#lib/alerts.js';
import {
	createDestination,
	createRule,
	deleteDestination,
	deleteRule,
	getDestination,
	listDeliveries,
	listDestinations,
	listRules,
	parseDestinationForm,
	parseRuleForm,
	ruleSpec,
	sendAlert,
	setRuleEnabled,
	updateDestination,
	updateRule
} from '#lib/server/alerts.js';
import { eventNames } from '#lib/server/analytics.js';
import { getDb } from '#lib/server/db/index.js';
import { canManage, getProjectForUser } from '#lib/server/projects.js';
import { PUBLIC_URL } from '$app/env/private';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { project } = await parent();
	const db = getDb();
	const [rules, destinations, deliveries, events] = await Promise.all([
		listRules(db, project.id),
		listDestinations(db, project.id),
		listDeliveries(db, project.id),
		eventNames(project.id).catch(() => [])
	]);
	return {
		rules: rules.map((rule) => ({
			id: rule.id,
			name: rule.name,
			spec: ruleSpec(rule),
			destinationIds: rule.destinationIds,
			enabled: rule.enabled,
			notifyResolved: rule.notifyResolved,
			cooldownMinutes: rule.cooldownMinutes,
			state: rule.state,
			lastValue: rule.lastValue,
			lastCheckedAt: rule.lastCheckedAt,
			lastFiredAt: rule.lastFiredAt,
			lastError: rule.lastError
		})),
		destinations,
		deliveries,
		eventNames: events.map((e) => e.event)
	};
};

/** Actions don't run layout loads, so each one checks access itself. Only managers change alerts. */
async function access({ locals, params }: RequestEvent) {
	if (!locals.user) redirect(303, '/login');
	const row = await getProjectForUser(getDb(), locals.user.id, params.id);
	if (!row) error(404, 'Project not found');
	if (!canManage(row.role)) error(403, 'Only organization owners and admins can change alerts');
	return { project: row.project, user: locals.user };
}

const id = (form: FormData) => String(form.get('id') ?? '');

export const actions: Actions = {
	saveDestination: async (event) => {
		const { project } = await access(event);
		const form = await event.request.formData();
		const input = parseDestinationForm(form);
		if (typeof input === 'string') return fail(400, { action: 'saveDestination', message: input });
		const existing = id(form);
		if (existing) {
			if (!(await updateDestination(getDb(), project.id, existing, input))) {
				return fail(404, { action: 'saveDestination', message: 'That destination is gone.' });
			}
		} else {
			await createDestination(getDb(), project.id, input);
		}
		return { action: 'saveDestination', message: `Saved ${input.name}.` };
	},

	deleteDestination: async (event) => {
		const { project } = await access(event);
		await deleteDestination(getDb(), project.id, id(await event.request.formData()));
		return { action: 'deleteDestination', message: 'Deleted the destination.' };
	},

	testDestination: async (event) => {
		const { project, user } = await access(event);
		const destination = await getDestination(
			getDb(),
			project.id,
			id(await event.request.formData())
		);
		if (!destination) {
			return fail(404, { action: 'testDestination', message: 'That destination is gone.' });
		}
		const base = (PUBLIC_URL || event.url.origin).replace(/\/+$/, '');
		const ok = await sendAlert(getDb(), [destination], {
			status: 'test',
			title: `Test alert from ${project.name}`,
			lines: [`${user.name} sent this to check that ${destination.name} receives alerts.`],
			url: `${base}${alertsHref(project.id)}`,
			project: { id: project.id, name: project.name },
			timestamp: new Date()
		});
		const saved = await getDestination(getDb(), project.id, destination.id);
		return ok
			? { action: 'testDestination', message: `Sent a test to ${destination.name}.` }
			: fail(502, {
					action: 'testDestination',
					message: `${destination.name} didn't take it: ${saved?.lastError ?? 'unknown error'}`
				});
	},

	saveRule: async (event) => {
		const { project, user } = await access(event);
		const form = await event.request.formData();
		const input = parseRuleForm(form);
		if (typeof input === 'string') return fail(400, { action: 'saveRule', message: input });
		const existing = id(form);
		if (existing) {
			if (!(await updateRule(getDb(), project.id, existing, input))) {
				return fail(404, { action: 'saveRule', message: 'That rule is gone.' });
			}
		} else {
			await createRule(getDb(), project.id, input, user.id);
		}
		return { action: 'saveRule', message: `Saved ${input.name}.` };
	},

	toggleRule: async (event) => {
		const { project } = await access(event);
		const form = await event.request.formData();
		const enabled = form.get('enabled') === 'true';
		await setRuleEnabled(getDb(), project.id, id(form), enabled);
		return { action: 'toggleRule', message: enabled ? 'Rule resumed.' : 'Rule paused.' };
	},

	deleteRule: async (event) => {
		const { project } = await access(event);
		await deleteRule(getDb(), project.id, id(await event.request.formData()));
		return { action: 'deleteRule', message: 'Deleted the rule.' };
	}
};
