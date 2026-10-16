import {
	ACTIVITY_PAGE_SIZE,
	type ActivityCursor,
	type ActivityPage,
	type ActivityQuery,
	type EventDefinition,
	LOOKBACK_DAYS,
	type PropertyDefinition,
	readableType
} from '../explore';
import { validName } from '../insights';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { filterSql, PERSON } from './insights';
import { chTime } from './web';

/** ClickHouse's `YYYY-MM-DD hh:mm:ss.sss` in UTC as ISO 8601. */
function isoTime(value: string): string {
	return `${value.replace(' ', 'T')}Z`;
}

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

/**
 * The newest events in the lookback window, newest first, one page at a time. Paging is by
 * (timestamp, uuid), so events sharing a timestamp are neither skipped nor repeated.
 */
export async function recentEvents(
	config: ClickHouseConfig,
	projectId: string,
	query: ActivityQuery,
	options: { before?: ActivityCursor; limit?: number; now?: Date } = {}
): Promise<ActivityPage> {
	const limit = options.limit ?? ACTIVITY_PAGE_SIZE;
	const now = options.now ?? new Date();
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
		limit: String(limit + 1)
	};
	const conditions: string[] = [];
	if (query.event !== undefined) {
		params.event = query.event;
		conditions.push('e.event = {event:String}');
	}
	query.filters.forEach((filter, i) => {
		if (filter.value !== undefined) params[`v${i}`] = filter.value;
		conditions.push(filterSql(filter, `v${i}`));
	});
	if (options.before) {
		params.before = chTime(new Date(options.before.timestamp));
		params.beforeId = options.before.uuid;
		conditions.push(`(e.timestamp, e.uuid) < ({before:DateTime64(3, 'UTC')}, {beforeId:UUID})`);
	}
	const body = await clickhouseQuery(
		config,
		`SELECT
			toString(e.uuid) AS uuid,
			e.event AS event,
			toString(e.timestamp) AS timestamp,
			e.distinct_id AS distinct_id,
			${PERSON} AS person,
			e.session_id AS session_id,
			toJSONString(e.properties) AS properties
		FROM events AS e
		LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
			ON a.alias = e.distinct_id
		WHERE e.project_id = {project:UUID}
			AND e.timestamp >= {from:DateTime64(3, 'UTC')}
			${conditions.map((condition) => `AND ${condition}`).join('\n\t\t\t')}
		ORDER BY e.timestamp DESC, e.uuid DESC
		LIMIT {limit:UInt32}
		FORMAT JSONEachRow`,
		{ params }
	);
	const events = rows<{
		uuid: string;
		event: string;
		timestamp: string;
		distinct_id: string;
		person: string;
		session_id: string;
		properties: string;
	}>(body).map((row) => ({
		uuid: row.uuid,
		event: row.event,
		timestamp: isoTime(row.timestamp),
		distinctId: row.distinct_id,
		person: row.person,
		sessionId: row.session_id,
		properties: JSON.parse(row.properties) as Record<string, unknown>
	}));
	const more = events.length > limit;
	if (more) events.length = limit;
	const last = events.at(-1);
	return {
		events,
		next: more && last ? { timestamp: last.timestamp, uuid: last.uuid } : null
	};
}

/** Every event name the project has sent, busiest in the lookback window first. */
export async function eventDefinitions(
	config: ClickHouseConfig,
	projectId: string,
	now = new Date()
): Promise<EventDefinition[]> {
	const body = await clickhouseQuery(
		config,
		`SELECT
			event,
			countIf(timestamp >= {from:DateTime64(3, 'UTC')}) AS count,
			toString(min(timestamp)) AS first_seen,
			toString(max(timestamp)) AS last_seen
		FROM events
		WHERE project_id = {project:UUID}
		GROUP BY event
		ORDER BY count DESC, event
		LIMIT 1000
		FORMAT JSONEachRow`,
		{
			params: {
				project: projectId,
				from: chTime(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000))
			}
		}
	);
	return rows<{ event: string; count: string; first_seen: string; last_seen: string }>(body).map(
		(row) => ({
			event: row.event,
			count: Number(row.count),
			firstSeen: isoTime(row.first_seen),
			lastSeen: isoTime(row.last_seen)
		})
	);
}

/**
 * Event properties seen in the lookback window, of every event or of one, with their value types
 * and how many events carry them. Sorted by name.
 */
export async function propertyDefinitions(
	config: ClickHouseConfig,
	projectId: string,
	options: { event?: string; now?: Date } = {}
): Promise<PropertyDefinition[]> {
	const now = options.now ?? new Date();
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000))
	};
	let where = `project_id = {project:UUID} AND timestamp >= {from:DateTime64(3, 'UTC')}`;
	if (options.event !== undefined) {
		params.event = options.event;
		where += ' AND event = {event:String}';
	}
	const [typesBody, countsBody] = await Promise.all([
		clickhouseQuery(
			config,
			`SELECT distinctJSONPathsAndTypes(properties) AS paths FROM events WHERE ${where}
			FORMAT JSONEachRow`,
			{ params }
		),
		clickhouseQuery(
			config,
			`SELECT path, count() AS count FROM events
			ARRAY JOIN JSONAllPaths(properties) AS path
			WHERE ${where}
			GROUP BY path
			FORMAT JSONEachRow`,
			{ params }
		)
	]);
	const { paths } = JSON.parse(typesBody) as { paths: Record<string, string[]> };
	const counts = new Map(
		rows<{ path: string; count: string }>(countsBody).map((row) => [row.path, Number(row.count)])
	);
	return Object.entries(paths)
		.filter(([name]) => validName(name))
		.map(([name, types]) => ({
			name,
			types: [...new Set(types.map(readableType))].sort(),
			count: counts.get(name) ?? 0
		}))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
