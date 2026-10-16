import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';

export interface EventStats {
	last24h: number;
	people24h: number;
	lastEventAt: string | null;
}

/**
 * Event and people counts for a project. A person is an identified distinct_id together with
 * the anonymous ids linked to it by `$identify`, so a visitor who signs up counts once.
 */
export async function projectEventStats(
	config: ClickHouseConfig,
	projectId: string
): Promise<EventStats> {
	const body = await clickhouseQuery(
		config,
		`SELECT
			countIf(e.timestamp > now() - INTERVAL 1 DAY) AS last24h,
			uniqExactIf(if(a.person = '', e.distinct_id, a.person), e.timestamp > now() - INTERVAL 1 DAY) AS people24h,
			if(count() = 0, NULL, formatDateTime(max(e.timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC')) AS lastEventAt
		FROM events AS e
		LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
			ON a.alias = e.distinct_id
		WHERE e.project_id = {project:UUID}
		FORMAT JSONEachRow`,
		{ params: { project: projectId } }
	);
	const row = JSON.parse(body) as {
		last24h: string | number;
		people24h: string | number;
		lastEventAt: string | null;
	};
	return {
		last24h: Number(row.last24h),
		people24h: Number(row.people24h),
		lastEventAt: row.lastEventAt
	};
}

/** Person properties merged across all of a person's distinct_ids. Values are parsed JSON. */
export async function personProperties(
	config: ClickHouseConfig,
	projectId: string,
	distinctId: string
): Promise<Record<string, unknown>> {
	const body = await clickhouseQuery(
		config,
		`WITH (
			SELECT any(person) FROM person_distinct_ids
			WHERE project_id = {project:UUID} AND alias = {id:String}
		) AS linked
		SELECT key, value FROM persons_properties
		WHERE project_id = {project:UUID} AND person = if(linked = '', {id:String}, linked)
		ORDER BY key
		FORMAT JSONEachRow`,
		{ params: { project: projectId, id: distinctId } }
	);
	const properties: Record<string, unknown> = {};
	for (const line of body.split('\n').filter(Boolean)) {
		const { key, value } = JSON.parse(line) as { key: string; value: string };
		properties[key] = JSON.parse(value);
	}
	return properties;
}

/** Removes a deleted project's events, people and groups. Lightweight delete: rows disappear from queries at once, from disk on merge. */
export async function deleteProjectEvents(
	config: ClickHouseConfig,
	projectId: string
): Promise<void> {
	for (const table of ['events', 'person_aliases', 'person_properties', 'group_properties']) {
		await clickhouseQuery(config, `DELETE FROM ${table} WHERE project_id = {project:UUID}`, {
			params: { project: projectId }
		});
	}
}
