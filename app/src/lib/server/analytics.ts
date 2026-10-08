import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER
} from '$app/env/private';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';

function config(): ClickHouseConfig {
	return {
		url: CLICKHOUSE_URL,
		user: CLICKHOUSE_USER,
		password: CLICKHOUSE_PASSWORD,
		database: CLICKHOUSE_DATABASE
	};
}

export interface EventStats {
	last24h: number;
	lastEventAt: string | null;
}

export async function projectEventStats(projectId: string): Promise<EventStats> {
	const body = await clickhouseQuery(
		config(),
		`SELECT
			countIf(timestamp > now() - INTERVAL 1 DAY) AS last24h,
			if(count() = 0, NULL, formatDateTime(max(timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC')) AS lastEventAt
		FROM events WHERE project_id = {project:UUID}
		FORMAT JSONEachRow`,
		{ params: { project: projectId } }
	);
	const row = JSON.parse(body) as { last24h: string | number; lastEventAt: string | null };
	return { last24h: Number(row.last24h), lastEventAt: row.lastEventAt };
}

/** Removes a deleted project's events. Lightweight delete: rows disappear from queries at once, from disk on merge. */
export async function deleteProjectEvents(projectId: string): Promise<void> {
	await clickhouseQuery(config(), 'DELETE FROM events WHERE project_id = {project:UUID}', {
		params: { project: projectId }
	});
}
