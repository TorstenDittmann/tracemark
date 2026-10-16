// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TrendsQuery } from '../insights';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import { eventNames, propertyNames, trends } from './insights';

const project = '66666666-6666-4666-8666-666666666666';
const recent = '77777777-7777-4777-8777-777777777777';
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
				event('anon-e', 'purchase', 10, { amount: 100 }, '88888888-8888-4888-8888-888888888888')
			],
			now.getTime()
		);
		await insertEvents(config, [
			event('anon-f', 'clicked', 5, { button: 'buy', nested: { depth: 1 } }, recent)
		]);
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

	it('lists recent events and property names', async () => {
		expect(await eventNames(config, recent)).toEqual([{ event: 'clicked', count: 1 }]);
		expect(await propertyNames(config, recent)).toEqual([
			{ name: 'button', numeric: false },
			{ name: 'nested.depth', numeric: true }
		]);
	});
});
