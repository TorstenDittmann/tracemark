// Server-side flag evaluation: fills in what the caller didn't send (stored person and group
// properties, cohort membership) from ClickHouse, then runs the shared evaluator.
import {
	evaluateAll,
	type FlagContext,
	type FlagDefinition,
	type FlagResult,
	matches,
	type PropertyMatch
} from '@footprint/flags';
import type { CohortSpec } from '../cohorts';
import type { PropertyFilter } from '../insights';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { groupProperties } from './groups';
import { propertiesOf } from './persons';

export interface FlagRequest {
	distinctId: string;
	/** Override or add to the stored person properties. */
	personProperties?: Record<string, unknown>;
	groups?: Record<string, string>;
	/** Override or add to the stored properties of the groups in `groups`. */
	groupProperties?: Record<string, Record<string, unknown>>;
}

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

/** Text of a property value, as ClickHouse reads it for cohort filters. */
function text(value: unknown): string {
	if (value === undefined || value === null) return '';
	return typeof value === 'string' ? value : JSON.stringify(value);
}

function toMatch(filter: PropertyFilter): PropertyMatch {
	return filter.operator === 'is_set' || filter.operator === 'is_not_set'
		? { property: filter.property, operator: filter.operator }
		: { property: filter.property, operator: filter.operator, value: filter.value ?? '' };
}

/** Cohort ids the flags filter on. */
export function referencedCohorts(flags: FlagDefinition[]): string[] {
	const ids = new Set<string>();
	for (const flag of flags) {
		if (!flag.active) continue;
		for (const condition of flag.conditions) {
			for (const filter of condition.filters) {
				if (filter.type === 'cohort') ids.add(filter.cohort);
			}
		}
	}
	return [...ids];
}

/**
 * The full context for a request. `cohorts` holds the cohorts flags refer to; one that's
 * missing (deleted) has no members.
 */
export async function flagContext(
	config: ClickHouseConfig,
	projectId: string,
	request: FlagRequest,
	cohorts: CohortSpec[]
): Promise<FlagContext> {
	const params = { project: projectId, id: request.distinctId };
	const person =
		rows<{ person: string }>(
			await clickhouseQuery(
				config,
				`SELECT person FROM person_distinct_ids
				WHERE project_id = {project:UUID} AND alias = {id:String}
				LIMIT 1
				FORMAT JSONEachRow`,
				{ params }
			)
		)[0]?.person || request.distinctId;

	const groups = Object.entries(request.groups ?? {});
	const staticIds = cohorts.filter((c) => c.kind === 'static').map((c) => c.id);
	const [stored, storedGroups, staticMembership] = await Promise.all([
		propertiesOf(config, projectId, [person]).then((found) => found.get(person) ?? {}),
		Promise.all(
			groups.map(([type, key]) =>
				groupProperties(config, projectId, type, [key]).then(
					(found) => [type, found.get(key) ?? {}] as const
				)
			)
		),
		staticIds.length
			? clickhouseQuery(
					config,
					`SELECT DISTINCT toString(cohort_id) AS cohort FROM cohort_people
					WHERE project_id = {project:UUID} AND person = {person:String}
						AND toString(cohort_id) IN {ids:Array(String)}
					FORMAT JSONEachRow`,
					{ params: { project: projectId, person, ids: staticIds } }
				).then((body) => rows<{ cohort: string }>(body).map((row) => row.cohort))
			: Promise.resolve([])
	]);

	const personProperties = { ...stored, ...request.personProperties };
	const groupProps: Record<string, Record<string, unknown>> = {};
	for (const [type, properties] of storedGroups) {
		groupProps[type] = { ...properties, ...request.groupProperties?.[type] };
	}
	// Property cohorts are decided here from the merged properties, the same way ClickHouse
	// decides them for insights: a property the person doesn't have reads as empty.
	const propertyMembership = cohorts
		.filter((c) => c.kind === 'properties')
		.filter((c) =>
			c.filters.every((filter) => matches(text(personProperties[filter.property]), toMatch(filter)))
		)
		.map((c) => c.id);

	return {
		distinctId: request.distinctId,
		personProperties,
		groups: request.groups ?? {},
		groupProperties: groupProps,
		cohorts: [...staticMembership, ...propertyMembership]
	};
}

/** Every flag's result for a request. */
export async function evaluateFlags(
	config: ClickHouseConfig,
	projectId: string,
	flags: FlagDefinition[],
	request: FlagRequest,
	cohorts: CohortSpec[]
): Promise<Record<string, FlagResult>> {
	const context = await flagContext(config, projectId, request, cohorts);
	return evaluateAll(flags, context).results;
}
