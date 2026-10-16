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
import { deleteProjectEvents, personProperties, projectEventStats } from './events';

const project = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

let config: ClickHouseConfig;

function event(
	distinctId: string,
	name: string,
	minutesAgo: number,
	extra: Partial<TestEvent> = {}
): TestEvent {
	return { distinctId, event: name, minutesAgo, projectId: project, ...extra };
}

describe.skipIf(!clickhouseTestUrl)('people in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('people');
		await insertEvents(config, [
			event('anon-1', '$pageview', 30, { set: { plan: 'free' }, setOnce: { first_seen: 'web' } }),
			event('user-1', '$identify', 20, {
				properties: { $anon_distinct_id: 'anon-1' },
				set: { email: 'ada@example.com' },
				setOnce: { first_seen: 'app' }
			}),
			event('user-1', '$set', 10, { set: { plan: 'pro', limits: { seats: 3 } } }),
			// A later identification of the same anonymous id does not move it.
			event('user-3', '$identify', 5, { properties: { $anon_distinct_id: 'anon-1' } }),
			// Identified to identified switches are not merged.
			event('user-2', '$identify', 5, { properties: {} }),
			event('anon-2', '$pageview', 60 * 48),
			event('anon-1', '$pageview', 1, { projectId: other })
		]);
	});

	afterAll(() => dropTestDatabase(config));

	it('counts an anonymous visitor and the id they identify as as one person', async () => {
		const stats = await projectEventStats(config, project);
		expect(stats.last24h).toBe(5);
		// user-1 (with anon-1), user-3, user-2; anon-2 is older than a day.
		expect(stats.people24h).toBe(3);
		expect(stats.lastEventAt).not.toBeNull();
	});

	it('merges person properties across linked ids', async () => {
		const expected = {
			email: 'ada@example.com',
			first_seen: 'web',
			limits: { seats: 3 },
			plan: 'pro'
		};
		expect(await personProperties(config, project, 'user-1')).toEqual(expected);
		expect(await personProperties(config, project, 'anon-1')).toEqual(expected);
		expect(await personProperties(config, project, 'user-3')).toEqual({});
	});

	it('deletes a project without touching others', async () => {
		await deleteProjectEvents(config, project);
		expect((await projectEventStats(config, project)).last24h).toBe(0);
		expect(await personProperties(config, project, 'user-1')).toEqual({});
		expect((await projectEventStats(config, other)).last24h).toBe(1);
	});
});
