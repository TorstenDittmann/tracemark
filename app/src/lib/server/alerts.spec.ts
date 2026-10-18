import { describe, expect, it } from 'vitest';
import { ruleSummary } from '../alerts';
import type { AlertMessage } from './alert-delivery';
import {
	createDestination,
	createRule,
	deleteDestination,
	getDestination,
	KEEP_DELIVERIES,
	listDeliveries,
	listDestinations,
	listRules,
	parseDestinationForm,
	parseRuleForm,
	type RuleInput,
	ruleSpec,
	sendAlert,
	updateDestination,
	updateRule,
	validateWebhookUrl
} from './alerts';
import { organizations, users } from './db/schema';
import { createProject } from './projects';
import { createTestDb } from './test-db';

async function setup() {
	const db = await createTestDb();
	const [user] = await db
		.insert(users)
		.values({ email: 'ada@example.com', name: 'Ada' })
		.returning();
	const [org] = await db.insert(organizations).values({ name: 'Acme', slug: 'acme' }).returning();
	const project = await createProject(db, org.id, 'Website');
	const other = await createProject(db, org.id, 'App');
	return { db, user, project, other };
}

const form = (values: Record<string, string | string[]>) => {
	const data = new FormData();
	for (const [name, value] of Object.entries(values)) {
		for (const v of Array.isArray(value) ? value : [value]) data.append(name, v);
	}
	return data;
};

const hook = { name: 'Ops', url: 'https://hooks.example.com/a', format: 'slack' as const };

const metricRule = (destinationIds: string[]): RuleInput => ({
	name: 'Signups dropped',
	spec: {
		kind: 'metric',
		config: { event: 'signed_up', window: '1h', comparison: 'below', threshold: 10 }
	},
	destinationIds,
	enabled: true,
	notifyResolved: true,
	cooldownMinutes: 60
});

const message: AlertMessage = {
	status: 'test',
	title: 'Test',
	lines: ['Hello'],
	project: { id: 'p', name: 'Website' },
	timestamp: new Date()
};

describe('alert forms', () => {
	it('accepts http and https webhook URLs only', () => {
		expect(validateWebhookUrl('https://hooks.slack.com/services/T/B/x')).toBeNull();
		expect(validateWebhookUrl('http://10.0.0.5:8080/hook')).toBeNull();
		expect(validateWebhookUrl('')).toBe('Enter the webhook URL.');
		expect(validateWebhookUrl('ftp://example.com')).toBe('Use an http or https URL.');
		expect(validateWebhookUrl('hooks.example.com')).toMatch(/full URL/);
	});

	it('parses a destination, keeping or removing the secret', () => {
		expect(parseDestinationForm(form({ ...hook, secret: '' }))).toEqual({
			...hook,
			secret: undefined
		});
		expect(parseDestinationForm(form({ ...hook, secret: 'abc' }))).toMatchObject({ secret: 'abc' });
		expect(parseDestinationForm(form({ ...hook, removeSecret: 'on' }))).toMatchObject({
			secret: null
		});
		expect(parseDestinationForm(form({ ...hook, format: 'teams' }))).toBe('Choose a format.');
		expect(parseDestinationForm(form({ ...hook, name: '' }))).toBe('Enter a name.');
	});

	it('parses each kind of rule', () => {
		const common = { name: 'Rule', destination: ['d1', 'd1', 'd2'], enabled: 'on', cooldown: '15' };
		expect(
			parseRuleForm(form({ ...common, kind: 'issue', newIssues: 'on', regressions: 'on' }))
		).toEqual({
			name: 'Rule',
			spec: { kind: 'issue', config: { newIssues: true, regressions: true } },
			destinationIds: ['d1', 'd2'],
			enabled: true,
			notifyResolved: false,
			cooldownMinutes: 15
		});
		expect(
			parseRuleForm(
				form({
					...common,
					kind: 'metric',
					event: 'signed_up',
					window: '1d',
					comparison: 'below',
					threshold: '5'
				})
			)
		).toMatchObject({
			spec: {
				kind: 'metric',
				config: { event: 'signed_up', window: '1d', comparison: 'below', threshold: 5 }
			}
		});
		expect(
			parseRuleForm(form({ ...common, kind: 'ai_cost', window: '1h', threshold: '2.5' }))
		).toMatchObject({ spec: { kind: 'ai_cost', config: { window: '1h', threshold: 2.5 } } });
	});

	it('rejects incomplete rules', () => {
		const common = { name: 'Rule', destination: 'd1' };
		expect(parseRuleForm(form({ ...common, kind: 'issue' }))).toMatch(/new issues, regressions/);
		expect(
			parseRuleForm(form({ ...common, kind: 'metric', window: '1h', threshold: '-1' }))
		).toMatch(/threshold/);
		expect(
			parseRuleForm(form({ ...common, kind: 'ai_cost', window: '2h', threshold: '1' }))
		).toMatch(/window/);
		expect(parseRuleForm(form({ name: 'Rule', kind: 'issue', newIssues: 'on' }))).toMatch(
			/destination/
		);
		expect(parseRuleForm(form({ ...common, kind: 'nope' }))).toMatch(/what to alert on/);
	});

	it('reads stored settings with defaults', () => {
		expect(ruleSpec({ kind: 'issue', config: 'not json' })).toEqual({
			kind: 'issue',
			config: { newIssues: true, regressions: true }
		});
		expect(
			ruleSummary(ruleSpec({ kind: 'ai_cost', config: '{"window":"1d","threshold":5}' }))
		).toBe('AI cost above $5.00 in the last day');
		expect(ruleSummary(metricRule([]).spec)).toBe(
			'Fewer than 10 signed_up events in the last hour'
		);
	});
});

describe('alert storage', () => {
	it('keeps destinations per project and never lists secrets', async () => {
		const { db, project, other } = await setup();
		const destination = await createDestination(db, project.id, { ...hook, secret: 'abc' });
		const [listed] = await listDestinations(db, project.id);
		expect(listed).toMatchObject({ name: 'Ops', hasSecret: true });
		expect(listed).not.toHaveProperty('secret');
		expect(await listDestinations(db, other.id)).toEqual([]);

		// Another project's id changes nothing.
		expect(await updateDestination(db, other.id, destination.id, { ...hook, name: 'X' })).toBe(
			false
		);
		await updateDestination(db, project.id, destination.id, { ...hook, name: 'Pager' });
		expect(await getDestination(db, project.id, destination.id)).toMatchObject({
			name: 'Pager',
			secret: 'abc'
		});
		await updateDestination(db, project.id, destination.id, { ...hook, secret: null });
		expect((await getDestination(db, project.id, destination.id))?.secret).toBeNull();
	});

	it('links rules to their project’s destinations and starts them over when saved', async () => {
		const { db, user, project, other } = await setup();
		const a = await createDestination(db, project.id, hook);
		const b = await createDestination(db, project.id, { ...hook, name: 'B' });
		const foreign = await createDestination(db, other.id, hook);
		const created = new Date('2026-10-16T12:00:00Z');
		const rule = await createRule(db, project.id, metricRule([a.id, foreign.id]), user.id, created);
		const [listed] = await listRules(db, project.id);
		expect(listed).toMatchObject({
			name: 'Signups dropped',
			kind: 'metric',
			state: 'ok',
			checkedUntil: created,
			destinationIds: [a.id]
		});

		const saved = new Date('2026-10-16T13:00:00Z');
		expect(await updateRule(db, other.id, rule.id, metricRule([b.id]))).toBe(false);
		await updateRule(db, project.id, rule.id, { ...metricRule([b.id]), name: 'Renamed' }, saved);
		expect((await listRules(db, project.id))[0]).toMatchObject({
			name: 'Renamed',
			checkedUntil: saved,
			destinationIds: [b.id]
		});

		await deleteDestination(db, project.id, b.id);
		expect((await listRules(db, project.id))[0]?.destinationIds).toEqual([]);
	});

	it('records deliveries and keeps the newest', async () => {
		const { db, project } = await setup();
		const ok = await createDestination(db, project.id, hook);
		const broken = await createDestination(db, project.id, {
			...hook,
			name: 'Broken',
			url: 'https://broken.example.com'
		});
		const fetch = (async (input: string | URL | Request) =>
			String(input).includes('broken')
				? new Response('nope', { status: 500 })
				: new Response('ok')) as typeof globalThis.fetch;
		expect(await sendAlert(db, [ok, broken], message, { fetch })).toBe(true);
		expect(await getDestination(db, project.id, ok.id)).toMatchObject({
			lastStatus: 'ok',
			lastError: null
		});
		expect(await getDestination(db, project.id, broken.id)).toMatchObject({
			lastStatus: 'error',
			lastError: 'HTTP 500: nope'
		});
		const log = await listDeliveries(db, project.id);
		expect(log.map((d) => [d.destinationName, d.ok, d.statusCode])).toEqual(
			expect.arrayContaining([
				['Ops', true, 200],
				['Broken', false, 500]
			])
		);

		for (let i = 0; i < KEEP_DELIVERIES; i += 1) {
			await sendAlert(db, [ok], { ...message, title: `Test ${i}` }, { fetch });
		}
		const kept = await listDeliveries(db, project.id, 100);
		expect(kept).toHaveLength(KEEP_DELIVERIES);
		expect(kept[0]?.title).toBe(`Test ${KEEP_DELIVERIES - 1}`);
	});
});
