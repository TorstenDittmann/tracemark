import { evaluateAll } from '@tracemark/flags';
import {
	CLICKHOUSE_DATABASE,
	CLICKHOUSE_PASSWORD,
	CLICKHOUSE_URL,
	CLICKHOUSE_USER,
	PUBLIC_URL
} from '$app/env/private';
import type { CohortSpec } from '../cohorts';
import type { InternalRule } from '../internal-users';
import * as ai from './ai';
import * as alertChecks from './alert-checks';
import { type AlertChecks, startAlertScheduler } from './alert-scheduler';
import type { ClickHouseConfig } from './clickhouse';
import * as cohortPeople from './cohort-people';
import { cohortSpec, getCohort, listCohorts } from './cohorts';
import { getDb } from './db/index';
import { projects as projectsTable } from './db/schema';
import * as events from './events';
import * as experimentResults from './experiment-results';
import * as explore from './explore';
import * as flagEvaluation from './flag-evaluation';
import { projectFlags } from './flags';
import * as groups from './groups';
import * as heatmaps from './heatmaps';
import * as insights from './insights';
import * as issues from './issues';
import * as mockData from './mock-data';
import * as persons from './persons';
import * as privacy from './privacy';
import { internalUsers } from './projects';
import { type SavedQuery, withFilterInternal } from './saved';
import * as usage from './usage';
import * as web from './web';

export type { AiOverview, TraceFilter, TraceSummary } from './ai';
export type { EventStats } from './events';
export type { GroupDetail } from './groups';
export type { Heatmap, HeatmapPage } from './heatmaps';
export type {
	EventName,
	FunnelResult,
	LifecycleResult,
	PathsResult,
	PropertyName,
	RetentionResult,
	StickinessResult,
	TrendsResult
} from './insights';
export type { IssueDetail, IssueList, IssueSummary } from './issues';
export type { PersonDetail } from './persons';
export type { StorageUsage, UsageVolume } from './usage';
export type { WebAnalytics, WebVitals } from './web';

export type SavedResult =
	| (Extract<SavedQuery, { kind: 'trends' }> & { result: insights.TrendsResult })
	| (Extract<SavedQuery, { kind: 'funnel' }> & { result: insights.FunnelResult })
	| (Extract<SavedQuery, { kind: 'retention' }> & { result: insights.RetentionResult })
	| (Extract<SavedQuery, { kind: 'paths' }> & { result: insights.PathsResult })
	| (Extract<SavedQuery, { kind: 'lifecycle' }> & { result: insights.LifecycleResult })
	| (Extract<SavedQuery, { kind: 'stickiness' }> & { result: insights.StickinessResult });

/** The cohort an insight narrows to. A deleted cohort matches nobody rather than everybody. */
export async function cohortFor(projectId: string, id?: string): Promise<CohortSpec | undefined> {
	if (!id) return undefined;
	const cohort = await getCohort(getDb(), projectId, id);
	return cohort ? cohortSpec(cohort) : { kind: 'static', id };
}

/**
 * The internal user rules a query leaves out: the project's, when `filter` says so or, without
 * it, the project's setting does. Undefined when nothing is left out.
 */
export async function internalFor(
	projectId: string,
	filter?: boolean
): Promise<InternalRule[] | undefined> {
	const internal = await internalUsers(getDb(), projectId);
	return (filter ?? internal.filter) && internal.rules.length ? internal.rules : undefined;
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

// Usage counts everything stored, internal users included, since it is about volume and disk.

export const usageVolume = (
	projectIds: string[],
	options: Parameters<typeof usage.usageVolume>[2]
) => usage.usageVolume(config(), projectIds, options);

export const storageUsage = (projectIds: string[]) => usage.storageUsage(config(), projectIds);

export const deleteProjectEvents = (projectId: string) =>
	events.deleteProjectEvents(config(), projectId);

/** Fills a project with a month of mock data; adding again replaces it. Returns the event count. */
export const addMockData = (projectId: string, userId: string) =>
	mockData.addMockData(getDb(), config(), projectId, userId);

export const removeMockData = (projectId: string) =>
	mockData.removeMockData(getDb(), config(), projectId);

export const personEvents = (projectId: string, distinctIds: string[]) =>
	privacy.personEvents(config(), projectId, distinctIds);

export const deletePersonData = (projectId: string, person: string, distinctIds: string[]) =>
	privacy.deletePersonData(config(), projectId, person, distinctIds);

/** Deletes events past each project's retention now, then every few hours. Returns a stop function. */
export function startRetentionSweeps(): () => void {
	const sweep = async () => {
		try {
			const list = await getDb()
				.select({ id: projectsTable.id, retentionDays: projectsTable.retentionDays })
				.from(projectsTable);
			const swept = await privacy.sweepRetention(config(), list);
			if (swept) console.log(`retention: removed old events in ${swept} project(s)`);
		} catch (err) {
			console.error('retention sweep failed:', err);
		}
	};
	const first = setTimeout(sweep, 60_000);
	const timer = setInterval(sweep, privacy.SWEEP_EVERY_MS);
	return () => {
		clearTimeout(first);
		clearInterval(timer);
	};
}

/** The alert checks, against the app's ClickHouse, leaving out internal users as the project says. */
export function alertChecksFor(): AlertChecks {
	return {
		newIssues: async (projectId, from, to) =>
			alertChecks.newIssues(config(), projectId, from, to, await internalFor(projectId)),
		regressedIssues: async (projectId, resolved, from, to) =>
			alertChecks.regressedIssues(
				config(),
				projectId,
				resolved,
				from,
				to,
				await internalFor(projectId)
			),
		eventCount: async (projectId, event, from, to) =>
			alertChecks.eventCount(config(), projectId, event, from, to, await internalFor(projectId)),
		aiCost: async (projectId, from, to) =>
			alertChecks.aiCost(config(), projectId, from, to, await internalFor(projectId))
	};
}

/** Checks alert rules every minute (see docs/alerts.md). Returns a stop function. */
export const startAlerts = () =>
	startAlertScheduler(getDb, alertChecksFor(), { baseUrl: PUBLIC_URL });

// Web analytics, experiments, issues and AI leave out internal users whenever the project does.

export const webAnalytics = async (
	projectId: string,
	options: Parameters<typeof web.webAnalytics>[2]
) => web.webAnalytics(config(), projectId, { ...options, internal: await internalFor(projectId) });

export const webVitals = async (projectId: string, options: Parameters<typeof web.webVitals>[2]) =>
	web.webVitals(config(), projectId, { ...options, internal: await internalFor(projectId) });

export const heatmapPages = async (
	projectId: string,
	options: Parameters<typeof heatmaps.heatmapPages>[2]
) =>
	heatmaps.heatmapPages(config(), projectId, {
		...options,
		internal: await internalFor(projectId)
	});

export const heatmap = async (projectId: string, options: Parameters<typeof heatmaps.heatmap>[2]) =>
	heatmaps.heatmap(config(), projectId, { ...options, internal: await internalFor(projectId) });

// Insights follow their own `filterInternal`, else the project's setting.

export const trends = async (projectId: string, query: Parameters<typeof insights.trends>[2]) =>
	insights.trends(
		config(),
		projectId,
		query,
		undefined,
		await cohortFor(projectId, query.cohort),
		await internalFor(projectId, query.filterInternal)
	);

export const eventNames = (projectId: string) => insights.eventNames(config(), projectId);

export const propertyNames = (projectId: string) => insights.propertyNames(config(), projectId);

export const pagePaths = (projectId: string) => insights.pagePaths(config(), projectId);

export const funnel = async (projectId: string, query: Parameters<typeof insights.funnel>[2]) =>
	insights.funnel(
		config(),
		projectId,
		query,
		undefined,
		await cohortFor(projectId, query.cohort),
		await internalFor(projectId, query.filterInternal)
	);

export const retention = async (
	projectId: string,
	query: Parameters<typeof insights.retention>[2]
) =>
	insights.retention(
		config(),
		projectId,
		query,
		undefined,
		await cohortFor(projectId, query.cohort),
		await internalFor(projectId, query.filterInternal)
	);

export const paths = async (projectId: string, query: Parameters<typeof insights.paths>[2]) =>
	insights.paths(
		config(),
		projectId,
		query,
		undefined,
		await cohortFor(projectId, query.cohort),
		await internalFor(projectId, query.filterInternal)
	);

export const lifecycle = async (
	projectId: string,
	query: Parameters<typeof insights.lifecycle>[2]
) =>
	insights.lifecycle(
		config(),
		projectId,
		query,
		undefined,
		await cohortFor(projectId, query.cohort),
		await internalFor(projectId, query.filterInternal)
	);

export const stickiness = async (
	projectId: string,
	query: Parameters<typeof insights.stickiness>[2]
) =>
	insights.stickiness(
		config(),
		projectId,
		query,
		undefined,
		await cohortFor(projectId, query.cohort),
		await internalFor(projectId, query.filterInternal)
	);

/**
 * Runs a saved insight's query; the result type follows its kind. The query comes back with
 * `filterInternal` set to what applied.
 */
export async function runSaved(projectId: string, query: SavedQuery): Promise<SavedResult> {
	const saved =
		query.query.filterInternal === undefined
			? withFilterInternal(query, (await internalUsers(getDb(), projectId)).filter)
			: query;
	switch (saved.kind) {
		case 'trends':
			return { ...saved, result: await trends(projectId, saved.query) };
		case 'funnel':
			return { ...saved, result: await funnel(projectId, saved.query) };
		case 'retention':
			return { ...saved, result: await retention(projectId, saved.query) };
		case 'paths':
			return { ...saved, result: await paths(projectId, saved.query) };
		case 'lifecycle':
			return { ...saved, result: await lifecycle(projectId, saved.query) };
		case 'stickiness':
			return { ...saved, result: await stickiness(projectId, saved.query) };
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

/**
 * Every flag of a project evaluated for one request. When ClickHouse can't be reached, flags
 * are evaluated from what the request sent alone, with no cohort members.
 */
export async function evaluateProjectFlags(projectId: string, request: flagEvaluation.FlagRequest) {
	const db = getDb();
	const flags = await projectFlags(db, projectId);
	const referenced = new Set(flagEvaluation.referencedCohorts(flags));
	const cohorts = referenced.size
		? (await listCohorts(db, projectId)).filter((c) => referenced.has(c.id)).map(cohortSpec)
		: [];
	try {
		return await flagEvaluation.evaluateFlags(config(), projectId, flags, request, cohorts);
	} catch (err) {
		console.error('flags evaluated without stored properties:', err);
		return evaluateAll(flags, {
			distinctId: request.distinctId,
			personProperties: request.personProperties,
			groups: request.groups,
			groupProperties: request.groupProperties,
			cohorts: []
		}).results;
	}
}

export const experimentCounts = async (
	projectId: string,
	query: Parameters<typeof experimentResults.experimentCounts>[2]
) =>
	experimentResults.experimentCounts(config(), projectId, {
		...query,
		internal: await internalFor(projectId)
	});

export const listIssues = async (
	projectId: string,
	options: Parameters<typeof issues.listIssues>[2]
) => issues.listIssues(config(), projectId, { ...options, internal: await internalFor(projectId) });

export const issueDetail = async (
	projectId: string,
	fingerprint: string,
	options: Parameters<typeof issues.issueDetail>[3]
) =>
	issues.issueDetail(config(), projectId, fingerprint, {
		...options,
		internal: await internalFor(projectId)
	});

export const aiOverview = async (projectId: string, options: Parameters<typeof ai.aiOverview>[2]) =>
	ai.aiOverview(config(), projectId, { ...options, internal: await internalFor(projectId) });

export const listTraces = async (projectId: string, options: Parameters<typeof ai.listTraces>[2]) =>
	ai.listTraces(config(), projectId, { ...options, internal: await internalFor(projectId) });

export const traceEvents = (projectId: string, traceId: string) =>
	ai.traceEvents(config(), projectId, traceId);

export const scoreNames = (projectId: string, options: Parameters<typeof ai.scoreNames>[2]) =>
	ai.scoreNames(config(), projectId, options);

export const traceScores = (projectId: string, traceId: string) =>
	ai.traceScores(config(), projectId, traceId);
