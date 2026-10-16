import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER
} from '$app/env/private';
import type { ClickHouseConfig } from './clickhouse';
import * as events from './events';
import * as web from './web';

export type { EventStats } from './events';
export type { WebAnalytics } from './web';

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

export const webAnalytics = (projectId: string, options: Parameters<typeof web.webAnalytics>[2]) =>
	web.webAnalytics(config(), projectId, options);
