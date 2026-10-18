// Error issues from ClickHouse: `$exception` events grouped by `exception_fingerprint`.

import type { InternalRule } from '../internal-users';
import type { ExceptionEntry } from '../issues';
import { parseExceptionList } from '../issues';
import type { Range } from '../web';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { PERSON } from './insights';
import { internalUsersSql } from './internal-users';
import { chTime, timeWindow } from './web';

/** Most issues the list shows, by most recently seen. */
export const MAX_ISSUES = 500;
const RECENT = 15;
const TOP_PEOPLE = 10;

/** The Node SDK's default distinct id for server errors; not a person. */
const SERVER = '$server';

const ALIASES = `LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
	ON a.alias = e.distinct_id`;

const LIST = 'toJSONString(e.properties.`$exception_list`)';
const PROP = (name: string) => `toString(e.properties.\`${name}\`)`;

export interface IssueSummary {
	fingerprint: string;
	/** The newest occurrence's outermost exception. */
	type: string;
	value: string;
	/** Occurrences and people in the window. */
	occurrences: number;
	people: number;
	/** Ever, not just in the window. */
	firstSeen: string;
	lastSeen: string;
	/** Occurrences per bucket of the window. */
	series: number[];
}

export interface IssueList {
	buckets: string[];
	bucket: 'hour' | 'day';
	issues: IssueSummary[];
}

export interface IssueOccurrence {
	uuid: string;
	timestamp: string;
	person: string;
	url: string;
	release: string;
	level: string;
	value: string;
}

export interface IssueDetail extends IssueSummary {
	buckets: string[];
	bucket: 'hour' | 'day';
	/** All time. */
	totalOccurrences: number;
	totalPeople: number;
	/** The newest occurrence's exception and its causes. */
	exceptions: ExceptionEntry[];
	level: string;
	release: string;
	recent: IssueOccurrence[];
	topPeople: { person: string; occurrences: number }[];
}

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

const iso = (ms: string | number) => new Date(Number(ms)).toISOString();

/** Aggregates per issue: all time, plus the window `[from, to)`. */
const SUMMARY = `
	argMax(JSONExtractString(${LIST}, 1, 'type'), e.timestamp) AS type,
	argMax(JSONExtractString(${LIST}, 1, 'value'), e.timestamp) AS value,
	countIf(e.timestamp >= {from:DateTime64(3, 'UTC')}) AS occurrences,
	uniqExactIf(${PERSON}, e.timestamp >= {from:DateTime64(3, 'UTC')} AND e.distinct_id != {server:String}) AS people,
	count() AS total_occurrences,
	uniqExactIf(${PERSON}, e.distinct_id != {server:String}) AS total_people,
	toUnixTimestamp64Milli(min(e.timestamp)) AS first_seen,
	toUnixTimestamp64Milli(max(e.timestamp)) AS last_seen`;

interface SummaryRow {
	fingerprint: string;
	type: string;
	value: string;
	occurrences: string;
	people: string;
	total_occurrences: string;
	total_people: string;
	first_seen: string;
	last_seen: string;
}

const EXCEPTIONS = `e.project_id = {project:UUID}
	AND e.event = '$exception'
	AND e.timestamp < {to:DateTime64(3, 'UTC')}`;

async function seriesFor(
	config: ClickHouseConfig,
	params: Record<string, string | string[]>,
	bucketFn: string,
	fingerprints: string[],
	internal: string
): Promise<Map<string, Map<string, number>>> {
	const body = await clickhouseQuery(
		config,
		`SELECT e.exception_fingerprint AS fingerprint,
			formatDateTime(${bucketFn}(e.timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS t,
			count() AS n
		FROM events AS e
		WHERE ${EXCEPTIONS}
			AND e.timestamp >= {from:DateTime64(3, 'UTC')}
			AND e.exception_fingerprint IN {fingerprints:Array(String)}${internal}
		GROUP BY fingerprint, t
		FORMAT JSONEachRow`,
		{ params: { ...params, fingerprints } }
	);
	const series = new Map<string, Map<string, number>>();
	for (const row of rows<{ fingerprint: string; t: string; n: string }>(body)) {
		const counts = series.get(row.fingerprint) ?? new Map<string, number>();
		counts.set(row.t, Number(row.n));
		series.set(row.fingerprint, counts);
	}
	return series;
}

function summary(row: SummaryRow, buckets: string[], counts?: Map<string, number>): IssueSummary {
	return {
		fingerprint: row.fingerprint,
		type: row.type || 'Error',
		value: row.value,
		occurrences: Number(row.occurrences),
		people: Number(row.people),
		firstSeen: iso(row.first_seen),
		lastSeen: iso(row.last_seen),
		series: buckets.map((t) => counts?.get(t) ?? 0)
	};
}

/** Issues that happened in the last `range`, most recently seen first, without `internal` users. */
export async function listIssues(
	config: ClickHouseConfig,
	projectId: string,
	options: { range: Range; now?: Date; limit?: number; internal?: InternalRule[] }
): Promise<IssueList> {
	const { bucket, bucketFn, from, to, buckets } = timeWindow(options.range, options.now);
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(from),
		to: chTime(to),
		server: SERVER
	};
	const internal = internalUsersSql(options.internal, params);
	const body = await clickhouseQuery(
		config,
		`SELECT e.exception_fingerprint AS fingerprint, ${SUMMARY}
		FROM events AS e ${ALIASES}
		WHERE ${EXCEPTIONS} AND e.exception_fingerprint != ''${internal}
		GROUP BY fingerprint
		HAVING occurrences > 0
		ORDER BY last_seen DESC, fingerprint
		LIMIT {limit:UInt32}
		FORMAT JSONEachRow`,
		{ params: { ...params, limit: String(options.limit ?? MAX_ISSUES) } }
	);
	const found = rows<SummaryRow>(body);
	const series = found.length
		? await seriesFor(
				config,
				params,
				bucketFn,
				found.map((row) => row.fingerprint),
				internal
			)
		: new Map();
	return {
		buckets,
		bucket,
		issues: found.map((row) => summary(row, buckets, series.get(row.fingerprint)))
	};
}

/**
 * One issue over the last `range`, with its latest stack, without `internal` users; null if it
 * never happened (to anyone else).
 */
export async function issueDetail(
	config: ClickHouseConfig,
	projectId: string,
	fingerprint: string,
	options: { range: Range; now?: Date; internal?: InternalRule[] }
): Promise<IssueDetail | null> {
	const { bucket, bucketFn, from, to, buckets } = timeWindow(options.range, options.now);
	const params: Record<string, string> = {
		project: projectId,
		fingerprint,
		from: chTime(from),
		to: chTime(to),
		server: SERVER
	};
	const run = (query: string) =>
		clickhouseQuery(config, `${query} FORMAT JSONEachRow`, { params }).then(rows);
	const internal = internalUsersSql(options.internal, params);
	const issue = `${EXCEPTIONS} AND e.exception_fingerprint = {fingerprint:String}${internal}`;
	const [[row], [latest], recent, people, series] = await Promise.all([
		run(`SELECT {fingerprint:String} AS fingerprint, ${SUMMARY}
			FROM events AS e ${ALIASES}
			WHERE ${issue}
			HAVING total_occurrences > 0`) as Promise<SummaryRow[]>,
		run(`SELECT ${LIST} AS list, ${PROP('$exception_level')} AS level, ${PROP('$release')} AS release
			FROM events AS e
			WHERE ${issue}
			ORDER BY e.timestamp DESC
			LIMIT 1`) as Promise<{ list: string; level: string; release: string }[]>,
		run(`SELECT toString(e.uuid) AS uuid, toUnixTimestamp64Milli(e.timestamp) AS ts,
				${PERSON} AS person,
				${PROP('$current_url')} AS url,
				${PROP('$release')} AS release,
				${PROP('$exception_level')} AS level,
				JSONExtractString(${LIST}, 1, 'value') AS value
			FROM events AS e ${ALIASES}
			WHERE ${issue}
			ORDER BY e.timestamp DESC
			LIMIT ${RECENT}`) as Promise<(Omit<IssueOccurrence, 'timestamp'> & { ts: string })[]>,
		run(`SELECT ${PERSON} AS person, count() AS occurrences
			FROM events AS e ${ALIASES}
			WHERE ${issue}
				AND e.timestamp >= {from:DateTime64(3, 'UTC')}
				AND e.distinct_id != {server:String}
			GROUP BY person
			ORDER BY occurrences DESC, person
			LIMIT ${TOP_PEOPLE}`) as Promise<{ person: string; occurrences: string }[]>,
		seriesFor(config, params, bucketFn, [fingerprint], internal)
	]);
	if (!row) return null;
	let exceptions: ExceptionEntry[] = [];
	try {
		exceptions = parseExceptionList(JSON.parse(latest?.list || 'null'));
	} catch {}
	return {
		...summary(row, buckets, series.get(fingerprint)),
		buckets,
		bucket,
		totalOccurrences: Number(row.total_occurrences),
		totalPeople: Number(row.total_people),
		exceptions,
		level: latest?.level ?? '',
		release: latest?.release ?? '',
		recent: recent.map(({ ts, ...occurrence }) => ({ ...occurrence, timestamp: iso(ts) })),
		topPeople: people.map((p) => ({ person: p.person, occurrences: Number(p.occurrences) }))
	};
}
