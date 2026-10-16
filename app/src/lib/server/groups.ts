import { LOOKBACK_DAYS } from '../explore';
import type { GroupCursor, GroupPage, GroupSummary, GroupTypeSummary } from '../groups';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { PERSON } from './insights';
import { propertiesOf } from './persons';
import { chTime } from './web';

const PAGE_SIZE = 50;
const PEOPLE = `LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
	ON a.alias = e.distinct_id`;

function isoTime(value: string): string {
	return `${value.replace(' ', 'T')}Z`;
}

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

function lookback(now: Date): string {
	return chTime(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000));
}

/** Group types with events in the lookback window, busiest first. */
export async function groupTypes(
	config: ClickHouseConfig,
	projectId: string,
	now = new Date()
): Promise<GroupTypeSummary[]> {
	const body = await clickhouseQuery(
		config,
		`SELECT group_type, uniqExact(e.groups[group_type]) AS group_count, count() AS events
		FROM events AS e
		ARRAY JOIN mapKeys(e.groups) AS group_type
		WHERE project_id = {project:UUID} AND timestamp >= {from:DateTime64(3, 'UTC')}
		GROUP BY group_type
		ORDER BY events DESC, group_type
		LIMIT 50
		FORMAT JSONEachRow`,
		{ params: { project: projectId, from: lookback(now) } }
	);
	return rows<{ group_type: string; group_count: string; events: string }>(body).map((row) => ({
		type: row.group_type,
		groups: Number(row.group_count),
		events: Number(row.events)
	}));
}

/** Each group's properties, values parsed from JSON. */
async function groupProperties(
	config: ClickHouseConfig,
	projectId: string,
	type: string,
	keys: string[]
): Promise<Map<string, Record<string, unknown>>> {
	const result = new Map<string, Record<string, unknown>>();
	if (!keys.length) return result;
	const body = await clickhouseQuery(
		config,
		`SELECT group_key, key, value FROM groups_properties
		WHERE project_id = {project:UUID} AND group_type = {type:String}
			AND group_key IN {keys:Array(String)}
		FORMAT JSONEachRow`,
		{ params: { project: projectId, type, keys } }
	);
	for (const row of rows<{ group_key: string; key: string; value: string }>(body)) {
		const properties = result.get(row.group_key) ?? {};
		try {
			properties[row.key] = JSON.parse(row.value);
		} catch {
			properties[row.key] = row.value;
		}
		result.set(row.group_key, properties);
	}
	return result;
}

/**
 * Groups of one type active in the lookback window, most recently seen first. `search` matches
 * the group key or any of its property values, case-insensitively.
 */
export async function listGroups(
	config: ClickHouseConfig,
	projectId: string,
	type: string,
	options: { search?: string; before?: GroupCursor; limit?: number; now?: Date } = {}
): Promise<GroupPage> {
	const limit = options.limit ?? PAGE_SIZE;
	const params: Record<string, string> = {
		project: projectId,
		type,
		from: lookback(options.now ?? new Date()),
		limit: String(limit + 1)
	};
	const having: string[] = [];
	if (options.search) {
		params.search = options.search;
		having.push(`(positionCaseInsensitive(key, {search:String}) > 0
			OR key IN (
				SELECT group_key FROM groups_properties
				WHERE project_id = {project:UUID} AND group_type = {type:String}
					AND positionCaseInsensitive(value, {search:String}) > 0
			))`);
	}
	if (options.before) {
		params.before = chTime(new Date(options.before.lastSeen));
		params.beforeKey = options.before.key;
		having.push(`(last_seen, key) < ({before:DateTime64(3, 'UTC')}, {beforeKey:String})`);
	}
	const body = await clickhouseQuery(
		config,
		`SELECT
			e.groups[{type:String}] AS key,
			count() AS events,
			uniqExact(${PERSON}) AS people,
			max(e.timestamp) AS last_seen,
			toString(last_seen) AS last_seen_text,
			toString(min(e.timestamp)) AS first_seen
		FROM events AS e
		${PEOPLE}
		WHERE e.project_id = {project:UUID} AND e.timestamp >= {from:DateTime64(3, 'UTC')}
			AND mapContains(e.groups, {type:String})
		GROUP BY key
		${having.length ? `HAVING ${having.join(' AND ')}` : ''}
		ORDER BY last_seen DESC, key DESC
		LIMIT {limit:UInt32}
		FORMAT JSONEachRow`,
		{ params }
	);
	const found = rows<{
		key: string;
		events: string;
		people: string;
		last_seen_text: string;
		first_seen: string;
	}>(body);
	const more = found.length > limit;
	if (more) found.length = limit;
	const properties = await groupProperties(
		config,
		projectId,
		type,
		found.map((row) => row.key)
	);
	const groups: GroupSummary[] = found.map((row) => ({
		key: row.key,
		events: Number(row.events),
		people: Number(row.people),
		firstSeen: isoTime(row.first_seen),
		lastSeen: isoTime(row.last_seen_text),
		properties: properties.get(row.key) ?? {}
	}));
	const last = groups.at(-1);
	return { groups, next: more && last ? { lastSeen: last.lastSeen, key: last.key } : null };
}

export interface GroupMember {
	person: string;
	events: number;
	lastSeen: string;
	properties: Record<string, unknown>;
}

export interface GroupDetail {
	type: string;
	key: string;
	properties: Record<string, unknown>;
	events: number;
	people: number;
	firstSeen: string | null;
	lastSeen: string | null;
	/** The people with the most events in the group. */
	members: GroupMember[];
}

export const MEMBERS_SHOWN = 20;

/** One group, from any time, or null if the project has never seen it. */
export async function getGroup(
	config: ClickHouseConfig,
	projectId: string,
	type: string,
	key: string
): Promise<GroupDetail | null> {
	const params = { project: projectId, type, key };
	const where = `e.project_id = {project:UUID} AND e.groups[{type:String}] = {key:String}`;
	const [statsBody, membersBody, properties] = await Promise.all([
		clickhouseQuery(
			config,
			`SELECT
				count() AS events,
				uniqExact(${PERSON}) AS people,
				if(count() = 0, NULL, toString(min(e.timestamp))) AS first_seen,
				if(count() = 0, NULL, toString(max(e.timestamp))) AS last_seen
			FROM events AS e
			${PEOPLE}
			WHERE ${where}
			FORMAT JSONEachRow`,
			{ params }
		),
		clickhouseQuery(
			config,
			`SELECT ${PERSON} AS person, count() AS events, toString(max(e.timestamp)) AS last_seen
			FROM events AS e
			${PEOPLE}
			WHERE ${where}
			GROUP BY person
			ORDER BY events DESC, person
			LIMIT ${MEMBERS_SHOWN}
			FORMAT JSONEachRow`,
			{ params }
		),
		groupProperties(config, projectId, type, [key]).then((found) => found.get(key) ?? {})
	]);
	const [stats] = rows<{
		events: string;
		people: string;
		first_seen: string | null;
		last_seen: string | null;
	}>(statsBody);
	const events = Number(stats?.events ?? 0);
	if (!events && !Object.keys(properties).length) return null;
	const members = rows<{ person: string; events: string; last_seen: string }>(membersBody);
	const memberProperties = await propertiesOf(
		config,
		projectId,
		members.map((member) => member.person)
	);
	return {
		type,
		key,
		properties,
		events,
		people: Number(stats?.people ?? 0),
		firstSeen: stats?.first_seen ? isoTime(stats.first_seen) : null,
		lastSeen: stats?.last_seen ? isoTime(stats.last_seen) : null,
		members: members.map((member) => ({
			person: member.person,
			events: Number(member.events),
			lastSeen: isoTime(member.last_seen),
			properties: memberProperties.get(member.person) ?? {}
		}))
	};
}
