// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents
} from './clickhouse-test';
import { eventDefinitions, propertyDefinitions, recentEvents } from './explore';

const project = '66666666-6666-4666-8666-666666666666';
const other = '77777777-7777-4777-8777-777777777777';
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('event browser in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('explore');
		await insertEvents(
			config,
			[
				{
					projectId: project,
					distinctId: 'anon-1',
					sessionId: 's1',
					event: '$pageview',
					minutesAgo: 30,
					properties: { $pathname: '/', plan: 'free' }
				},
				{
					projectId: project,
					distinctId: 'user-1',
					event: '$identify',
					minutesAgo: 20,
					properties: { $anon_distinct_id: 'anon-1' }
				},
				// Three events at the same moment, to page through a tie.
				...[1, 2, 3].map((n) => ({
					projectId: project,
					distinctId: 'user-1',
					event: 'purchase',
					minutesAgo: 10,
					properties: { amount: n * 10, plan: n === 3 ? 'pro' : 'free' }
				})),
				// Older than the lookback window: in the definitions, not in the activity.
				{
					projectId: project,
					distinctId: 'anon-2',
					event: 'legacy',
					minutesAgo: 40 * 24 * 60,
					properties: { old: true }
				},
				{
					projectId: other,
					distinctId: 'someone',
					event: 'purchase',
					minutesAgo: 5,
					properties: { amount: 99 }
				}
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('lists recent events newest first, with people and properties', async () => {
		const page = await recentEvents(config, project, { filters: [] }, { now });
		expect(page.next).toBeNull();
		expect(page.events.map((e) => e.event)).toEqual([
			'purchase',
			'purchase',
			'purchase',
			'$identify',
			'$pageview'
		]);
		const pageview = page.events.at(-1);
		expect(pageview).toMatchObject({
			distinctId: 'anon-1',
			person: 'user-1',
			sessionId: 's1',
			timestamp: '2026-10-16T12:00:00.000Z',
			properties: { $pathname: '/', plan: 'free' }
		});
	});

	it('pages through events that share a timestamp without gaps or repeats', async () => {
		const seen: string[] = [];
		let before: Awaited<ReturnType<typeof recentEvents>>['next'] | undefined;
		do {
			const page = await recentEvents(
				config,
				project,
				{ filters: [] },
				{ now, limit: 2, before: before ?? undefined }
			);
			seen.push(...page.events.map((e) => e.uuid));
			before = page.next;
		} while (before);
		expect(seen).toHaveLength(5);
		expect(new Set(seen).size).toBe(5);
	});

	it('narrows by event name and property filters', async () => {
		const purchases = await recentEvents(
			config,
			project,
			{ event: 'purchase', filters: [] },
			{ now }
		);
		expect(purchases.events).toHaveLength(3);
		const pro = await recentEvents(
			config,
			project,
			{ filters: [{ property: 'plan', operator: 'eq', value: 'pro' }] },
			{ now }
		);
		expect(pro.events.map((e) => e.properties.amount)).toEqual([30]);
		const big = await recentEvents(
			config,
			project,
			{ event: 'purchase', filters: [{ property: 'amount', operator: 'gt', value: '15' }] },
			{ now }
		);
		expect(big.events).toHaveLength(2);
	});

	it('defines every event the project has sent, busiest first', async () => {
		const definitions = await eventDefinitions(config, project, now);
		expect(definitions).toEqual([
			{
				event: 'purchase',
				count: 3,
				firstSeen: '2026-10-16T12:20:00.000Z',
				lastSeen: '2026-10-16T12:20:00.000Z'
			},
			expect.objectContaining({ event: '$identify', count: 1 }),
			expect.objectContaining({ event: '$pageview', count: 1 }),
			expect.objectContaining({ event: 'legacy', count: 0, lastSeen: '2026-09-06T12:30:00.000Z' })
		]);
	});

	it('defines properties with their types and how many events carry them', async () => {
		expect(await propertyDefinitions(config, project, { now })).toEqual([
			{ name: '$anon_distinct_id', types: ['string'], count: 1 },
			{ name: '$pathname', types: ['string'], count: 1 },
			{ name: 'amount', types: ['number'], count: 3 },
			{ name: 'plan', types: ['string'], count: 4 }
		]);
		expect(await propertyDefinitions(config, project, { event: 'purchase', now })).toEqual([
			{ name: 'amount', types: ['number'], count: 3 },
			{ name: 'plan', types: ['string'], count: 3 }
		]);
	});
});
