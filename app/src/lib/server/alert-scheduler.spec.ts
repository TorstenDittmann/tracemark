import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AlertIssue } from './alert-checks';
import { type AlertChecks, acquireLease, checkAlerts, ISSUE_LAG_MS } from './alert-scheduler';
import { createDestination, createRule, listDeliveries, type RuleInput } from './alerts';
import { alertRules, organizations, users } from './db/schema';
import { setIssueStatus } from './issue-status';
import { createProject } from './projects';
import { createTestDb } from './test-db';

const start = new Date('2026-10-16T12:00:00Z');
const minutes = (n: number) => new Date(start.getTime() + n * 60_000);

async function setup() {
	const db = await createTestDb();
	const [user] = await db
		.insert(users)
		.values({ email: 'ada@example.com', name: 'Ada' })
		.returning();
	const [org] = await db.insert(organizations).values({ name: 'Acme', slug: 'acme' }).returning();
	const project = await createProject(db, org.id, 'Website');
	const destination = await createDestination(db, project.id, {
		name: 'Ops',
		url: 'https://hooks.example.com/a',
		format: 'json'
	});

	const values = { count: 0, cost: 0 };
	const issues = { found: [] as AlertIssue[], regressed: [] as AlertIssue[] };
	const calls: { kind: string; from: Date; to: Date; resolved?: string[] }[] = [];
	const checks: AlertChecks = {
		newIssues: async (_p, from, to) => {
			calls.push({ kind: 'new', from, to });
			return issues.found;
		},
		regressedIssues: async (_p, resolved, from, to) => {
			calls.push({ kind: 'regressed', from, to, resolved: resolved.map((r) => r.fingerprint) });
			return issues.regressed;
		},
		eventCount: async () => values.count,
		aiCost: async () => values.cost
	};
	const sent: Record<string, unknown>[] = [];
	const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
		sent.push(JSON.parse(String(init?.body)));
		return new Response('ok');
	}) as typeof globalThis.fetch;
	const run = (at: Date) =>
		checkAlerts(db, checks, { now: at, fetch, baseUrl: 'https://analytics.example.com/' });
	const rule = (input: Partial<RuleInput> & Pick<RuleInput, 'spec'>) =>
		createRule(
			db,
			project.id,
			{
				name: 'Rule',
				destinationIds: [destination.id],
				enabled: true,
				notifyResolved: false,
				cooldownMinutes: 0,
				...input
			},
			user.id,
			start
		);
	return { db, user, project, values, issues, calls, sent, run, rule };
}

const typeError = (fingerprint: string): AlertIssue => ({
	fingerprint,
	type: 'TypeError',
	value: 'x is undefined',
	occurrences: 2
});

describe('alert lease', () => {
	it('lets one holder run until its lease runs out', async () => {
		const { db } = await setup();
		expect(await acquireLease(db, 'alerts', 'a', 120_000, start)).toBe(true);
		expect(await acquireLease(db, 'alerts', 'b', 120_000, minutes(1))).toBe(false);
		// The holder renews.
		expect(await acquireLease(db, 'alerts', 'a', 120_000, minutes(1))).toBe(true);
		expect(await acquireLease(db, 'alerts', 'b', 120_000, minutes(2))).toBe(false);
		// a stopped renewing at minute 1; b takes over after minute 3.
		expect(await acquireLease(db, 'alerts', 'b', 120_000, minutes(3.5))).toBe(true);
		expect(await acquireLease(db, 'alerts', 'a', 120_000, minutes(4))).toBe(false);
		expect(await acquireLease(db, 'other', 'a', 120_000, minutes(4))).toBe(true);
	});
});

describe('threshold rules', () => {
	it('fire once when the condition starts and once when it clears', async () => {
		const { db, values, sent, run, rule } = await setup();
		const created = await rule({
			name: 'Too many errors',
			notifyResolved: true,
			spec: {
				kind: 'metric',
				config: { event: 'checkout_failed', window: '1h', comparison: 'above', threshold: 10 }
			}
		});
		values.count = 5;
		expect(await run(minutes(1))).toBe(0);
		values.count = 11;
		expect(await run(minutes(2))).toBe(1);
		expect(await run(minutes(3))).toBe(0);
		values.count = 3;
		expect(await run(minutes(4))).toBe(1);
		expect(sent.map((body) => [body.type, body.title, body.value])).toEqual([
			['alert.firing', 'Too many errors in Website', 11],
			['alert.resolved', 'Resolved: Too many errors in Website', 3]
		]);
		expect(sent[0]?.text).toBe(
			'Now 11 checkout_failed events in the last hour\nRule: More than 10 checkout_failed events in the last hour'
		);
		expect(sent[0]?.url).toBe(`https://analytics.example.com/projects/${created.projectId}/alerts`);
		const [stored] = await db.select().from(alertRules).where(eq(alertRules.id, created.id));
		expect(stored).toMatchObject({
			state: 'ok',
			lastValue: 3,
			lastFiredAt: minutes(2),
			lastCheckedAt: minutes(4)
		});
	});

	it('stay quiet during the cooldown, and about clearing a firing that was not sent', async () => {
		const { values, sent, run, rule } = await setup();
		await rule({
			notifyResolved: true,
			cooldownMinutes: 60,
			spec: { kind: 'ai_cost', config: { window: '1d', threshold: 5 } }
		});
		values.cost = 6;
		expect(await run(minutes(1))).toBe(1);
		values.cost = 4;
		expect(await run(minutes(2))).toBe(1);
		values.cost = 7;
		expect(await run(minutes(3))).toBe(0);
		values.cost = 1;
		expect(await run(minutes(4))).toBe(0);
		values.cost = 8;
		expect(await run(minutes(61))).toBe(1);
		expect(sent.map((body) => body.type)).toEqual([
			'alert.firing',
			'alert.resolved',
			'alert.firing'
		]);
		expect(sent[0]?.text).toMatch(/^Now \$6\.00 of AI cost in the last day/);
	});

	it('skip disabled rules and record failed checks', async () => {
		const { db, sent, run, rule } = await setup();
		const off = await rule({
			enabled: false,
			spec: {
				kind: 'metric',
				config: { event: '', window: '1h', comparison: 'below', threshold: 1 }
			}
		});
		expect(await run(minutes(1))).toBe(0);
		await db
			.update(alertRules)
			.set({ enabled: true, config: '{"window":"1h","threshold":1,"comparison":"below"}' })
			.where(eq(alertRules.id, off.id));
		expect(await run(minutes(2))).toBe(1);
		expect(sent).toHaveLength(1);

		const failing = await setup();
		failing.values.count = Number.NaN;
		const broken = await failing.rule({
			spec: {
				kind: 'metric',
				config: { event: '', window: '1h', comparison: 'above', threshold: 1 }
			}
		});
		const checks = {
			newIssues: async () => [],
			regressedIssues: async () => [],
			eventCount: async () => {
				throw new Error('ClickHouse error 500');
			},
			aiCost: async () => 0
		};
		expect(await checkAlerts(failing.db, checks, { now: minutes(1) })).toBe(0);
		const [stored] = await failing.db.select().from(alertRules).where(eq(alertRules.id, broken.id));
		expect(stored?.lastError).toBe('ClickHouse error 500');
	});
});

describe('issue rules', () => {
	it('check each stretch of stored exceptions once', async () => {
		const { db, user, project, issues, calls, sent, run, rule } = await setup();
		await rule({ spec: { kind: 'issue', config: { newIssues: true, regressions: true } } });
		await setIssueStatus(
			db,
			{ projectId: project.id, fingerprint: 'fixed', status: 'resolved', userId: user.id },
			start
		);
		await setIssueStatus(db, {
			projectId: project.id,
			fingerprint: 'muted',
			status: 'ignored',
			userId: user.id
		});

		expect(await run(minutes(1))).toBe(0);
		issues.found = [typeError('a')];
		expect(await run(minutes(2))).toBe(1);
		issues.found = [];
		issues.regressed = [typeError('fixed')];
		expect(await run(minutes(3))).toBe(1);

		const lag = (n: number) => new Date(minutes(n).getTime() - ISSUE_LAG_MS);
		expect(calls.filter((c) => c.kind === 'new').map((c) => [c.from, c.to])).toEqual([
			[start, lag(1)],
			[lag(1), lag(2)],
			[lag(2), lag(3)]
		]);
		expect(calls.find((c) => c.kind === 'regressed')?.resolved).toEqual(['fixed']);

		expect(sent.map((body) => body.title)).toEqual([
			'New issue in Website: TypeError',
			'Issue regressed in Website: TypeError'
		]);
		expect(sent[0]?.text).toBe('Rule: Rule\nNew: TypeError: x is undefined');
		expect(sent[0]?.url).toBe(`https://analytics.example.com/projects/${project.id}/issues/a`);
		expect((await listDeliveries(db, project.id)).map((d) => d.ok)).toEqual([true, true]);
	});

	it('sums up several issues in one message', async () => {
		const { project, issues, sent, run, rule } = await setup();
		await rule({ spec: { kind: 'issue', config: { newIssues: true, regressions: false } } });
		issues.found = [typeError('a'), typeError('b')];
		issues.regressed = [typeError('c')];
		expect(await run(minutes(2))).toBe(1);
		expect(sent[0]?.title).toBe('2 new issues in Website');
		expect(sent[0]?.url).toBe(`https://analytics.example.com/projects/${project.id}/issues`);
		expect(sent[0]?.issues).toHaveLength(2);
	});
});
