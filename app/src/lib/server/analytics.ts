import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER
} from '$app/env/private';
import type { ClickHouseConfig } from './clickhouse';
import * as events from './events';
import * as insights from './insights';
import * as web from './web';

export type { EventStats } from './events';
export type {
	EventName,
	FunnelResult,
	PropertyName,
	RetentionResult,
	TrendsResult
} from './insights';
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

export const trends = (projectId: string, query: Parameters<typeof insights.trends>[2]) =>
	insights.trends(config(), projectId, query);

export const eventNames = (projectId: string) => insights.eventNames(config(), projectId);

export const propertyNames = (projectId: string) => insights.propertyNames(config(), projectId);

export const funnel = (projectId: string, query: Parameters<typeof insights.funnel>[2]) =>
	insights.funnel(config(), projectId, query);

export const retention = (projectId: string, query: Parameters<typeof insights.retention>[2]) =>
	insights.retention(config(), projectId, query);
