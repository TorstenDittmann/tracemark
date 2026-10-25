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
import { storageUsage, usageVolume } from './usage';

const project = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const elsewhere = '33333333-3333-4333-8333-333333333333';
const empty = '44444444-4444-4444-8444-444444444444';

const DAY = 24 * 60;
// Mid-day, so offsets of whole days stay on one UTC day.
const now = new Date('2026-03-10T12:00:00Z');

let config: ClickHouseConfig;

/** An event stored `daysAgo` days before `now`, that happened a day before that. */
function event(name: string, daysAgo: number, extra: Partial<TestEvent> = {}): TestEvent {
	return {
		distinctId: 'user-1',
		event: name,
		minutesAgo: (daysAgo + 1) * DAY,
		insertedMinutesAgo: daysAgo * DAY,
		projectId: project,
		...extra
	};
}

describe.skipIf(!clickhouseTestUrl)('usage in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('usage');
		await insertEvents(
			config,
			[
				event('$pageview', 0),
				event('$pageview', 0),
				event('$pageleave', 1),
				event('$autocapture', 1),
				event('$web_vitals', 2),
				event('$exception', 2),
				event('$ai_generation', 3),
				event('$ai_score', 3),
				event('$identify', 4),
				event('$set', 4),
				event('$groupidentify', 4),
				event('$feature_flag_called', 5),
				event('signed_up', 5),
				// Stored before the 7 day range, though it happened inside it.
				event('signed_up', 8, { minutesAgo: DAY }),
				event('$pageview', 1, { projectId: other }),
				event('$pageview', 1, { projectId: elsewhere }),
				event('$pageview', 1, { projectId: elsewhere })
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('counts events per project and day by when they were stored', async () => {
		const usage = await usageVolume(config, [project, other, empty], { range: '7d', now });
		expect(usage.buckets).toHaveLength(7);
		expect(usage.buckets.at(-1)).toBe('2026-03-10T00:00:00Z');
		const [mine, theirs, none] = usage.projects;
		expect(mine.id).toBe(project);
		expect(mine.daily).toEqual([0, 2, 3, 2, 2, 2, 2]);
		expect(mine.total).toBe(13);
		expect(theirs.total).toBe(1);
		expect(none).toMatchObject({ id: empty, total: 0, daily: [0, 0, 0, 0, 0, 0, 0] });
		// Projects that weren't asked for don't count.
		expect(usage.total).toBe(14);
	});

	it('breaks events down by category', async () => {
		const usage = await usageVolume(config, [project], { range: '30d', now });
		expect(usage.projects[0].categories).toEqual({
			pageview: 3,
			autocapture: 2,
			exception: 1,
			ai: 2,
			identity: 3,
			other: 1,
			custom: 2
		});
		expect(usage.categories.custom).toBe(2);
		expect(usage.total).toBe(14);
	});

	it('returns empty volume without projects', async () => {
		const usage = await usageVolume(config, [], { range: '7d', now });
		expect(usage).toMatchObject({ total: 0, projects: [] });
	});

	it('reports table sizes and estimates project shares of events', async () => {
		const storage = await storageUsage(config, [project, other, empty]);
		expect(storage).not.toBeNull();
		const events = storage?.tables.find(
			(t) => t.database === config.database && t.table === 'events'
		);
		expect(events?.rows).toBe(17);
		expect(events?.compressedBytes).toBeGreaterThan(0);
		expect(events?.uncompressedBytes).toBeGreaterThan(0);
		const bytes = events?.compressedBytes ?? 0;
		expect(storage?.estimates[project]).toBe(Math.round((14 / 17) * bytes));
		expect(storage?.estimates[other]).toBe(Math.round((1 / 17) * bytes));
		expect(storage?.estimates[empty]).toBe(0);
	});
});
