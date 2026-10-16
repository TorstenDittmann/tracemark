// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents
} from './clickhouse-test';
import { recentEvents } from './explore';
import { getPerson, listPersons } from './persons';

const project = '88888888-8888-4888-8888-888888888888';
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));
const odd = `o'brien\\x\t1`;

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('people in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('persons');
		await insertEvents(
			config,
			[
				// Ada browses anonymously, then signs up and is identified.
				{ projectId: project, distinctId: 'anon-ada', event: '$pageview', minutesAgo: 60 },
				{
					projectId: project,
					distinctId: 'ada',
					event: '$identify',
					minutesAgo: 50,
					properties: { $anon_distinct_id: 'anon-ada' },
					set: { email: 'ada@example.com', plan: 'pro' }
				},
				{ projectId: project, distinctId: 'ada', event: 'purchase', minutesAgo: 10 },
				// A visitor who never signs up.
				{ projectId: project, distinctId: 'anon-bob', event: '$pageview', minutesAgo: 30 },
				// An id with a quote and a backslash, to check parameter escaping.
				{ projectId: project, distinctId: odd, event: '$pageview', minutesAgo: 20 },
				// Last seen before the lookback window: not listed, but still has a page.
				{ projectId: project, distinctId: 'old', event: '$pageview', minutesAgo: 40 * 24 * 60 }
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('lists people most recently seen first, with merged ids and properties', async () => {
		const page = await listPersons(config, project, { now });
		expect(page.next).toBeNull();
		expect(page.persons.map((p) => p.person)).toEqual(['ada', odd, 'anon-bob']);
		expect(page.persons[0]).toEqual({
			person: 'ada',
			events: 3,
			firstSeen: '2026-10-16T11:30:00.000Z',
			lastSeen: '2026-10-16T12:20:00.000Z',
			properties: { email: 'ada@example.com', plan: 'pro' }
		});
	});

	it('pages through people', async () => {
		const first = await listPersons(config, project, { now, limit: 2 });
		expect(first.persons.map((p) => p.person)).toEqual(['ada', odd]);
		expect(first.next).not.toBeNull();
		const second = await listPersons(config, project, {
			now,
			limit: 2,
			before: first.next ?? undefined
		});
		expect(second.persons.map((p) => p.person)).toEqual(['anon-bob']);
		expect(second.next).toBeNull();
	});

	it('searches ids and person property values', async () => {
		const byEmail = await listPersons(config, project, { now, search: 'EXAMPLE.com' });
		expect(byEmail.persons.map((p) => p.person)).toEqual(['ada']);
		const byId = await listPersons(config, project, { now, search: 'bob' });
		expect(byId.persons.map((p) => p.person)).toEqual(['anon-bob']);
	});

	it('resolves an anonymous id to the person it was identified as', async () => {
		const person = await getPerson(config, project, 'anon-ada');
		expect(person).toEqual({
			person: 'ada',
			distinctIds: ['ada', 'anon-ada'],
			properties: { email: 'ada@example.com', plan: 'pro' },
			events: 3,
			firstSeen: '2026-10-16T11:30:00.000Z',
			lastSeen: '2026-10-16T12:20:00.000Z'
		});
		expect(await getPerson(config, project, odd)).toMatchObject({ person: odd, events: 1 });
		expect(await getPerson(config, project, 'old')).toMatchObject({ events: 1 });
		expect(await getPerson(config, project, 'nobody')).toBeNull();
	});

	it("shows a person's timeline across all their ids, from any time", async () => {
		const timeline = await recentEvents(
			config,
			project,
			{ filters: [] },
			{ now, distinctIds: ['ada', 'anon-ada'] }
		);
		expect(timeline.events.map((e) => e.event)).toEqual(['purchase', '$identify', '$pageview']);
		const old = await recentEvents(config, project, { filters: [] }, { now, distinctIds: ['old'] });
		expect(old.events).toHaveLength(1);
	});
});
