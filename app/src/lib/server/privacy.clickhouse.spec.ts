// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClickHouseConfig } from './clickhouse';
import { clickhouseQuery } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import { organizations, projects } from './db/schema';
import { getPerson } from './persons';
import { deletePersonData, personEvents, setRetention, sweepRetention } from './privacy';
import { createProject } from './projects';
import { createTestDb } from './test-db';

const project = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const other = '6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b';
const now = new Date(Date.UTC(2026, 9, 16, 12, 0));
const DAY = 24 * 60;

const event = (
	distinctId: string,
	name: string,
	minutesAgo: number,
	extra: Partial<TestEvent> = {}
): TestEvent => ({ projectId: project, distinctId, event: name, minutesAgo, ...extra });

let config: ClickHouseConfig;

async function count(where: string): Promise<number> {
	const body = await clickhouseQuery(config, `SELECT count() FROM ${where}`);
	return Number(body.trim());
}

describe.skipIf(!clickhouseTestUrl)('retention and person data', () => {
	beforeAll(async () => {
		config = await createTestDatabase('privacy');
		await insertEvents(
			config,
			[
				event('anon-1', '$pageview', 40 * DAY, { set: { plan: 'free' } }),
				event('user-1', '$identify', 10, {
					properties: { $anon_distinct_id: 'anon-1' },
					set: { email: 'ada@example.com' }
				}),
				event('user-1', 'purchase', 5, { properties: { amount: 12 } }),
				event('bob', '$pageview', 40 * DAY),
				event('bob', '$pageview', 5),
				{ projectId: other, distinctId: 'user-1', event: '$pageview', minutesAgo: 40 * DAY }
			],
			now.getTime()
		);
		await clickhouseQuery(
			config,
			`INSERT INTO cohort_people (project_id, cohort_id, person) VALUES
			('${project}', '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', 'user-1')`
		);
	});

	afterAll(async () => {
		await dropTestDatabase(config);
	});

	it('exports every event of a person across their ids', async () => {
		const person = await getPerson(config, project, 'anon-1');
		expect(person?.distinctIds).toEqual(['user-1', 'anon-1']);
		const exported = await personEvents(config, project, person?.distinctIds ?? []);
		expect(exported.truncated).toBe(false);
		expect(exported.events.map((e) => [e.distinct_id, e.event])).toEqual([
			['anon-1', '$pageview'],
			['user-1', '$identify'],
			['user-1', 'purchase']
		]);
		expect(exported.events[2]?.properties).toEqual({ amount: 12 });
		expect(exported.events[2]?.timestamp).toMatch(/^2026-10-16T11:55:00\.000Z$/);
		const capped = await personEvents(config, project, ['user-1', 'anon-1'], 2);
		expect(capped).toMatchObject({ truncated: true });
		expect(capped.events).toHaveLength(2);
	});

	it('deletes events past a project’s retention only', async () => {
		const swept = await sweepRetention(
			config,
			[
				{ id: project, retentionDays: 30 },
				{ id: other, retentionDays: null }
			],
			now
		);
		expect(swept).toBe(1);
		expect(await count(`events WHERE project_id = '${project}'`)).toBe(3);
		expect(await count(`events WHERE project_id = '${other}'`)).toBe(1);
	});

	it('erases a person and nobody else', async () => {
		const person = await getPerson(config, project, 'user-1');
		if (!person) throw new Error('missing person');
		await deletePersonData(config, project, person.person, person.distinctIds);
		expect(await getPerson(config, project, 'user-1')).toBeNull();
		expect(await getPerson(config, project, 'anon-1')).toBeNull();
		expect(await count(`person_aliases WHERE project_id = '${project}'`)).toBe(0);
		expect(await count(`cohort_people WHERE project_id = '${project}'`)).toBe(0);
		expect(await count(`events WHERE project_id = '${project}'`)).toBe(1);
		expect(await count(`events WHERE project_id = '${other}'`)).toBe(1);
	});
});

describe('retention setting', () => {
	it('stores days or forever', async () => {
		const db = await createTestDb();
		const [org] = await db.insert(organizations).values({ name: 'Acme', slug: 'acme' }).returning();
		const created = await createProject(db, org.id, 'Website');
		await setRetention(db, created.id, 90);
		const read = async () =>
			(await db.select().from(projects).where(eq(projects.id, created.id)))[0]?.retentionDays;
		expect(await read()).toBe(90);
		await setRetention(db, created.id, null);
		expect(await read()).toBeNull();
	});
});
