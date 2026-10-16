// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import { issueDetail, listIssues } from './issues';

const project = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const other = 'efefefef-efef-4fef-8fef-efefefefefef';
const now = new Date(Date.UTC(2026, 9, 16, 12, 0));
const DAY = 24 * 60;

const exception = (
	distinctId: string,
	fingerprint: string,
	ago: number,
	extra: { type?: string; value?: string; projectId?: string; release?: string } = {}
): TestEvent => ({
	projectId: extra.projectId ?? project,
	distinctId,
	event: '$exception',
	minutesAgo: ago,
	properties: {
		$exception_fingerprint: fingerprint,
		$exception_level: 'error',
		$current_url: 'https://example.com/cart',
		...(extra.release ? { $release: extra.release } : {}),
		$exception_list: [
			{
				type: extra.type ?? 'TypeError',
				value: extra.value ?? 'x is undefined',
				mechanism: { type: 'onerror', handled: false },
				stacktrace: {
					frames: [
						{
							filename: 'https://example.com/app.js',
							function: 'render',
							lineno: 3,
							colno: 9,
							in_app: true
						}
					]
				}
			},
			{ type: 'Error', value: 'cart not loaded' }
		]
	}
});

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('error issues', () => {
	beforeAll(async () => {
		config = await createTestDatabase('issues');
		await insertEvents(
			config,
			[
				// cart: three people this week (anon-bob is bob), plus one occurrence 20 days ago.
				exception('ada', 'cart', 20 * DAY),
				exception('ada', 'cart', 2 * DAY + 30, { value: 'older message' }),
				exception('anon-bob', 'cart', DAY + 30),
				{
					projectId: project,
					distinctId: 'bob',
					event: '$identify',
					minutesAgo: DAY,
					properties: { $anon_distinct_id: 'anon-bob' }
				},
				exception('bob', 'cart', 90, { release: '1.4.0', value: 'newest message' }),
				// A server error with no person.
				exception('$server', 'db', 60, { type: 'DatabaseError', value: 'timeout' }),
				// Only before the window.
				exception('cy', 'old', 30 * DAY),
				// Not an exception, or another project's.
				{ projectId: project, distinctId: 'ada', event: '$pageview', minutesAgo: 10 },
				exception('ada', 'cart', 10, { projectId: other })
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('lists issues in the window, most recently seen first', async () => {
		const list = await listIssues(config, project, { range: '7d', now });
		expect(list.buckets).toHaveLength(7);
		expect(list.issues.map((issue) => issue.fingerprint)).toEqual(['db', 'cart']);
		const [db, cart] = list.issues;
		expect(db).toMatchObject({
			type: 'DatabaseError',
			value: 'timeout',
			occurrences: 1,
			people: 0
		});
		expect(cart).toMatchObject({
			type: 'TypeError',
			value: 'newest message',
			occurrences: 3,
			people: 2,
			firstSeen: new Date(now.getTime() - 20 * DAY * 60_000).toISOString(),
			lastSeen: new Date(now.getTime() - 90 * 60_000).toISOString()
		});
		expect(cart?.series.reduce((a, b) => a + b, 0)).toBe(3);
		expect(cart?.series.slice(-3)).toEqual([1, 1, 1]);
	});

	it('limits the list', async () => {
		const list = await listIssues(config, project, { range: '90d', now, limit: 1 });
		expect(list.issues.map((issue) => issue.fingerprint)).toEqual(['db']);
	});

	it('details one issue', async () => {
		const detail = await issueDetail(config, project, 'cart', { range: '7d', now });
		expect(detail).toMatchObject({
			occurrences: 3,
			people: 2,
			totalOccurrences: 4,
			totalPeople: 2,
			level: 'error',
			release: '1.4.0'
		});
		expect(detail?.exceptions).toEqual([
			{
				type: 'TypeError',
				value: 'newest message',
				handled: false,
				mechanism: 'onerror',
				frames: [
					{
						filename: 'https://example.com/app.js',
						function: 'render',
						lineno: 3,
						colno: 9,
						inApp: true
					}
				]
			},
			{
				type: 'Error',
				value: 'cart not loaded',
				handled: undefined,
				mechanism: undefined,
				frames: []
			}
		]);
		expect(detail?.recent.map((o) => [o.person, o.value])).toEqual([
			['bob', 'newest message'],
			['bob', 'x is undefined'],
			['ada', 'older message'],
			['ada', 'x is undefined']
		]);
		expect(detail?.recent[0]).toMatchObject({ url: 'https://example.com/cart', release: '1.4.0' });
		expect(detail?.topPeople).toEqual([
			{ person: 'bob', occurrences: 2 },
			{ person: 'ada', occurrences: 1 }
		]);
	});

	it('finds nothing for an unknown issue or another project', async () => {
		expect(await issueDetail(config, project, 'nope', { range: '7d', now })).toBeNull();
		expect(await issueDetail(config, other, 'db', { range: '7d', now })).toBeNull();
	});
});
