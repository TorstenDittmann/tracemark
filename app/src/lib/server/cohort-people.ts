// Cohort membership in ClickHouse: static members in `cohort_people`, property cohorts from
// merged person properties.
import type { CohortSpec } from '../cohorts';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { compareSql } from './compare';

/** A person property's value as text: JSON strings unquoted, anything else as raw JSON. */
const TEXT = `if(JSONType(value) = 'String', JSONExtractString(value), value)`;

/**
 * A subquery selecting the person keys in a cohort. Adds its parameters to `params`, which must
 * already hold `project`. A properties cohort matches people whose merged person properties pass
 * every filter; a missing property reads as empty.
 */
export function cohortPeopleSql(cohort: CohortSpec, params: Record<string, string>): string {
	params.cohort = cohort.id;
	if (cohort.kind === 'static') {
		return `SELECT person FROM cohort_people
			WHERE project_id = {project:UUID} AND cohort_id = {cohort:UUID}`;
	}
	// Everyone seen in events, so people with no person properties count too.
	const everyone = `SELECT DISTINCT if(a.person = '', e.distinct_id, a.person) AS person
		FROM events AS e
		LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
			ON a.alias = e.distinct_id
		WHERE e.project_id = {project:UUID}`;
	if (!cohort.filters.length) return everyone;
	const conditions = cohort.filters.map((filter, i) => {
		params[`ck${i}`] = filter.property;
		if (filter.value !== undefined) params[`cv${i}`] = filter.value;
		return compareSql(`anyIf(${TEXT}, key = {ck${i}:String})`, filter.operator, `cv${i}`);
	});
	return `SELECT p.person AS person
		FROM (${everyone}) AS p
		LEFT JOIN (SELECT person, key, value FROM persons_properties WHERE project_id = {project:UUID}) AS pp
			ON pp.person = p.person
		GROUP BY p.person
		HAVING ${conditions.join(' AND ')}`;
}

/** How many people are in a cohort. */
export async function cohortSize(
	config: ClickHouseConfig,
	projectId: string,
	cohort: CohortSpec
): Promise<number> {
	const params: Record<string, string> = { project: projectId };
	const body = await clickhouseQuery(
		config,
		`SELECT uniqExact(person) AS size FROM (${cohortPeopleSql(cohort, params)})
		FORMAT JSONEachRow`,
		{ params }
	);
	return Number((JSON.parse(body) as { size: string }).size);
}

/**
 * Adds people to a static cohort by any of their distinct ids; an anonymous id that was
 * identified is stored as its person.
 */
export async function addCohortPeople(
	config: ClickHouseConfig,
	projectId: string,
	cohortId: string,
	distinctIds: string[]
): Promise<void> {
	if (!distinctIds.length) return;
	await clickhouseQuery(
		config,
		`INSERT INTO cohort_people (project_id, cohort_id, person)
		SELECT {project:UUID}, {cohort:UUID}, if(a.person = '', ids.id, a.person)
		FROM (SELECT arrayJoin({ids:Array(String)}) AS id) AS ids
		LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
			ON a.alias = ids.id`,
		{ params: { project: projectId, cohort: cohortId, ids: distinctIds } }
	);
}

export async function removeCohortPerson(
	config: ClickHouseConfig,
	projectId: string,
	cohortId: string,
	person: string
): Promise<void> {
	await clickhouseQuery(
		config,
		`DELETE FROM cohort_people
		WHERE project_id = {project:UUID} AND cohort_id = {cohort:UUID} AND person = {person:String}`,
		{ params: { project: projectId, cohort: cohortId, person } }
	);
}

/** Removes a deleted cohort's static members. */
export async function deleteCohortPeople(
	config: ClickHouseConfig,
	projectId: string,
	cohortId: string
): Promise<void> {
	await clickhouseQuery(
		config,
		`DELETE FROM cohort_people WHERE project_id = {project:UUID} AND cohort_id = {cohort:UUID}`,
		{ params: { project: projectId, cohort: cohortId } }
	);
}
