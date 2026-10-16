import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER
} from '$app/env/private';
import type { ClickHouseConfig } from './clickhouse';
import * as events from './events';
import * as insights from './insights';
import type { SavedQuery } from './saved';
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

export type SavedResult =
	| (Extract<SavedQuery, { kind: 'trends' }> & { result: insights.TrendsResult })
	| (Extract<SavedQuery, { kind: 'funnel' }> & { result: insights.FunnelResult })
	| (Extract<SavedQuery, { kind: 'retention' }> & { result: insights.RetentionResult });

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

/** Runs a saved insight's query; the result type follows its kind. */
export async function runSaved(projectId: string, saved: SavedQuery): Promise<SavedResult> {
	switch (saved.kind) {
		case 'trends':
			return { ...saved, result: await trends(projectId, saved.query) };
		case 'funnel':
			return { ...saved, result: await funnel(projectId, saved.query) };
		case 'retention':
			return { ...saved, result: await retention(projectId, saved.query) };
	}
}
