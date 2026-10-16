import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER
} from '$app/env/private';
import type { ClickHouseConfig } from './clickhouse';
import * as events from './events';
import * as explore from './explore';
import * as insights from './insights';
import * as persons from './persons';
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
export type { PersonDetail } from './persons';
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

export const recentEvents = (
	projectId: string,
	query: Parameters<typeof explore.recentEvents>[2],
	options?: Parameters<typeof explore.recentEvents>[3]
) => explore.recentEvents(config(), projectId, query, options);

export const eventDefinitions = (projectId: string) =>
	explore.eventDefinitions(config(), projectId);

export const propertyDefinitions = (projectId: string, event?: string) =>
	explore.propertyDefinitions(config(), projectId, { event });

export const listPersons = (
	projectId: string,
	options?: Parameters<typeof persons.listPersons>[2]
) => persons.listPersons(config(), projectId, options);

export const getPerson = (projectId: string, distinctId: string) =>
	persons.getPerson(config(), projectId, distinctId);
