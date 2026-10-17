// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClickHouseConfig } from './clickhouse';
import { clickhouseQuery } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents
} from './clickhouse-test';
import { recentEvents } from './explore';
import { getGroup, groupTypes, listGroups } from './groups';
import { migrateClickhouse } from './migrate';

const project = '99999999-9999-4999-8999-999999999999';
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));
const acme = { company: 'acme' };

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('groups in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('groups');
		await insertEvents(
			config,
			[
				{
					projectId: project,
					distinctId: 'ada',
					event: '$groupidentify',
					minutesAgo: 120,
					properties: {
						$group_type: 'company',
						$group_key: 'acme',
						$group_set: { name: 'Acme Inc', seats: 5 }
					},
					groups: acme
				},
				// A later update wins.
				{
					projectId: project,
					distinctId: 'ada',
					event: '$groupidentify',
					minutesAgo: 60,
					properties: { $group_type: 'company', $group_key: 'acme', $group_set: { seats: 12 } },
					groups: acme
				},
				{
					projectId: project,
					distinctId: 'ada',
					event: 'purchase',
					minutesAgo: 30,
					groups: { ...acme, team: 'design' }
				},
				{
					projectId: project,
					distinctId: 'anon-grace',
					event: '$pageview',
					minutesAgo: 20,
					groups: acme
				},
				{
					projectId: project,
					distinctId: 'grace',
					event: '$identify',
					minutesAgo: 15,
					properties: { $anon_distinct_id: 'anon-grace' },
					groups: acme
				},
				{
					projectId: project,
					distinctId: 'bob',
					event: '$pageview',
					minutesAgo: 10,
					groups: { company: 'globex' }
				},
				// No group at all.
				{ projectId: project, distinctId: 'eve', event: '$pageview', minutesAgo: 5 }
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('lists group types with their counts', async () => {
		expect(await groupTypes(config, project, now)).toEqual([
			{ type: 'company', groups: 2, events: 6 },
			{ type: 'team', groups: 1, events: 1 }
		]);
	});

	it('lists groups of a type, most recently seen first, with properties', async () => {
		const page = await listGroups(config, project, 'company', { now });
		expect(page.next).toBeNull();
		expect(page.groups).toEqual([
			{
				key: 'globex',
				events: 1,
				people: 1,
				firstSeen: '2026-10-16T12:20:00.000Z',
				lastSeen: '2026-10-16T12:20:00.000Z',
				properties: {}
			},
			{
				key: 'acme',
				events: 5,
				// Grace's anonymous and identified events count once.
				people: 2,
				firstSeen: '2026-10-16T10:30:00.000Z',
				lastSeen: '2026-10-16T12:15:00.000Z',
				properties: { name: 'Acme Inc', seats: 12 }
			}
		]);
	});

	it('pages and searches groups', async () => {
		const first = await listGroups(config, project, 'company', { now, limit: 1 });
		expect(first.groups.map((g) => g.key)).toEqual(['globex']);
		const second = await listGroups(config, project, 'company', {
			now,
			limit: 1,
			before: first.next ?? undefined
		});
		expect(second.groups.map((g) => g.key)).toEqual(['acme']);
		expect(second.next).toBeNull();
		const byName = await listGroups(config, project, 'company', { now, search: 'acme inc' });
		expect(byName.groups.map((g) => g.key)).toEqual(['acme']);
		const byKey = await listGroups(config, project, 'company', { now, search: 'GLOB' });
		expect(byKey.groups.map((g) => g.key)).toEqual(['globex']);
	});

	it('shows one group with its members', async () => {
		const group = await getGroup(config, project, 'company', 'acme');
		expect(group).toMatchObject({
			type: 'company',
			key: 'acme',
			events: 5,
			people: 2,
			properties: { name: 'Acme Inc', seats: 12 }
		});
		expect(group?.members.map((m) => [m.person, m.events])).toEqual([
			['ada', 3],
			['grace', 2]
		]);
		expect(await getGroup(config, project, 'company', 'initech')).toBeNull();
	});

	it("shows a group's timeline", async () => {
		const timeline = await recentEvents(
			config,
			project,
			{ filters: [] },
			{ now, group: { type: 'company', key: 'acme' } }
		);
		expect(timeline.events.map((e) => e.event)).toEqual([
			'$identify',
			'$pageview',
			'purchase',
			'$groupidentify',
			'$groupidentify'
		]);
	});
});

describe.skipIf(!clickhouseTestUrl)('groups migration', () => {
	let upgraded: ClickHouseConfig | undefined;
	afterAll(() => dropTestDatabase(upgraded));

	it('backfills group properties from events sent before it', async () => {
		const all = resolve(import.meta.dirname, '../../../../clickhouse/migrations');
		const before = await mkdtemp(join(tmpdir(), 'tracemark-migrations-'));
		for (const file of await readdir(all)) {
			if (file < '0003_groups.sql') await copyFile(join(all, file), join(before, file));
		}
		upgraded = {
			url: clickhouseTestUrl ?? '',
			user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
			password: process.env.CLICKHOUSE_TEST_PASSWORD ?? '',
			database: `tracemark_test_groups_upgrade_${Date.now()}`
		};
		await migrateClickhouse(upgraded, before);
		await insertEvents(
			upgraded,
			[
				{
					projectId: project,
					distinctId: 'ada',
					event: '$groupidentify',
					minutesAgo: 10,
					properties: { $group_type: 'company', $group_key: 'acme', $group_set: { name: 'Acme' } },
					groups: acme
				}
			],
			now.getTime()
		);
		expect(await migrateClickhouse(upgraded, all)).toContain('0003_groups.sql');
		const body = await clickhouseQuery(
			upgraded,
			`SELECT key, value FROM groups_properties FORMAT JSONEachRow`
		);
		expect(body.trim()).toBe('{"key":"name","value":"\\"Acme\\""}');
	});
});
