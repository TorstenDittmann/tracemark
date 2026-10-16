import { LOOKBACK_DAYS } from '../explore';
import type { PersonCursor, PersonPage, PersonSummary } from '../persons';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { PERSON } from './insights';
import { chTime } from './web';

const PAGE_SIZE = 50;

function isoTime(value: string): string {
	return `${value.replace(' ', 'T')}Z`;
}

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

/** Merged person properties for each of `persons`, values parsed from JSON. */
async function propertiesOf(
	config: ClickHouseConfig,
	projectId: string,
	persons: string[]
): Promise<Map<string, Record<string, unknown>>> {
	const result = new Map<string, Record<string, unknown>>();
	if (!persons.length) return result;
	const body = await clickhouseQuery(
		config,
		`SELECT person, key, value FROM persons_properties
		WHERE project_id = {project:UUID} AND person IN {persons:Array(String)}
		FORMAT JSONEachRow`,
		{ params: { project: projectId, persons: persons } }
	);
	for (const row of rows<{ person: string; key: string; value: string }>(body)) {
		const properties = result.get(row.person) ?? {};
		try {
			properties[row.key] = JSON.parse(row.value);
		} catch {
			properties[row.key] = row.value;
		}
		result.set(row.person, properties);
	}
	return result;
}

/**
 * People active in the lookback window, most recently seen first. `search` matches the person's
 * id or any of their person property values, case-insensitively.
 */
export async function listPersons(
	config: ClickHouseConfig,
	projectId: string,
	options: { search?: string; before?: PersonCursor; limit?: number; now?: Date } = {}
): Promise<PersonPage> {
	const limit = options.limit ?? PAGE_SIZE;
	const now = options.now ?? new Date();
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
		limit: String(limit + 1)
	};
	const having: string[] = [];
	if (options.search) {
		params.search = options.search;
		having.push(`(positionCaseInsensitive(person, {search:String}) > 0
			OR person IN (
				SELECT person FROM persons_properties
				WHERE project_id = {project:UUID} AND positionCaseInsensitive(value, {search:String}) > 0
			))`);
	}
	if (options.before) {
		params.before = chTime(new Date(options.before.lastSeen));
		params.beforePerson = options.before.person;
		having.push(`(last_seen, person) < ({before:DateTime64(3, 'UTC')}, {beforePerson:String})`);
	}
	const body = await clickhouseQuery(
		config,
		`SELECT
			${PERSON} AS person,
			count() AS events,
			max(e.timestamp) AS last_seen,
			toString(last_seen) AS last_seen_text,
			toString(min(e.timestamp)) AS first_seen
		FROM events AS e
		LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
			ON a.alias = e.distinct_id
		WHERE e.project_id = {project:UUID} AND e.timestamp >= {from:DateTime64(3, 'UTC')}
		GROUP BY person
		${having.length ? `HAVING ${having.join(' AND ')}` : ''}
		ORDER BY last_seen DESC, person DESC
		LIMIT {limit:UInt32}
		FORMAT JSONEachRow`,
		{ params }
	);
	const found = rows<{
		person: string;
		events: string;
		last_seen_text: string;
		first_seen: string;
	}>(body);
	const more = found.length > limit;
	if (more) found.length = limit;
	const properties = await propertiesOf(
		config,
		projectId,
		found.map((row) => row.person)
	);
	const persons: PersonSummary[] = found.map((row) => ({
		person: row.person,
		events: Number(row.events),
		firstSeen: isoTime(row.first_seen),
		lastSeen: isoTime(row.last_seen_text),
		properties: properties.get(row.person) ?? {}
	}));
	const last = persons.at(-1);
	return {
		persons,
		next: more && last ? { lastSeen: last.lastSeen, person: last.person } : null
	};
}

export interface PersonDetail {
	/** The person key: the identified id, or the distinct id of someone never identified. */
	person: string;
	/** Every distinct id that belongs to the person, the person key first. */
	distinctIds: string[];
	properties: Record<string, unknown>;
	events: number;
	firstSeen: string | null;
	lastSeen: string | null;
}

/** The person a distinct id belongs to, or null if the project has never seen it. */
export async function getPerson(
	config: ClickHouseConfig,
	projectId: string,
	distinctId: string
): Promise<PersonDetail | null> {
	const params = { project: projectId, id: distinctId };
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
		)[0]?.person || distinctId;
	const aliases = rows<{ alias: string }>(
		await clickhouseQuery(
			config,
			`SELECT alias FROM person_distinct_ids
			WHERE project_id = {project:UUID} AND person = {person:String}
			ORDER BY alias
			FORMAT JSONEachRow`,
			{ params: { project: projectId, person } }
		)
	).map((row) => row.alias);
	const distinctIds = [person, ...aliases.filter((alias) => alias !== person)];
	const [stats] = rows<{ events: string; first_seen: string | null; last_seen: string | null }>(
		await clickhouseQuery(
			config,
			`SELECT
				count() AS events,
				if(count() = 0, NULL, toString(min(timestamp))) AS first_seen,
				if(count() = 0, NULL, toString(max(timestamp))) AS last_seen
			FROM events
			WHERE project_id = {project:UUID} AND distinct_id IN {ids:Array(String)}
			FORMAT JSONEachRow`,
			{ params: { project: projectId, ids: distinctIds } }
		)
	);
	const events = Number(stats?.events ?? 0);
	const properties = (await propertiesOf(config, projectId, [person])).get(person) ?? {};
	if (!events && !Object.keys(properties).length) return null;
	return {
		person,
		distinctIds,
		properties,
		events,
		firstSeen: stats?.first_seen ? isoTime(stats.first_seen) : null,
		lastSeen: stats?.last_seen ? isoTime(stats.last_seen) : null
	};
}
