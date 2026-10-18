// The ClickHouse queries alert rules are checked with (see docs/alerts.md).
//
// Issue rules look at when exceptions were stored (`inserted_at`), not when they happened, so an
// event that arrives late is still noticed once and a check never looks at the same rows twice.

import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { chTime } from './web';

/** Most issues one check reports. */
export const MAX_ALERT_ISSUES = 50;

const LIST = 'toJSONString(e.properties.`$exception_list`)';
const EXCEPTIONS = `e.project_id = {project:UUID}
	AND e.event = '$exception'
	AND e.exception_fingerprint != ''
	AND e.inserted_at < {to:DateTime64(3, 'UTC')}`;

export interface AlertIssue {
	fingerprint: string;
	type: string;
	value: string;
	/** Occurrences stored in the checked window. */
	occurrences: number;
}

interface IssueRow {
	fingerprint: string;
	type: string;
	value: string;
	occurrences: string;
}

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

const issue = (row: IssueRow): AlertIssue => ({
	fingerprint: row.fingerprint,
	type: row.type || 'Error',
	value: row.value,
	occurrences: Number(row.occurrences)
});

const ISSUE_COLUMNS = `e.exception_fingerprint AS fingerprint,
	argMax(JSONExtractString(${LIST}, 1, 'type'), e.timestamp) AS type,
	argMax(JSONExtractString(${LIST}, 1, 'value'), e.timestamp) AS value,
	countIf(e.inserted_at >= {from:DateTime64(3, 'UTC')}) AS occurrences`;

/** Issues whose first exception was stored in `[from, to)`. */
export async function newIssues(
	config: ClickHouseConfig,
	projectId: string,
	from: Date,
	to: Date
): Promise<AlertIssue[]> {
	const body = await clickhouseQuery(
		config,
		`SELECT ${ISSUE_COLUMNS}
		FROM events AS e
		WHERE ${EXCEPTIONS}
			AND e.exception_fingerprint IN (
				SELECT exception_fingerprint FROM events
				WHERE project_id = {project:UUID}
					AND event = '$exception'
					AND inserted_at >= {from:DateTime64(3, 'UTC')}
					AND inserted_at < {to:DateTime64(3, 'UTC')}
			)
		GROUP BY fingerprint
		HAVING min(e.inserted_at) >= {from:DateTime64(3, 'UTC')}
		ORDER BY min(e.inserted_at), fingerprint
		LIMIT ${MAX_ALERT_ISSUES}
		FORMAT JSONEachRow`,
		{ params: { project: projectId, from: chTime(from), to: chTime(to) } }
	);
	return rows<IssueRow>(body).map(issue);
}

/**
 * Resolved issues that happened again, where the first exception after the resolution was
 * stored in `[from, to)`. Each regression is reported once.
 */
export async function regressedIssues(
	config: ClickHouseConfig,
	projectId: string,
	resolved: { fingerprint: string; resolvedAt: Date }[],
	from: Date,
	to: Date
): Promise<AlertIssue[]> {
	if (!resolved.length) return [];
	const earliest = new Date(Math.min(...resolved.map((r) => r.resolvedAt.getTime())));
	const body = await clickhouseQuery(
		config,
		`SELECT ${ISSUE_COLUMNS}
		FROM events AS e
		WHERE ${EXCEPTIONS}
			AND e.exception_fingerprint IN {fingerprints:Array(String)}
			AND e.timestamp > {earliest:DateTime64(3, 'UTC')}
			AND e.timestamp > fromUnixTimestamp64Milli(toInt64(arrayElement(
				{resolved:Array(String)},
				indexOf({fingerprints:Array(String)}, e.exception_fingerprint)
			)), 'UTC')
		GROUP BY fingerprint
		HAVING min(e.inserted_at) >= {from:DateTime64(3, 'UTC')}
		ORDER BY min(e.inserted_at), fingerprint
		LIMIT ${MAX_ALERT_ISSUES}
		FORMAT JSONEachRow`,
		{
			params: {
				project: projectId,
				from: chTime(from),
				to: chTime(to),
				earliest: chTime(earliest),
				fingerprints: resolved.map((r) => r.fingerprint),
				resolved: resolved.map((r) => String(r.resolvedAt.getTime()))
			}
		}
	);
	return rows<IssueRow>(body).map(issue);
}

/** Events that happened in `[from, to)`, of one name or all of them. */
export async function eventCount(
	config: ClickHouseConfig,
	projectId: string,
	event: string,
	from: Date,
	to: Date
): Promise<number> {
	const body = await clickhouseQuery(
		config,
		`SELECT count() AS n FROM events
		WHERE project_id = {project:UUID}
			${event ? 'AND event = {event:String}' : ''}
			AND timestamp >= {from:DateTime64(3, 'UTC')}
			AND timestamp < {to:DateTime64(3, 'UTC')}
		FORMAT JSONEachRow`,
		{ params: { project: projectId, event, from: chTime(from), to: chTime(to) } }
	);
	return Number(rows<{ n: string }>(body)[0]?.n ?? 0);
}

/** USD spent on AI generations and embeddings in `[from, to)`. */
export async function aiCost(
	config: ClickHouseConfig,
	projectId: string,
	from: Date,
	to: Date
): Promise<number> {
	const body = await clickhouseQuery(
		config,
		`SELECT sum(ai_cost_usd) AS cost FROM events
		WHERE project_id = {project:UUID}
			AND event IN ('$ai_generation', '$ai_embedding')
			AND timestamp >= {from:DateTime64(3, 'UTC')}
			AND timestamp < {to:DateTime64(3, 'UTC')}
		FORMAT JSONEachRow`,
		{ params: { project: projectId, from: chTime(from), to: chTime(to) } }
	);
	return Number(rows<{ cost: number }>(body)[0]?.cost ?? 0);
}
