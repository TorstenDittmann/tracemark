// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiCost, eventCount, newIssues, regressedIssues } from './alert-checks';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';

const project = 'dededede-dede-4ede-8ede-dededededede';
const other = 'fafafafa-fafa-4afa-8afa-fafafafafafa';
const now = new Date(Date.UTC(2026, 9, 16, 12, 0));
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

/** An exception that happened `happened` minutes ago and was stored `stored` minutes ago. */
const exception = (
	fingerprint: string,
	happened: number,
	stored: number,
	value = 'x is undefined',
	projectId = project
): TestEvent => ({
	projectId,
	distinctId: 'ada',
	event: '$exception',
	minutesAgo: happened,
	insertedMinutesAgo: stored,
	properties: {
		$exception_fingerprint: fingerprint,
		$exception_list: [{ type: 'TypeError', value }]
	}
});

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('alert checks', () => {
	beforeAll(async () => {
		config = await createTestDatabase('alerts');
		await insertEvents(
			config,
			[
				// old: seen long ago and again now, so not new.
				exception('old', 600, 600),
				exception('old', 2, 2),
				// fresh: first stored in the last 5 minutes, even though it happened earlier.
				exception('fresh', 30, 3, 'first'),
				exception('fresh', 1, 1, 'latest'),
				// late: stored after the window.
				exception('late', 1, -1),
				// Another project's.
				exception('elsewhere', 1, 1, 'x', other),
				// resolved 100 minutes ago; happened again 50 minutes ago (already noticed) and now.
				exception('flaky', 200, 200),
				exception('flaky', 50, 50),
				exception('flaky', 1, 1),
				// resolved 100 minutes ago; first happened again now.
				exception('back', 200, 200),
				exception('back', 2, 2),
				// resolved 100 minutes ago; an older occurrence stored late does not count.
				exception('quiet', 200, 200),
				exception('quiet', 150, 1),
				{ projectId: project, distinctId: 'ada', event: 'signed_up', minutesAgo: 10 },
				{ projectId: project, distinctId: 'bob', event: 'signed_up', minutesAgo: 30 },
				{ projectId: project, distinctId: 'bob', event: 'signed_up', minutesAgo: 120 },
				{ projectId: other, distinctId: 'bob', event: 'signed_up', minutesAgo: 10 },
				{
					projectId: project,
					distinctId: 'ada',
					event: '$ai_generation',
					minutesAgo: 5,
					properties: { $ai_cost_usd: 1.25 }
				},
				{
					projectId: project,
					distinctId: 'ada',
					event: '$ai_embedding',
					minutesAgo: 20,
					properties: { $ai_cost_usd: 0.5 }
				},
				{
					projectId: project,
					distinctId: 'ada',
					event: '$ai_generation',
					minutesAgo: 90,
					properties: { $ai_cost_usd: 10 }
				}
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('finds issues first stored in the window', async () => {
		const issues = await newIssues(config, project, ago(5), now);
		expect(issues).toEqual([
			{ fingerprint: 'fresh', type: 'TypeError', value: 'latest', occurrences: 2 }
		]);
		expect(await newIssues(config, project, now, ago(-5))).toEqual([
			expect.objectContaining({ fingerprint: 'late' })
		]);
	});

	it('finds resolved issues that happened again for the first time', async () => {
		const resolvedAt = ago(100);
		const resolved = ['flaky', 'back', 'quiet'].map((fingerprint) => ({
			fingerprint,
			resolvedAt
		}));
		const issues = await regressedIssues(config, project, resolved, ago(5), now);
		expect(issues.map((i) => i.fingerprint)).toEqual(['back']);
		// The flaky one regressed 50 minutes ago.
		const earlier = await regressedIssues(config, project, resolved, ago(60), now);
		expect(earlier.map((i) => i.fingerprint)).toEqual(['flaky', 'back']);
		expect(await regressedIssues(config, project, [], ago(60), now)).toEqual([]);
	});

	it('counts events in a window', async () => {
		expect(await eventCount(config, project, 'signed_up', ago(60), now)).toBe(2);
		expect(await eventCount(config, project, 'signed_up', ago(180), now)).toBe(3);
		expect(await eventCount(config, project, 'nope', ago(180), now)).toBe(0);
		expect(await eventCount(config, project, '', ago(60), now)).toBeGreaterThan(2);
	});

	it('sums AI cost in a window', async () => {
		expect(await aiCost(config, project, ago(60), now)).toBeCloseTo(1.75);
		expect(await aiCost(config, project, ago(180), now)).toBeCloseTo(11.75);
		expect(await aiCost(config, other, ago(180), now)).toBe(0);
	});
});
