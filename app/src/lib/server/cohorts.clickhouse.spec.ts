// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CohortSpec } from '../cohorts';
import { DEFAULT_TRENDS, type PropertyFilter } from '../insights';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import {
	addCohortPeople,
	cohortSize,
	deleteCohortPeople,
	removeCohortPerson
} from './cohort-people';
import { funnel, retention, trends } from './insights';
import { listPersons } from './persons';

const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vips = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));

const view = (
	distinctId: string,
	minutesAgo: number,
	extra: Partial<TestEvent> = {}
): TestEvent => ({
	projectId: project,
	distinctId,
	event: '$pageview',
	minutesAgo,
	...extra
});

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('cohorts in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('cohorts');
		await insertEvents(
			config,
			[
				view('anon-ada', 300),
				view('ada', 200, {
					event: '$identify',
					properties: { $anon_distinct_id: 'anon-ada' },
					set: { plan: 'pro', seats: 12, email: 'ada@example.com' }
				}),
				view('ada', 100),
				view('grace', 90, { set: { plan: 'pro', seats: 3 } }),
				view('bob', 80, { set: { plan: 'free' } }),
				view('eve', 70)
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	const total = async (cohort?: CohortSpec) =>
		(await trends(config, project, { ...DEFAULT_TRENDS, range: '24h' }, now, cohort)).lines[0]
			.total;

	it('keeps a static list, resolving anonymous ids to their person', async () => {
		const cohort: CohortSpec = { kind: 'static', id: vips };
		await addCohortPeople(config, project, vips, ['anon-ada', 'bob', 'bob']);
		expect(await cohortSize(config, project, cohort)).toBe(2);
		// Ada's anonymous and identified page views both count.
		expect(await total(cohort)).toBe(3);
		expect(await total()).toBe(5);

		await removeCohortPerson(config, project, vips, 'bob');
		expect(await cohortSize(config, project, cohort)).toBe(1);
		expect(await total(cohort)).toBe(2);

		await deleteCohortPeople(config, project, vips);
		expect(await cohortSize(config, project, cohort)).toBe(0);
		expect(await total(cohort)).toBe(0);
	});

	it('matches people by person properties', async () => {
		const cohort = (filters: PropertyFilter[]): CohortSpec => ({
			kind: 'properties',
			id: vips,
			filters
		});
		const pro = cohort([{ property: 'plan', operator: 'eq', value: 'pro' }]);
		expect(await cohortSize(config, project, pro)).toBe(2);
		expect(await total(pro)).toBe(3);
		const big = cohort([
			{ property: 'plan', operator: 'eq', value: 'pro' },
			{ property: 'seats', operator: 'gt', value: '5' }
		]);
		expect(await cohortSize(config, project, big)).toBe(1);
		const withEmail = cohort([{ property: 'email', operator: 'contains', value: 'EXAMPLE' }]);
		expect(await cohortSize(config, project, withEmail)).toBe(1);
		const noSeats = cohort([{ property: 'seats', operator: 'is_not_set' }]);
		expect(await cohortSize(config, project, noSeats)).toBe(1);

		const people = await listPersons(config, project, { now, cohort: pro });
		expect(people.persons.map((p) => p.person)).toEqual(['grace', 'ada']);
	});

	it('narrows funnels and retention too', async () => {
		const pro: CohortSpec = {
			kind: 'properties',
			id: vips,
			filters: [{ property: 'plan', operator: 'eq', value: 'pro' }]
		};
		const steps = await funnel(
			config,
			project,
			{ steps: ['$pageview', '$pageview'], window: '1d', range: '7d', filters: [] },
			now,
			pro
		);
		// One page view can't be both steps: Grace enters with her only one, Ada converts.
		expect(steps.total.counts).toEqual([2, 1]);
		const kept = await retention(
			config,
			project,
			{ start: '$pageview', returning: '$pageview', range: '7d', filters: [] },
			now,
			pro
		);
		expect(kept.cohorts.reduce((sum, c) => sum + c.size, 0)).toBe(2);
	});
});
