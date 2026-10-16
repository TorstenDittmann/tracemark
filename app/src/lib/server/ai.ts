// AI observability from ClickHouse: `$ai_*` events, priced at ingest (see docs/ai.md).

import type { AiEvent } from '../ai';
import type { Range } from '../web';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { PERSON } from './insights';
import { chTime, timeWindow } from './web';

/** Most traces the list shows, newest first. */
export const MAX_TRACES = 200;
/** Most events one trace page loads. */
export const MAX_TRACE_EVENTS = 2000;
const MODELS = 50;
const PEOPLE = 25;

const ALIASES = `LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
	ON a.alias = e.distinct_id`;
const AI_EVENTS = `('$ai_generation', '$ai_embedding', '$ai_span', '$ai_trace')`;
const CALLS = `e.event IN ('$ai_generation', '$ai_embedding')`;
const NUM = (name: string) => `toFloat64OrZero(toString(e.properties.\`${name}\`))`;
const STR = (name: string) => `toString(e.properties.\`${name}\`)`;
const IS_ERROR = `${STR('$ai_is_error')} = 'true'`;
/** Calls recorded without a person (`$server`, or `otel:<service>` from OpenTelemetry). */
const ANONYMOUS = `(e.distinct_id = '$server' OR startsWith(e.distinct_id, 'otel'))`;
const WINDOW = `e.project_id = {project:UUID}
	AND e.timestamp >= {from:DateTime64(3, 'UTC')}
	AND e.timestamp < {to:DateTime64(3, 'UTC')}`;

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

export interface AiTotals {
	calls: number;
	traces: number;
	people: number;
	cost: number;
	inputTokens: number;
	outputTokens: number;
	/** Seconds per call. */
	avgLatency: number;
	errors: number;
}

export interface ModelUsage {
	model: string;
	provider: string;
	calls: number;
	inputTokens: number;
	outputTokens: number;
	cost: number;
	avgLatency: number;
	errors: number;
}

export interface PersonUsage {
	person: string;
	calls: number;
	traces: number;
	cost: number;
	lastSeen: string;
}

export interface AiOverview {
	buckets: string[];
	bucket: 'hour' | 'day';
	totals: AiTotals;
	/** Per bucket of the window. */
	cost: number[];
	calls: number[];
	models: ModelUsage[];
	people: PersonUsage[];
}

const TOTALS = `
	count() AS calls,
	uniqExact(e.ai_trace_id) AS traces,
	uniqExactIf(${PERSON}, NOT ${ANONYMOUS}) AS people,
	sum(e.ai_cost_usd) AS cost,
	sum(${NUM('$ai_input_tokens')}) AS input_tokens,
	sum(${NUM('$ai_output_tokens')}) AS output_tokens,
	ifNotFinite(avg(${NUM('$ai_latency')}), 0) AS avg_latency,
	countIf(${IS_ERROR}) AS errors`;

/** Cost, calls and tokens over the last `range`, by model and by person. */
export async function aiOverview(
	config: ClickHouseConfig,
	projectId: string,
	options: { range: Range; now?: Date }
): Promise<AiOverview> {
	const { bucket, bucketFn, from, to, buckets } = timeWindow(options.range, options.now);
	const params = { project: projectId, from: chTime(from), to: chTime(to) };
	const run = <T>(query: string) =>
		clickhouseQuery(config, `${query} FORMAT JSONEachRow`, { params }).then((body) =>
			rows<T>(body)
		);
	type Totals = Record<
		| 'calls'
		| 'traces'
		| 'people'
		| 'cost'
		| 'input_tokens'
		| 'output_tokens'
		| 'avg_latency'
		| 'errors',
		string | number
	>;
	const [[totals], series, models, people] = await Promise.all([
		run<Totals>(`SELECT ${TOTALS} FROM events AS e ${ALIASES} WHERE ${WINDOW} AND ${CALLS}`),
		run<{ t: string; cost: number; calls: string }>(
			`SELECT formatDateTime(${bucketFn}(e.timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS t,
				sum(e.ai_cost_usd) AS cost, count() AS calls
			FROM events AS e
			WHERE ${WINDOW} AND ${CALLS}
			GROUP BY t`
		),
		run<
			Record<keyof ModelUsage | 'input_tokens' | 'output_tokens' | 'avg_latency', string | number>
		>(
			`SELECT if(e.ai_model = '', '(unknown)', e.ai_model) AS model,
				any(${STR('$ai_provider')}) AS provider,
				count() AS calls,
				sum(${NUM('$ai_input_tokens')}) AS input_tokens,
				sum(${NUM('$ai_output_tokens')}) AS output_tokens,
				sum(e.ai_cost_usd) AS cost,
				ifNotFinite(avg(${NUM('$ai_latency')}), 0) AS avg_latency,
				countIf(${IS_ERROR}) AS errors
			FROM events AS e
			WHERE ${WINDOW} AND ${CALLS}
			GROUP BY model
			ORDER BY cost DESC, calls DESC, model
			LIMIT ${MODELS}`
		),
		run<{ person: string; calls: string; traces: string; cost: number; last_seen: string }>(
			`SELECT ${PERSON} AS person,
				count() AS calls,
				uniqExact(e.ai_trace_id) AS traces,
				sum(e.ai_cost_usd) AS cost,
				toUnixTimestamp64Milli(max(e.timestamp)) AS last_seen
			FROM events AS e ${ALIASES}
			WHERE ${WINDOW} AND ${CALLS} AND NOT ${ANONYMOUS}
			GROUP BY person
			ORDER BY cost DESC, calls DESC, person
			LIMIT ${PEOPLE}`
		)
	]);
	const byBucket = new Map(series.map((row) => [row.t, row]));
	return {
		buckets,
		bucket,
		totals: {
			calls: Number(totals?.calls ?? 0),
			traces: Number(totals?.traces ?? 0),
			people: Number(totals?.people ?? 0),
			cost: Number(totals?.cost ?? 0),
			inputTokens: Number(totals?.input_tokens ?? 0),
			outputTokens: Number(totals?.output_tokens ?? 0),
			avgLatency: Number(totals?.avg_latency ?? 0),
			errors: Number(totals?.errors ?? 0)
		},
		cost: buckets.map((t) => Number(byBucket.get(t)?.cost ?? 0)),
		calls: buckets.map((t) => Number(byBucket.get(t)?.calls ?? 0)),
		models: models.map((row) => ({
			model: String(row.model),
			provider: String(row.provider),
			calls: Number(row.calls),
			inputTokens: Number(row.input_tokens),
			outputTokens: Number(row.output_tokens),
			cost: Number(row.cost),
			avgLatency: Number(row.avg_latency),
			errors: Number(row.errors)
		})),
		people: people.map((row) => ({
			person: row.person,
			calls: Number(row.calls),
			traces: Number(row.traces),
			cost: Number(row.cost),
			lastSeen: new Date(Number(row.last_seen)).toISOString()
		}))
	};
}

export interface TraceSummary {
	traceId: string;
	/** The trace's name, else its first step's or model's. */
	name: string;
	person: string;
	startedAt: string;
	/** Seconds from the first event's start to the last one's end. */
	duration: number;
	calls: number;
	cost: number;
	inputTokens: number;
	outputTokens: number;
	errors: number;
}

/** Traces that started in the last `range`, newest first; `person` narrows to one person. */
export async function listTraces(
	config: ClickHouseConfig,
	projectId: string,
	options: { range: Range; now?: Date; person?: string; limit?: number }
): Promise<TraceSummary[]> {
	const { from, to } = timeWindow(options.range, options.now);
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(from),
		to: chTime(to),
		limit: String(options.limit ?? MAX_TRACES)
	};
	if (options.person) params.person = options.person;
	const name = `${STR('$ai_span_name')}`;
	const body = await clickhouseQuery(
		config,
		`SELECT e.ai_trace_id AS trace_id,
			coalesce(
				nullIf(anyIf(${name}, e.event = '$ai_trace'), ''),
				nullIf(argMinIf(${name}, e.timestamp, ${STR('$ai_parent_id')} = ''), ''),
				nullIf(argMin(e.ai_model, e.timestamp), ''),
				''
			) AS name,
			argMin(${PERSON}, e.timestamp) AS person,
			toUnixTimestamp64Milli(min(e.timestamp)) AS started,
			(max(toUnixTimestamp64Milli(e.timestamp) + ${NUM('$ai_latency')} * 1000)
				- toUnixTimestamp64Milli(min(e.timestamp))) / 1000 AS duration,
			countIf(${CALLS}) AS calls,
			sum(e.ai_cost_usd) AS cost,
			sumIf(${NUM('$ai_input_tokens')}, ${CALLS}) AS input_tokens,
			sumIf(${NUM('$ai_output_tokens')}, ${CALLS}) AS output_tokens,
			countIf(${IS_ERROR}) AS errors
		FROM events AS e ${ALIASES}
		WHERE ${WINDOW} AND e.event IN ${AI_EVENTS} AND e.ai_trace_id != ''
		GROUP BY trace_id
		${options.person ? 'HAVING person = {person:String}' : ''}
		ORDER BY started DESC, trace_id
		LIMIT {limit:UInt32}
		FORMAT JSONEachRow`,
		{ params }
	);
	return rows<Record<string, string | number>>(body).map((row) => ({
		traceId: String(row.trace_id),
		name: String(row.name),
		person: String(row.person),
		startedAt: new Date(Number(row.started)).toISOString(),
		duration: Math.max(0, Number(row.duration)),
		calls: Number(row.calls),
		cost: Number(row.cost),
		inputTokens: Number(row.input_tokens),
		outputTokens: Number(row.output_tokens),
		errors: Number(row.errors)
	}));
}

/** Every event of one trace, oldest first; empty when there is no such trace. */
export async function traceEvents(
	config: ClickHouseConfig,
	projectId: string,
	traceId: string
): Promise<AiEvent[]> {
	const body = await clickhouseQuery(
		config,
		`SELECT toString(e.uuid) AS uuid, e.event AS event,
			toUnixTimestamp64Milli(e.timestamp) AS ts,
			${PERSON} AS person,
			toJSONString(e.properties) AS properties
		FROM events AS e ${ALIASES}
		WHERE e.project_id = {project:UUID}
			AND e.ai_trace_id = {trace:String}
			AND e.event IN ${AI_EVENTS}
		ORDER BY e.timestamp, e.uuid
		LIMIT ${MAX_TRACE_EVENTS}
		FORMAT JSONEachRow`,
		{ params: { project: projectId, trace: traceId } }
	);
	return rows<{ uuid: string; event: string; ts: string; person: string; properties: string }>(
		body
	).map((row) => ({
		uuid: row.uuid,
		event: row.event,
		timestamp: new Date(Number(row.ts)).toISOString(),
		person: row.person,
		properties: JSON.parse(row.properties) as Record<string, unknown>
	}));
}
