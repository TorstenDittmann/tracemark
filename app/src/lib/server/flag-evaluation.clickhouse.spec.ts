// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { type FlagDefinition, parseFlag } from '@footprint/flags';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CohortSpec } from '../cohorts';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents
} from './clickhouse-test';
import { addCohortPeople } from './cohort-people';
import { evaluateFlags, flagContext, referencedCohorts } from './flag-evaluation';

const project = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const vips = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const pros = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));

const cohorts: CohortSpec[] = [
	{ kind: 'static', id: vips },
	{ kind: 'properties', id: pros, filters: [{ property: 'plan', operator: 'eq', value: 'pro' }] }
];

const flag = (key: string, filters: unknown[], extra: object = {}): FlagDefinition =>
	parseFlag({ key, active: true, conditions: [{ filters, rollout: 100 }], ...extra });

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('flag evaluation with ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('flags');
		await insertEvents(
			config,
			[
				{ projectId: project, distinctId: 'anon-ada', event: '$pageview', minutesAgo: 60 },
				{
					projectId: project,
					distinctId: 'ada',
					event: '$identify',
					minutesAgo: 50,
					properties: { $anon_distinct_id: 'anon-ada' },
					set: { plan: 'pro', seats: 12 }
				},
				{
					projectId: project,
					distinctId: 'ada',
					event: '$groupidentify',
					minutesAgo: 40,
					properties: { $group_type: 'company', $group_key: 'acme', $group_set: { tier: 'gold' } }
				},
				{ projectId: project, distinctId: 'bob', event: '$pageview', minutesAgo: 30 }
			],
			now.getTime()
		);
		await addCohortPeople(config, project, vips, ['bob']);
	});

	afterAll(() => dropTestDatabase(config));

	it('fills in stored properties, groups and cohorts for an anonymous id', async () => {
		const context = await flagContext(
			config,
			project,
			{ distinctId: 'anon-ada', groups: { company: 'acme' } },
			cohorts
		);
		expect(context).toEqual({
			distinctId: 'anon-ada',
			personProperties: { plan: 'pro', seats: 12 },
			groups: { company: 'acme' },
			groupProperties: { company: { tier: 'gold' } },
			cohorts: [pros]
		});
	});

	it('lets the request override stored properties', async () => {
		const context = await flagContext(
			config,
			project,
			{
				distinctId: 'bob',
				personProperties: { plan: 'pro' },
				groups: { company: 'initech' },
				groupProperties: { company: { tier: 'silver' } }
			},
			cohorts
		);
		expect(context.personProperties).toEqual({ plan: 'pro' });
		expect(context.groupProperties).toEqual({ company: { tier: 'silver' } });
		expect(context.cohorts?.sort()).toEqual([vips, pros].sort());
	});

	it('reads inherited names like constructor as missing in property cohorts', async () => {
		const inherited = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
		const unset = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
		const context = await flagContext(config, project, { distinctId: 'bob' }, [
			{
				kind: 'properties',
				id: inherited,
				filters: [{ property: 'constructor', operator: 'contains', value: 'Object' }]
			},
			{ kind: 'properties', id: unset, filters: [{ property: 'toString', operator: 'is_not_set' }] }
		]);
		expect(context.cohorts).toEqual([unset]);
	});

	it('evaluates flags against it', async () => {
		const flags = [
			flag('pro', [{ type: 'person', property: 'plan', operator: 'eq', value: 'pro' }]),
			flag('vip', [{ type: 'cohort', cohort: vips }]),
			flag('pros', [{ type: 'cohort', cohort: pros }]),
			flag('deleted-cohort', [{ type: 'cohort', cohort: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }]),
			flag(
				'gold',
				[{ type: 'group', groupType: 'company', property: 'tier', operator: 'eq', value: 'gold' }],
				{ groupType: 'company' }
			)
		];
		const known = cohorts.filter((c) => referencedCohorts(flags).includes(c.id));
		const values = async (distinctId: string, groups?: Record<string, string>) =>
			Object.fromEntries(
				Object.entries(
					await evaluateFlags(config, project, flags, { distinctId, groups }, known)
				).map(([key, result]) => [key, result.value])
			);
		expect(await values('ada', { company: 'acme' })).toEqual({
			pro: true,
			vip: false,
			pros: true,
			'deleted-cohort': false,
			gold: true
		});
		expect(await values('bob')).toEqual({
			pro: false,
			vip: true,
			pros: false,
			'deleted-cohort': false,
			gold: false
		});
	});
});
