import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER
} from '$app/env/private';
import type { CohortSpec } from '../cohorts';
import type { ClickHouseConfig } from './clickhouse';
import * as cohortPeople from './cohort-people';
import { cohortSpec, getCohort } from './cohorts';
import { getDb } from './db/index';
import * as events from './events';
import * as explore from './explore';
import * as groups from './groups';
import * as insights from './insights';
import * as persons from './persons';
import type { SavedQuery } from './saved';
import * as web from './web';

export type { EventStats } from './events';
export type { GroupDetail } from './groups';
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

/** The cohort an insight narrows to. A deleted cohort matches nobody rather than everybody. */
export async function cohortFor(projectId: string, id?: string): Promise<CohortSpec | undefined> {
	if (!id) return undefined;
	const cohort = await getCohort(getDb(), projectId, id);
	return cohort ? cohortSpec(cohort) : { kind: 'static', id };
}

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

export const trends = async (projectId: string, query: Parameters<typeof insights.trends>[2]) =>
	insights.trends(config(), projectId, query, undefined, await cohortFor(projectId, query.cohort));

export const eventNames = (projectId: string) => insights.eventNames(config(), projectId);

export const propertyNames = (projectId: string) => insights.propertyNames(config(), projectId);

export const funnel = async (projectId: string, query: Parameters<typeof insights.funnel>[2]) =>
	insights.funnel(config(), projectId, query, undefined, await cohortFor(projectId, query.cohort));

export const retention = async (
	projectId: string,
	query: Parameters<typeof insights.retention>[2]
) =>
	insights.retention(
		config(),
		projectId,
		query,
		undefined,
		await cohortFor(projectId, query.cohort)
	);

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

export const groupTypes = (projectId: string) => groups.groupTypes(config(), projectId);

export const listGroups = (
	projectId: string,
	type: string,
	options?: Parameters<typeof groups.listGroups>[3]
) => groups.listGroups(config(), projectId, type, options);

export const getGroup = (projectId: string, type: string, key: string) =>
	groups.getGroup(config(), projectId, type, key);

export const cohortSize = (projectId: string, cohort: CohortSpec) =>
	cohortPeople.cohortSize(config(), projectId, cohort);

export const addCohortPeople = (projectId: string, cohortId: string, distinctIds: string[]) =>
	cohortPeople.addCohortPeople(config(), projectId, cohortId, distinctIds);

export const removeCohortPerson = (projectId: string, cohortId: string, person: string) =>
	cohortPeople.removeCohortPerson(config(), projectId, cohortId, person);

export const deleteCohortPeople = (projectId: string, cohortId: string) =>
	cohortPeople.deleteCohortPeople(config(), projectId, cohortId);

export const personPropertyNames = (projectId: string) =>
	persons.personPropertyNames(config(), projectId);
