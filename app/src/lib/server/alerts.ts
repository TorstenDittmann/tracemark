// Alert rules, webhook destinations and the delivery log in libSQL (see docs/alerts.md).
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
	ALERT_FORMATS,
	ALERT_KINDS,
	ALERT_WINDOWS,
	type AlertFormat,
	type AlertRuleSpec,
	type AlertWindow,
	COOLDOWNS,
	MAX_NAME
} from '../alerts';
import { type AlertMessage, deliver } from './alert-delivery';
import type { Db } from './db/client';
import {
	type AlertDestination,
	type AlertRule,
	alertDeliveries,
	alertDestinations,
	alertRuleDestinations,
	alertRules
} from './db/schema';

/** Deliveries kept per project. */
export const KEEP_DELIVERIES = 50;
const MAX_URL = 2000;
const MAX_SECRET = 200;
const MAX_EVENT = 200;

export interface DestinationInput {
	name: string;
	url: string;
	format: AlertFormat;
	/** Null removes the secret; undefined keeps the current one. */
	secret?: string | null;
}

export interface RuleInput {
	name: string;
	spec: AlertRuleSpec;
	destinationIds: string[];
	enabled: boolean;
	notifyResolved: boolean;
	cooldownMinutes: number;
}

const text = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

function validateName(name: string): string | null {
	if (!name) return 'Enter a name.';
	if (name.length > MAX_NAME) return `Use at most ${MAX_NAME} characters.`;
	return null;
}

/** An http or https URL; anything else is an error message. */
export function validateWebhookUrl(value: string): string | null {
	if (!value) return 'Enter the webhook URL.';
	if (value.length > MAX_URL) return 'That URL is too long.';
	try {
		const url = new URL(value);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'Use an http or https URL.';
	} catch {
		return 'Enter a full URL, starting with https://.';
	}
	return null;
}

/** A destination from the dialog's form, or why it can't be saved. */
export function parseDestinationForm(form: FormData): DestinationInput | string {
	const name = text(form, 'name');
	const url = text(form, 'url');
	const format = text(form, 'format');
	const secret = text(form, 'secret');
	const problem = validateName(name) ?? validateWebhookUrl(url);
	if (problem) return problem;
	if (!Object.hasOwn(ALERT_FORMATS, format)) return 'Choose a format.';
	if (secret.length > MAX_SECRET) return `Keep the secret under ${MAX_SECRET} characters.`;
	return {
		name,
		url,
		format: format as AlertFormat,
		secret: form.get('removeSecret') ? null : secret || undefined
	};
}

function parseWindow(value: string): AlertWindow | null {
	return Object.hasOwn(ALERT_WINDOWS, value) ? (value as AlertWindow) : null;
}

function parseThreshold(value: string): number | null {
	const n = Number(value);
	return value && Number.isFinite(n) && n >= 0 ? n : null;
}

/** A rule from the dialog's form, or why it can't be saved. */
export function parseRuleForm(form: FormData): RuleInput | string {
	const name = text(form, 'name');
	const kind = text(form, 'kind');
	const problem = validateName(name);
	if (problem) return problem;
	if (!Object.hasOwn(ALERT_KINDS, kind)) return 'Choose what to alert on.';
	let spec: AlertRuleSpec;
	if (kind === 'issue') {
		const newIssues = form.get('newIssues') === 'on';
		const regressions = form.get('regressions') === 'on';
		if (!newIssues && !regressions) return 'Pick new issues, regressions or both.';
		spec = { kind, config: { newIssues, regressions } };
	} else {
		const window = parseWindow(text(form, 'window'));
		if (!window) return 'Choose a time window.';
		const threshold = parseThreshold(text(form, 'threshold'));
		if (threshold === null) return 'Enter a threshold of zero or more.';
		if (kind === 'metric') {
			const event = text(form, 'event');
			if (event.length > MAX_EVENT) return 'That event name is too long.';
			const comparison = text(form, 'comparison') === 'below' ? 'below' : 'above';
			spec = { kind, config: { event, window, comparison, threshold } };
		} else {
			spec = { kind: 'ai_cost', config: { window, threshold } };
		}
	}
	const destinationIds = [...new Set(form.getAll('destination').map(String))];
	if (!destinationIds.length) return 'Choose at least one destination.';
	const cooldown = Number(text(form, 'cooldown'));
	return {
		name,
		spec,
		destinationIds,
		enabled: form.get('enabled') === 'on',
		notifyResolved: form.get('notifyResolved') === 'on',
		cooldownMinutes: COOLDOWNS.includes(cooldown) ? cooldown : 60
	};
}

/** A stored rule's kind and settings, with defaults for anything missing. */
export function ruleSpec(rule: Pick<AlertRule, 'kind' | 'config'>): AlertRuleSpec {
	let raw: Record<string, unknown> = {};
	try {
		raw = JSON.parse(rule.config) ?? {};
	} catch {}
	const window = parseWindow(String(raw.window ?? '')) ?? '1h';
	const threshold = Number(raw.threshold) || 0;
	switch (rule.kind) {
		case 'issue':
			return {
				kind: 'issue',
				config: { newIssues: raw.newIssues !== false, regressions: raw.regressions !== false }
			};
		case 'metric':
			return {
				kind: 'metric',
				config: {
					event: typeof raw.event === 'string' ? raw.event : '',
					window,
					comparison: raw.comparison === 'below' ? 'below' : 'above',
					threshold
				}
			};
		case 'ai_cost':
			return { kind: 'ai_cost', config: { window, threshold } };
	}
}

/** Destinations without their secrets, which never leave the server. */
export async function listDestinations(db: Db, projectId: string) {
	const rows = await db
		.select()
		.from(alertDestinations)
		.where(eq(alertDestinations.projectId, projectId))
		.orderBy(alertDestinations.name);
	return rows.map(({ secret, ...row }) => ({ ...row, hasSecret: Boolean(secret) }));
}

export async function getDestination(
	db: Db,
	projectId: string,
	id: string
): Promise<AlertDestination | null> {
	const [row] = await db
		.select()
		.from(alertDestinations)
		.where(and(eq(alertDestinations.projectId, projectId), eq(alertDestinations.id, id)));
	return row ?? null;
}

export async function createDestination(db: Db, projectId: string, input: DestinationInput) {
	const [row] = await db
		.insert(alertDestinations)
		.values({ projectId, ...input, secret: input.secret ?? null })
		.returning();
	return row;
}

/** False when the destination isn't in the project. */
export async function updateDestination(
	db: Db,
	projectId: string,
	id: string,
	input: DestinationInput
): Promise<boolean> {
	const rows = await db
		.update(alertDestinations)
		.set(input)
		.where(and(eq(alertDestinations.projectId, projectId), eq(alertDestinations.id, id)))
		.returning({ id: alertDestinations.id });
	return rows.length > 0;
}

export async function deleteDestination(db: Db, projectId: string, id: string) {
	await db
		.delete(alertDestinations)
		.where(and(eq(alertDestinations.projectId, projectId), eq(alertDestinations.id, id)));
}

/** Rules with the ids of their destinations, by name. */
export async function listRules(db: Db, projectId: string) {
	const rules = await db
		.select()
		.from(alertRules)
		.where(eq(alertRules.projectId, projectId))
		.orderBy(alertRules.name);
	const links = rules.length
		? await db
				.select()
				.from(alertRuleDestinations)
				.where(
					inArray(
						alertRuleDestinations.ruleId,
						rules.map((r) => r.id)
					)
				)
		: [];
	return rules.map((rule) => ({
		...rule,
		destinationIds: links.filter((l) => l.ruleId === rule.id).map((l) => l.destinationId)
	}));
}

/** Keeps the destinations that belong to the project. */
async function ownDestinations(db: Db, projectId: string, ids: string[]): Promise<string[]> {
	if (!ids.length) return [];
	const rows = await db
		.select({ id: alertDestinations.id })
		.from(alertDestinations)
		.where(and(eq(alertDestinations.projectId, projectId), inArray(alertDestinations.id, ids)));
	return rows.map((r) => r.id);
}

async function linkDestinations(db: Db, projectId: string, ruleId: string, ids: string[]) {
	const own = await ownDestinations(db, projectId, ids);
	await db.delete(alertRuleDestinations).where(eq(alertRuleDestinations.ruleId, ruleId));
	if (own.length) {
		await db
			.insert(alertRuleDestinations)
			.values(own.map((destinationId) => ({ ruleId, destinationId })));
	}
}

/** Columns that start a rule over: nothing firing, and issue checks from `now`. */
const freshState = (now: Date) => ({
	state: 'ok' as const,
	stateNotified: false,
	lastValue: null,
	lastError: null,
	checkedUntil: now
});

function ruleColumns(input: RuleInput) {
	return {
		name: input.name,
		kind: input.spec.kind,
		config: JSON.stringify(input.spec.config),
		enabled: input.enabled,
		notifyResolved: input.notifyResolved,
		cooldownMinutes: input.cooldownMinutes
	};
}

export async function createRule(
	db: Db,
	projectId: string,
	input: RuleInput,
	userId: string | null,
	now = new Date()
) {
	const [rule] = await db
		.insert(alertRules)
		.values({ projectId, ...ruleColumns(input), ...freshState(now), createdBy: userId })
		.returning();
	if (!rule) throw new Error('failed to create alert rule');
	await linkDestinations(db, projectId, rule.id, input.destinationIds);
	return rule;
}

/** Saving a rule starts it over, so a changed condition fires again. False when it isn't in the project. */
export async function updateRule(
	db: Db,
	projectId: string,
	id: string,
	input: RuleInput,
	now = new Date()
): Promise<boolean> {
	const rows = await db
		.update(alertRules)
		.set({ ...ruleColumns(input), ...freshState(now) })
		.where(and(eq(alertRules.projectId, projectId), eq(alertRules.id, id)))
		.returning({ id: alertRules.id });
	if (!rows.length) return false;
	await linkDestinations(db, projectId, id, input.destinationIds);
	return true;
}

export async function setRuleEnabled(
	db: Db,
	projectId: string,
	id: string,
	enabled: boolean,
	now = new Date()
) {
	await db
		.update(alertRules)
		.set({ enabled, ...freshState(now) })
		.where(and(eq(alertRules.projectId, projectId), eq(alertRules.id, id)));
}

export async function deleteRule(db: Db, projectId: string, id: string) {
	await db
		.delete(alertRules)
		.where(and(eq(alertRules.projectId, projectId), eq(alertRules.id, id)));
}

/** Deliveries recorded in the same millisecond keep their insertion order. */
const NEWEST_FIRST = [desc(alertDeliveries.createdAt), desc(sql`rowid`)];

export async function listDeliveries(db: Db, projectId: string, limit = 20) {
	return db
		.select()
		.from(alertDeliveries)
		.where(eq(alertDeliveries.projectId, projectId))
		.orderBy(...NEWEST_FIRST)
		.limit(limit);
}

/**
 * Sends a message to each destination, records how each delivery went on the destination and in
 * the log, and returns whether any of them arrived.
 */
export async function sendAlert(
	db: Db,
	destinations: AlertDestination[],
	message: AlertMessage,
	options: { ruleId?: string; fetch?: typeof fetch; timeoutMs?: number } = {}
): Promise<boolean> {
	const results = await Promise.all(
		destinations.map((destination) => deliver(destination, message, options))
	);
	const at = new Date();
	for (const [i, destination] of destinations.entries()) {
		const result = results[i];
		await db
			.update(alertDestinations)
			.set({
				lastStatus: result.ok ? 'ok' : 'error',
				lastError: result.error ?? null,
				lastDeliveredAt: at
			})
			.where(eq(alertDestinations.id, destination.id));
		await db.insert(alertDeliveries).values({
			projectId: destination.projectId,
			destinationId: destination.id,
			destinationName: destination.name,
			ruleId: options.ruleId ?? null,
			title: message.title.slice(0, 300),
			ok: result.ok,
			statusCode: result.statusCode ?? null,
			error: result.error ?? null,
			createdAt: at
		});
	}
	for (const projectId of new Set(destinations.map((d) => d.projectId))) {
		await pruneDeliveries(db, projectId);
	}
	return results.some((r) => r.ok);
}

async function pruneDeliveries(db: Db, projectId: string) {
	const keep = db
		.select({ id: alertDeliveries.id })
		.from(alertDeliveries)
		.where(eq(alertDeliveries.projectId, projectId))
		.orderBy(...NEWEST_FIRST)
		.limit(KEEP_DELIVERIES);
	await db
		.delete(alertDeliveries)
		.where(and(eq(alertDeliveries.projectId, projectId), notInArray(alertDeliveries.id, keep)));
}
