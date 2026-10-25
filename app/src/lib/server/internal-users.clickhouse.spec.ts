// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InternalRule } from '../internal-users';
import { aiOverview, listTraces } from './ai';
import { aiCost, eventCount, newIssues } from './alert-checks';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import { experimentCounts } from './experiment-results';
import { funnel, lifecycle, paths, retention, stickiness, trends } from './insights';
import { internalUsersSql } from './internal-users';
import { issueDetail, listIssues } from './issues';
import { webAnalytics, webVitals } from './web';

const project = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

const rules: InternalRule[] = [
	{ kind: 'email_domain', value: '@acme.com' },
	{ kind: 'distinct_id', value: 'qa-bot' },
	{ kind: 'property', property: '$host', value: 'localhost' }
];

function event(
	distinctId: string,
	name: string,
	minutesAgo: number,
	properties: Record<string, unknown> = {},
	extra: Partial<TestEvent> = {}
): TestEvent {
	return {
		projectId: project,
		distinctId,
		event: name,
		minutesAgo,
		properties,
		insertedMinutesAgo: minutesAgo,
		...extra
	};
}

const page = (distinctId: string, minutesAgo: number, host = 'example.com') =>
	event(
		distinctId,
		'$pageview',
		minutesAgo,
		{ $pathname: '/', $host: host },
		{
			sessionId: `s-${distinctId}`
		}
	);

/** The people (person keys) an insight-style query over events counts. */
async function people(internal?: InternalRule[]): Promise<string[]> {
	const params: Record<string, string> = { project };
	const body = await clickhouseQuery(
		config,
		`SELECT DISTINCT e.distinct_id AS id FROM events AS e
		WHERE e.project_id = {project:UUID}${internalUsersSql(internal, params)}
		ORDER BY id FORMAT JSONEachRow`,
		{ params }
	);
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => (JSON.parse(line) as { id: string }).id);
}

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('internal users in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('internal');
		await insertEvents(
			config,
			[
				// A customer, anonymous until they identify.
				page('anon-real', 200),
				event(
					'real',
					'$identify',
					190,
					{ $anon_distinct_id: 'anon-real' },
					{
						set: { email: 'pat@customer.com' }
					}
				),
				page('real', 100),
				event('real', 'purchase', 90),
				// A teammate: their anonymous events go too, and the email matches in any case.
				page('anon-staff', 210),
				event(
					'staff',
					'$identify',
					205,
					{ $anon_distinct_id: 'anon-staff' },
					{
						set: { email: 'Dev@ACME.com' }
					}
				),
				page('staff', 110),
				event('staff', 'purchase', 100),
				// A test account by distinct id.
				page('qa-bot', 120),
				event('qa-bot', 'purchase', 115),
				// A customer whose one visit from localhost is left out, the other kept.
				page('local', 50, 'localhost'),
				page('local', 40),
				// Not acme.com, though it ends the same.
				event('notacme', 'purchase', 30, {}, { set: { email: 'x@notacme.com' } }),
				// Web vitals.
				event('real', '$web_vitals', 95, { $pathname: '/', $web_vitals_LCP_value: 1000 }),
				event('staff', '$web_vitals', 105, { $pathname: '/', $web_vitals_LCP_value: 9000 }),
				// Errors.
				event('real', '$exception', 80, {
					$exception_fingerprint: 'customer-bug',
					$exception_list: [{ type: 'TypeError', value: 'x' }]
				}),
				event('staff', '$exception', 3, {
					$exception_fingerprint: 'staff-bug',
					$exception_list: [{ type: 'TypeError', value: 'y' }]
				}),
				// AI.
				event('real', '$ai_generation', 70, {
					$ai_trace_id: 't-real',
					$ai_model: 'gpt',
					$ai_cost_usd: 1
				}),
				event('staff', '$ai_generation', 70, {
					$ai_trace_id: 't-staff',
					$ai_model: 'gpt',
					$ai_cost_usd: 5
				}),
				// An experiment.
				event('real', '$feature_flag_called', 150, {
					$feature_flag: 'exp',
					$feature_flag_response: 'control'
				}),
				event('staff', '$feature_flag_called', 150, {
					$feature_flag: 'exp',
					$feature_flag_response: 'test'
				})
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('adds nothing without rules', () => {
		const params = { project };
		expect(internalUsersSql(undefined, params)).toBe('');
		expect(internalUsersSql([], params)).toBe('');
		expect(params).toEqual({ project });
	});

	it('leaves out every distinct id of matching people, and matching events', async () => {
		expect(await people()).toEqual([
			'anon-real',
			'anon-staff',
			'local',
			'notacme',
			'qa-bot',
			'real',
			'staff'
		]);
		expect(await people(rules)).toEqual(['anon-real', 'local', 'notacme', 'real']);
		expect(await people([{ kind: 'email', value: 'pat@customer.com' }])).toEqual([
			'anon-staff',
			'local',
			'notacme',
			'qa-bot',
			'staff'
		]);
		// Values are bound as parameters, so quotes and backslashes are just text.
		expect(
			await people([
				{ kind: 'distinct_id', value: "o'brien\\" },
				{ kind: 'email', value: "a'b@c.d" },
				{ kind: 'property', property: '$host', value: "'; DROP TABLE events; --" }
			])
		).toHaveLength(7);
	});

	it('filters trends, funnels, retention, paths, lifecycle and stickiness', async () => {
		const purchases = (internal?: InternalRule[]) =>
			trends(
				config,
				project,
				{ series: [{ event: 'purchase', math: 'total' }], range: '24h', filters: [] },
				now,
				undefined,
				internal
			).then((result) => result.lines[0].total);
		expect(await purchases()).toBe(4);
		expect(await purchases(rules)).toBe(2);

		const converted = (internal?: InternalRule[]) =>
			funnel(
				config,
				project,
				{ steps: ['$pageview', 'purchase'], window: '1d', range: '7d', filters: [] },
				now,
				undefined,
				internal
			).then((result) => result.total.counts);
		expect(await converted()).toEqual([4, 3]);
		expect(await converted(rules)).toEqual([2, 1]);

		const cohortSizes = (internal?: InternalRule[]) =>
			retention(
				config,
				project,
				{ start: '$pageview', returning: '$pageview', range: '7d', filters: [] },
				now,
				undefined,
				internal
			).then((result) => result.cohorts.reduce((sum, c) => sum + c.size, 0));
		expect(await cohortSizes()).toBe(4);
		expect(await cohortSizes(rules)).toBe(2);

		const sessions = (internal?: InternalRule[]) =>
			paths(
				config,
				project,
				{ label: 'page', steps: 2, range: '7d', filters: [] },
				now,
				undefined,
				internal
			).then((result) => result.sessions);
		const all = await sessions();
		expect(await sessions(rules)).toBeLessThan(all);

		const newPeople = (internal?: InternalRule[]) =>
			lifecycle(
				config,
				project,
				{ event: 'purchase', interval: 'day', range: '7d', filters: [] },
				now,
				undefined,
				internal
			).then((result) => result.counts.new.reduce((sum, n) => sum + n, 0));
		expect(await newPeople()).toBe(4);
		expect(await newPeople(rules)).toBe(2);

		const stickyPeople = (internal?: InternalRule[]) =>
			stickiness(
				config,
				project,
				{ events: ['purchase'], interval: 'day', range: '7d', cumulative: false, filters: [] },
				now,
				undefined,
				internal
			).then((result) => result.lines[0].people);
		expect(await stickyPeople()).toBe(4);
		expect(await stickyPeople(rules)).toBe(2);
	});

	it('filters web analytics and web vitals', async () => {
		const all = await webAnalytics(config, project, { range: '24h', now });
		expect(all.overview.visitors).toBe(4);
		const filtered = await webAnalytics(config, project, { range: '24h', now, internal: rules });
		expect(filtered.overview).toMatchObject({ visitors: 2, pageviews: 3 });

		expect((await webVitals(config, project, { range: '24h', now })).vitals.LCP.samples).toBe(2);
		const vitals = await webVitals(config, project, { range: '24h', now, internal: rules });
		expect(vitals.vitals.LCP).toEqual({ p75: 1000, samples: 1 });
	});

	it('filters experiment results', async () => {
		const counts = (internal?: InternalRule[]) =>
			experimentCounts(config, project, {
				flag: 'exp',
				variants: ['control', 'test'],
				metrics: [{ kind: 'conversion', event: 'purchase' }],
				from: ago(24 * 60),
				to: now,
				internal
			});
		expect((await counts()).map((v) => v.people)).toEqual([1, 1]);
		expect(await counts(rules)).toEqual([
			{ variant: 'control', people: 1, values: [1] },
			{ variant: 'test', people: 0, values: [0] }
		]);
	});

	it('filters the AI overview and traces', async () => {
		expect((await aiOverview(config, project, { range: '24h', now })).totals.cost).toBe(6);
		const overview = await aiOverview(config, project, { range: '24h', now, internal: rules });
		expect(overview.totals).toMatchObject({ calls: 1, cost: 1, people: 1 });
		expect(overview.people.map((p) => p.person)).toEqual(['real']);
		const traces = await listTraces(config, project, { range: '24h', now, internal: rules });
		expect(traces.map((t) => t.traceId)).toEqual(['t-real']);
	});

	it('filters error issues', async () => {
		const fingerprints = async (internal?: InternalRule[]) =>
			(await listIssues(config, project, { range: '24h', now, internal })).issues
				.map((issue) => issue.fingerprint)
				.sort();
		expect(await fingerprints()).toEqual(['customer-bug', 'staff-bug']);
		expect(await fingerprints(rules)).toEqual(['customer-bug']);
		expect(
			await issueDetail(config, project, 'staff-bug', { range: '24h', now, internal: rules })
		).toBeNull();
	});

	it('filters alert checks', async () => {
		expect(await eventCount(config, project, 'purchase', ago(24 * 60), now)).toBe(4);
		expect(await eventCount(config, project, 'purchase', ago(24 * 60), now, rules)).toBe(2);
		expect(await eventCount(config, project, '$pageview', ago(24 * 60), now, rules)).toBe(3);
		expect(await aiCost(config, project, ago(24 * 60), now)).toBe(6);
		expect(await aiCost(config, project, ago(24 * 60), now, rules)).toBe(1);
		expect((await newIssues(config, project, ago(5), now)).map((i) => i.fingerprint)).toEqual([
			'staff-bug'
		]);
		expect(await newIssues(config, project, ago(5), now, rules)).toEqual([]);
	});
});
