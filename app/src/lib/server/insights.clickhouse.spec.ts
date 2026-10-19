// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
	FunnelQuery,
	LifecycleQuery,
	PathsQuery,
	RetentionQuery,
	TrendsQuery
} from '../insights';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import {
	eventNames,
	funnel,
	lifecycle,
	pagePaths,
	paths,
	propertyNames,
	retention,
	trends
} from './insights';

const project = '66666666-6666-4666-8666-666666666666';
const recent = '77777777-7777-4777-8777-777777777777';
const funnels = '99999999-9999-4999-8999-999999999999';
const cohorts = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pathsProject = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const manyPaths = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const lifecycles = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DAY = 24 * 60;
// 12:30 UTC, so the last hourly bucket is 12:00.
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));

function event(
	distinctId: string,
	name: string,
	minutesAgo: number,
	properties: Record<string, unknown> = {},
	projectId = project
): TestEvent {
	return { distinctId, event: name, minutesAgo, projectId, properties };
}

const query = (q: Partial<TrendsQuery>): TrendsQuery => ({
	series: [{ event: 'purchase', math: 'total' }],
	range: '24h',
	filters: [],
	...q
});

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('trends in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('insights');
		await insertEvents(
			config,
			[
				event('anon-a', 'purchase', 120, { amount: 10, plan: 'pro', $browser: 'Chrome' }),
				event('user-a', '$identify', 100, { $anon_distinct_id: 'anon-a' }),
				event('user-a', 'purchase', 30, { amount: 30, plan: 'pro', $browser: 'Chrome' }),
				event('anon-b', 'purchase', 60, { amount: '5', plan: 'free', $browser: 'Safari' }),
				event('anon-b', 'signed_up', 59),
				event('anon-c', 'purchase', 10, { $browser: 'Chrome' }),
				// Outside the day, or another project.
				event('anon-d', 'purchase', 60 * 48, { amount: 100 }),
				event('anon-e', 'purchase', 10, { amount: 100 }, '88888888-8888-4888-8888-888888888888'),
				// Funnels: $pageview → signed_up → purchase.
				event('p1', '$pageview', 300, { utm_source: 'ads' }, funnels),
				event('p1', 'signed_up', 290, {}, funnels),
				event('p1', 'purchase', 280, {}, funnels),
				event('p2', '$pageview', 300, { utm_source: 'news' }, funnels),
				event('p2', 'signed_up', 200, {}, funnels),
				// Out of order: the purchase does not count without a sign-up before it.
				event('p3', '$pageview', 300, { utm_source: 'ads' }, funnels),
				event('p3', 'purchase', 290, {}, funnels),
				event('p3', 'noise', 1, {}, funnels),
				// Never entered.
				event('p4', 'signed_up', 300, {}, funnels),
				// Signs up 48 hours after the page view: only inside a 7 day window.
				event('p5', '$pageview', 60 * 50, {}, funnels),
				event('p5', 'signed_up', 100, {}, funnels),
				// An anonymous page view and a sign-up under the identified id are one person.
				event('anon-6', '$pageview', 500, {}, funnels),
				event('user-6', '$identify', 450, { $anon_distinct_id: 'anon-6' }, funnels),
				event('user-6', 'signed_up', 400, {}, funnels),
				// Retention, days counted back from Oct 16 12:30: r1 starts Oct 14, returns Oct 15 and 16.
				event('r1', 'signed_up', 2 * DAY, {}, cohorts),
				event('r1', 'login', DAY, {}, cohorts),
				event('r1', 'login', 10, {}, cohorts),
				// r2 starts Oct 14 too, returns the same day only (not counted) and two days later.
				event('r2', 'signed_up', 2 * DAY, {}, cohorts),
				event('r2', 'login', 2 * DAY - 30, {}, cohorts),
				event('r2', 'login', 20, {}, cohorts),
				// r3 starts Oct 15 (anonymously) and comes back Oct 16 signed in.
				event('anon-r3', 'signed_up', DAY, {}, cohorts),
				event('r3', '$identify', DAY - 1, { $anon_distinct_id: 'anon-r3' }, cohorts),
				event('r3', 'login', 5, {}, cohorts),
				// A second start does not move r1 to a later cohort.
				event('r1', 'signed_up', 15, {}, cohorts)
			],
			now.getTime()
		);
		await insertEvents(config, [
			event('anon-f', 'clicked', 5, { button: 'buy', nested: { depth: 1 } }, recent)
		]);
		// Paths: one session per list, minutes ago counting down so they are in order.
		const visit = (sessionId: string, distinctId: string, steps: string[]): TestEvent[] =>
			steps.map((step, i) => ({
				...(step.startsWith('/')
					? event(distinctId, '$pageview', 100 - i, { $pathname: step }, pathsProject)
					: event(distinctId, step, 100 - i, {}, pathsProject)),
				sessionId
			}));
		await insertEvents(
			config,
			[
				...visit('s1', 'v1', ['/', '/pricing', '/pricing', '/signup', 'signed_up', '$pageleave']),
				...visit('s2', 'v2', ['/', '/docs']),
				...visit('s3', 'v3', ['/', '/pricing', '/docs']),
				...visit('s4', 'v4', ['/docs', '/', '/pricing']),
				// No session id: the person's events are one path.
				...visit('', 'v5', ['/about', '/'])
			],
			now.getTime()
		);
		// Ten pages after the home page: /p0 three times, /p1 twice, the rest once.
		const pages = [
			'/p0',
			'/p0',
			'/p0',
			'/p1',
			'/p1',
			...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `/p${n}`)
		];
		await insertEvents(
			config,
			pages.flatMap((page, i) =>
				['/', page].map((pathname, j) => ({
					...event(`m${i}`, '$pageview', 50 - j, { $pathname: pathname }, manyPaths),
					sessionId: `m${i}`
				}))
			),
			now.getTime()
		);
		// Lifecycle, days back from Oct 16 at 12:00.
		const active = (distinctId: string, days: number[]) =>
			days.map((d) => event(distinctId, 'login', d * DAY + 30, {}, lifecycles));
		await insertEvents(
			config,
			[
				// Sep 6, Oct 1, then Oct 9, 10 and 12.
				...active('l1', [40, 15, 7, 6, 4]),
				// New Oct 14, back Oct 15.
				...active('l2', [2, 1]),
				// Oct 9 only: dormant on the range's first day.
				...active('l3', [7]),
				// New today.
				...active('l4', [0]),
				event('l5', 'other', 0, {}, lifecycles)
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('counts events per hour', async () => {
		const result = await trends(config, project, query({}), now);
		expect(result.bucket).toBe('hour');
		expect(result.buckets).toHaveLength(24);
		const [line] = result.lines;
		expect(result.lines).toHaveLength(1);
		expect(line.label).toBe('purchase');
		expect(line.total).toBe(4);
		expect(line.data.slice(-3)).toEqual([1, 1, 2]);
		expect(line.data.reduce((a, b) => a + b)).toBe(4);
	});

	it('counts people once across their ids', async () => {
		const [line] = (
			await trends(
				config,
				project,
				query({ series: [{ event: 'purchase', math: 'unique_users' }] }),
				now
			)
		).lines;
		expect(line.total).toBe(3);
		expect(line.data.slice(-3)).toEqual([1, 1, 2]);
	});

	it('aggregates numeric properties, including numbers sent as strings', async () => {
		const result = await trends(
			config,
			project,
			query({
				series: (['sum', 'avg', 'min', 'max'] as const).map((math) => ({
					event: 'purchase',
					math,
					property: 'amount'
				}))
			}),
			now
		);
		expect(result.lines.map((line) => line.total)).toEqual([45, 15, 5, 30]);
	});

	it('breaks down by a property, biggest first', async () => {
		const result = await trends(config, project, query({ breakdown: '$browser' }), now);
		expect(result.lines.map((line) => [line.breakdown, line.total])).toEqual([
			['Chrome', 3],
			['Safari', 1]
		]);
	});

	it('shares the line budget across series', async () => {
		const series = Array.from({ length: 5 }, () => ({ event: 'purchase', math: 'total' as const }));
		const result = await trends(config, project, query({ series, breakdown: '$browser' }), now);
		expect(result.lines).toHaveLength(5);
		expect(result.lines.every((line) => line.breakdown === 'Chrome')).toBe(true);
	});

	it('filters by property', async () => {
		const total = async (filters: TrendsQuery['filters']) =>
			(await trends(config, project, query({ filters }), now)).lines[0].total;
		expect(await total([{ property: 'plan', operator: 'eq', value: 'pro' }])).toBe(2);
		expect(await total([{ property: 'plan', operator: 'neq', value: 'pro' }])).toBe(2);
		expect(await total([{ property: 'plan', operator: 'contains', value: 'FR' }])).toBe(1);
		expect(await total([{ property: 'amount', operator: 'gt', value: '6' }])).toBe(2);
		expect(await total([{ property: 'amount', operator: 'lt', value: '6' }])).toBe(1);
		expect(await total([{ property: 'amount', operator: 'is_not_set' }])).toBe(1);
		expect(
			await total([
				{ property: 'amount', operator: 'is_set' },
				{ property: '$browser', operator: 'eq', value: 'Chrome' }
			])
		).toBe(2);
	});

	it('returns a zero line for an event with no data', async () => {
		const [line] = (
			await trends(config, project, query({ series: [{ event: 'never', math: 'total' }] }), now)
		).lines;
		expect(line.total).toBe(0);
		expect(line.data.every((v) => v === 0)).toBe(true);
	});

	const funnelQuery = (q: Partial<FunnelQuery>): FunnelQuery => ({
		steps: ['$pageview', 'signed_up', 'purchase'],
		window: '1d',
		range: '30d',
		filters: [],
		...q
	});

	it('counts people through ordered steps within the window', async () => {
		const result = await funnel(config, funnels, funnelQuery({}), now);
		expect(result.total.counts).toEqual([5, 3, 1]);
		expect(result.groups).toEqual([]);
		const week = await funnel(config, funnels, funnelQuery({ window: '7d' }), now);
		expect(week.total.counts).toEqual([5, 4, 1]);
	});

	it('breaks a funnel down by the first step property', async () => {
		const result = await funnel(config, funnels, funnelQuery({ breakdown: 'utm_source' }), now);
		expect(result.groups).toEqual([
			{ breakdown: '', counts: [2, 1, 0] },
			{ breakdown: 'ads', counts: [2, 1, 1] },
			{ breakdown: 'news', counts: [1, 1, 0] }
		]);
		expect(result.total.counts).toEqual([5, 3, 1]);
	});

	it('builds daily retention cohorts', async () => {
		const query: RetentionQuery = {
			start: 'signed_up',
			returning: 'login',
			range: '7d',
			filters: []
		};
		const result = await retention(config, cohorts, query, now);
		expect(result.period).toBe('day');
		expect(result.cohorts).toHaveLength(7);
		expect(result.cohorts.slice(-3)).toEqual([
			{ start: '2026-10-14T00:00:00Z', size: 2, returned: [1, 2] },
			{ start: '2026-10-15T00:00:00Z', size: 1, returned: [1] },
			{ start: '2026-10-16T00:00:00Z', size: 0, returned: [] }
		]);
		expect(result.cohorts[0]).toEqual({
			start: '2026-10-10T00:00:00Z',
			size: 0,
			returned: [0, 0, 0, 0, 0, 0]
		});
	});

	it('builds weekly cohorts starting on Monday', async () => {
		const query: RetentionQuery = {
			start: 'signed_up',
			returning: 'login',
			range: '90d',
			filters: []
		};
		const result = await retention(config, cohorts, query, now);
		expect(result.period).toBe('week');
		// Oct 16 2026 is a Friday, so its week starts Monday Oct 12.
		expect(result.cohorts.at(-1)).toEqual({ start: '2026-10-12T00:00:00Z', size: 3, returned: [] });
		expect(new Date(result.cohorts[0].start).getUTCDay()).toBe(1);
	});

	const pathsQuery = (q: Partial<PathsQuery>): PathsQuery => ({
		label: 'page',
		steps: 5,
		range: '24h',
		filters: [],
		...q
	});

	it('lists page paths, most viewed first', async () => {
		expect(await pagePaths(config, pathsProject)).toEqual([
			'/',
			'/pricing',
			'/docs',
			'/about',
			'/signup'
		]);
	});

	it('follows page paths from a start, with drop-off', async () => {
		const result = await paths(config, pathsProject, pathsQuery({ start: '/' }), now);
		expect(result.sessions).toBe(5);
		expect(result.steps).toEqual([
			{
				nodes: [{ label: '/', sessions: 5, ended: 1 }],
				links: [
					{ source: '/', target: '/pricing', sessions: 3 },
					{ source: '/', target: '/docs', sessions: 1 }
				]
			},
			{
				nodes: [
					{ label: '/pricing', sessions: 3, ended: 1 },
					{ label: '/docs', sessions: 1, ended: 1 }
				],
				links: [
					{ source: '/pricing', target: '/docs', sessions: 1 },
					{ source: '/pricing', target: '/signup', sessions: 1 }
				]
			},
			{
				nodes: [
					{ label: '/docs', sessions: 1, ended: 1 },
					{ label: '/signup', sessions: 1, ended: 1 }
				],
				links: []
			}
		]);
	});

	it('does not count a path that goes on past the last step as ending', async () => {
		const result = await paths(config, pathsProject, pathsQuery({ start: '/', steps: 1 }), now);
		expect(result.steps.map((step) => step.nodes)).toEqual([
			[{ label: '/', sessions: 5, ended: 1 }],
			[
				{ label: '/pricing', sessions: 3, ended: 1 },
				{ label: '/docs', sessions: 1, ended: 1 }
			]
		]);
		expect(result.steps[1].links).toEqual([]);
	});

	it('counts back from an end', async () => {
		const result = await paths(config, pathsProject, pathsQuery({ end: '/pricing' }), now);
		expect(result.sessions).toBe(3);
		expect(result.steps).toEqual([
			{
				nodes: [{ label: '/docs', sessions: 1, ended: 1 }],
				links: [{ source: '/docs', target: '/', sessions: 1 }]
			},
			{
				nodes: [{ label: '/', sessions: 3, ended: 2 }],
				links: [{ source: '/', target: '/pricing', sessions: 3 }]
			},
			{ nodes: [{ label: '/pricing', sessions: 3, ended: 0 }], links: [] }
		]);
		const between = await paths(
			config,
			pathsProject,
			pathsQuery({ start: '/', end: '/docs' }),
			now
		);
		expect(between.steps.map((step) => step.nodes.map((node) => node.label))).toEqual([
			['/'],
			['/docs', '/pricing'],
			['/docs']
		]);
	});

	it('follows event names, leaving out page leaves', async () => {
		const result = await paths(config, pathsProject, pathsQuery({ label: 'event' }), now);
		expect(result.steps).toEqual([
			{
				nodes: [{ label: '$pageview', sessions: 5, ended: 4 }],
				links: [{ source: '$pageview', target: 'signed_up', sessions: 1 }]
			},
			{ nodes: [{ label: 'signed_up', sessions: 1, ended: 1 }], links: [] }
		]);
	});

	it('groups all but the busiest steps as other', async () => {
		const result = await paths(config, manyPaths, pathsQuery({}), now);
		const [, second] = result.steps;
		expect(second.nodes.map((node) => [node.label, node.sessions])).toEqual([
			['/p0', 3],
			['/p1', 2],
			...[2, 3, 4, 5, 6, 7].map((n) => [`/p${n}`, 1]),
			[null, 2]
		]);
		expect(result.steps[0].links).toHaveLength(9);
		expect(result.steps[0].links[2]).toEqual({ source: '/', target: null, sessions: 2 });
	});

	const lifecycleQuery = (q: Partial<LifecycleQuery>): LifecycleQuery => ({
		event: 'login',
		interval: 'day',
		range: '7d',
		filters: [],
		...q
	});

	it('sorts people into lifecycle states by day', async () => {
		const result = await lifecycle(config, lifecycles, lifecycleQuery({}), now);
		expect(result.periods).toHaveLength(7);
		expect(result.periods[0]).toBe('2026-10-10T00:00:00Z');
		expect(result.counts).toEqual({
			new: [0, 0, 0, 0, 1, 0, 1],
			returning: [1, 0, 0, 0, 0, 1, 0],
			resurrecting: [0, 0, 1, 0, 0, 0, 0],
			dormant: [-1, -1, 0, -1, 0, 0, -1]
		});
	});

	it('sorts people into lifecycle states by week and month', async () => {
		const weeks = await lifecycle(
			config,
			lifecycles,
			lifecycleQuery({ interval: 'week', range: '30d' }),
			now
		);
		expect(weeks.periods).toEqual([
			'2026-09-14T00:00:00Z',
			'2026-09-21T00:00:00Z',
			'2026-09-28T00:00:00Z',
			'2026-10-05T00:00:00Z',
			'2026-10-12T00:00:00Z'
		]);
		expect(weeks.counts).toEqual({
			new: [0, 0, 0, 1, 2],
			returning: [0, 0, 0, 1, 1],
			resurrecting: [0, 0, 1, 0, 0],
			dormant: [0, 0, 0, 0, -1]
		});
		const months = await lifecycle(
			config,
			lifecycles,
			lifecycleQuery({ interval: 'month', range: '30d' }),
			now
		);
		expect(months.periods).toEqual(['2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z']);
		expect(months.counts).toEqual({
			new: [1, 3],
			returning: [0, 1],
			resurrecting: [0, 0],
			dormant: [0, 0]
		});
	});

	it('lists recent events and property names', async () => {
		expect(await eventNames(config, recent)).toEqual([{ event: 'clicked', count: 1 }]);
		expect(await propertyNames(config, recent)).toEqual([
			{ name: 'button', numeric: false },
			{ name: 'nested.depth', numeric: true }
		]);
	});
});
