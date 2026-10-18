// Helpers for specs that run against a real ClickHouse (CLICKHOUSE_TEST_URL).
import { resolve } from 'node:path';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { migrateClickhouse } from './migrate';

export const clickhouseTestUrl = process.env.CLICKHOUSE_TEST_URL;

/** Creates a fresh, migrated database for one spec file. */
export async function createTestDatabase(name: string): Promise<ClickHouseConfig> {
	const config = {
		url: clickhouseTestUrl ?? '',
		user: process.env.CLICKHOUSE_TEST_USER ?? 'default',
		password: process.env.CLICKHOUSE_TEST_PASSWORD ?? '',
		database: `tracemark_test_${name}_${Date.now()}`
	};
	await migrateClickhouse(
		config,
		resolve(import.meta.dirname, '../../../../clickhouse/migrations')
	);
	return config;
}

export async function dropTestDatabase(config: ClickHouseConfig | undefined): Promise<void> {
	if (config)
		await clickhouseQuery(config, `DROP DATABASE IF EXISTS ${config.database}`, {
			database: null
		});
}

export interface TestEvent {
	distinctId: string;
	event: string;
	/** Event time as an offset from `now`. */
	minutesAgo: number;
	projectId: string;
	sessionId?: string;
	properties?: object;
	set?: object;
	setOnce?: object;
	groups?: Record<string, string>;
	/** When ClickHouse stored the event, as an offset from `now`; the real time when unset. */
	insertedMinutesAgo?: number;
}

let seq = 0;

const chDate = (ms: number) => new Date(ms).toISOString().replace('Z', '');

export async function insertEvents(
	config: ClickHouseConfig,
	events: TestEvent[],
	now = Date.now()
): Promise<void> {
	const stored = events.some((e) => e.insertedMinutesAgo !== undefined);
	const rows = events.map((e) => {
		seq += 1;
		return JSON.stringify({
			uuid: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
			project_id: e.projectId,
			event: e.event,
			timestamp: chDate(now - e.minutesAgo * 60_000),
			distinct_id: e.distinctId,
			session_id: e.sessionId ?? '',
			properties: e.properties ?? {},
			person_set: e.set ?? {},
			person_set_once: e.setOnce ?? {},
			groups: e.groups ?? {},
			...(stored ? { inserted_at: chDate(now - (e.insertedMinutesAgo ?? 0) * 60_000) } : {})
		});
	});
	await clickhouseQuery(
		config,
		`INSERT INTO events (uuid, project_id, event, timestamp, distinct_id, session_id, properties, person_set, person_set_once, groups${stored ? ', inserted_at' : ''})
		FORMAT JSONEachRow\n${rows.join('\n')}`
	);
}
