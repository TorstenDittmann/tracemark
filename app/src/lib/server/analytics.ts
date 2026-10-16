import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER
} from '$app/env/private';
import type { ClickHouseConfig } from './clickhouse';
import * as events from './events';

export type { EventStats } from './events';

function config(): ClickHouseConfig {
	return {
		url: CLICKHOUSE_URL,
		user: CLICKHOUSE_USER,
		password: CLICKHOUSE_PASSWORD,
		database: CLICKHOUSE_DATABASE
	};
}

export const projectEventStats = (projectId: string) =>
	events.projectEventStats(config(), projectId);

export const deleteProjectEvents = (projectId: string) =>
	events.deleteProjectEvents(config(), projectId);
