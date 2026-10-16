import {
	type FunnelGroup,
	type FunnelQuery,
	type FunnelResult,
	MAX_LINES,
	needsProperty,
	type PropertyFilter,
	type RetentionCohort,
	type RetentionQuery,
	type RetentionResult,
	retentionPeriod,
	type Series,
	seriesLabel,
	type TrendLine,
	type TrendsQuery,
	type TrendsResult,
	validName,
	WINDOWS
} from '../insights';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { chTime, timeWindow } from './web';

export type { FunnelResult, RetentionResult, TrendsResult };

/** An event property as a ClickHouse expression. Names are validated, so quoting is enough. */
function property(name: string): string {
	if (!validName(name)) throw new Error(`invalid property name ${JSON.stringify(name)}`);
	return `e.properties.\`${name}\``;
}

function filterSql(filter: PropertyFilter, param: string): string {
	const value = `toString(${property(filter.property)})`;
	switch (filter.operator) {
		case 'eq':
			return `${value} = {${param}:String}`;
		case 'neq':
			return `${value} != {${param}:String}`;
		case 'contains':
			return `positionCaseInsensitive(${value}, {${param}:String}) > 0`;
		case 'not_contains':
			return `positionCaseInsensitive(${value}, {${param}:String}) = 0`;
		case 'gt':
			return `toFloat64OrNull(${value}) > toFloat64OrNull({${param}:String})`;
		case 'lt':
			return `toFloat64OrNull(${value}) < toFloat64OrNull({${param}:String})`;
		case 'is_set':
			return `${value} != ''`;
		case 'is_not_set':
			return `${value} = ''`;
	}
}

/**
 * The FROM, JOIN and WHERE shared by every insight: a project's events in a time window with
 * property filters applied, joined to people. Selects can use `e.*` and `person`.
 */
function eventsSource(
	projectId: string,
	window: { from: Date; to: Date },
	filters: PropertyFilter[]
): { sql: string; params: Record<string, string> } {
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(window.from),
		to: chTime(window.to)
	};
	const conditions = filters.map((filter, i) => {
		if (filter.value !== undefined) params[`v${i}`] = filter.value;
		return ` AND ${filterSql(filter, `v${i}`)}`;
	});
	return {
		sql: `FROM events AS e
			LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
				ON a.alias = e.distinct_id
			WHERE e.project_id = {project:UUID}
				AND e.timestamp >= {from:DateTime64(3, 'UTC')}
				AND e.timestamp < {to:DateTime64(3, 'UTC')}${conditions.join('')}`,
		params
	};
}

const PERSON = `if(a.person = '', e.distinct_id, a.person)`;

function aggregate(series: Series): string {
	switch (series.math) {
		case 'total':
			return 'toFloat64(count())';
		case 'unique_users':
			return 'toFloat64(uniqExact(person))';
		case 'sum':
			return 'sum(num)';
		case 'avg':
			return 'ifNotFinite(avg(num), 0)';
		case 'min':
			return 'ifNull(min(num), 0)';
		case 'max':
			return 'ifNull(max(num), 0)';
	}
}

/**
 * A trend line per series, or per series and breakdown value. Breakdowns keep the values with
 * the most events, sharing MAX_LINES across the series. Users are people, as in web analytics.
 */
export async function trends(
	config: ClickHouseConfig,
	projectId: string,
	query: TrendsQuery,
	now?: Date
): Promise<TrendsResult> {
	const { bucket, bucketFn, from, to, buckets } = timeWindow(query.range, now);
	const source = eventsSource(projectId, { from, to }, query.filters);
	const perSeries = Math.max(1, Math.floor(MAX_LINES / query.series.length));

	const results = await Promise.all(
		query.series.map(async (series, index) => {
			const breakdown = query.breakdown ? `toString(${property(query.breakdown)})` : `''`;
			const num =
				needsProperty(series.math) && series.property
					? `toFloat64OrNull(toString(${property(series.property)}))`
					: 'NULL';
			const body = await clickhouseQuery(
				config,
				`WITH base AS (
					SELECT
						${bucketFn}(e.timestamp) AS bucket,
						${PERSON} AS person,
						${breakdown} AS value,
						${num} AS num
					${source.sql}
						AND e.event = {event:String}
				),
				top AS (SELECT value FROM base GROUP BY value ORDER BY count() DESC, value LIMIT ${perSeries})
				SELECT
					if(isNull(bucket), NULL, formatDateTime(bucket, '%Y-%m-%dT%H:%i:%SZ', 'UTC')) AS t,
					value,
					${aggregate(series)} AS v
				FROM base
				WHERE value IN (SELECT value FROM top)
				GROUP BY GROUPING SETS ((bucket, value), (value))
				SETTINGS group_by_use_nulls = 1
				FORMAT JSONEachRow`,
				{ params: { ...source.params, event: series.event } }
			);
			const lines = new Map<string, TrendLine>();
			for (const line of body.split('\n').filter(Boolean)) {
				const row = JSON.parse(line) as { t: string | null; value: string; v: number | string };
				let trend = lines.get(row.value);
				if (!trend) {
					trend = {
						series: index,
						label: seriesLabel(series),
						...(query.breakdown ? { breakdown: row.value } : {}),
						data: buckets.map(() => 0),
						total: 0
					};
					lines.set(row.value, trend);
				}
				const v = Number(row.v);
				if (row.t === null) trend.total = v;
				else {
					const i = buckets.indexOf(row.t);
					if (i >= 0) trend.data[i] = v;
				}
			}
			if (lines.size === 0 && !query.breakdown) {
				return [
					{ series: index, label: seriesLabel(series), data: buckets.map(() => 0), total: 0 }
				];
			}
			return [...lines.values()].sort((a, b) => b.total - a.total);
		})
	);

	return { bucket, buckets, lines: results.flat() };
}

/**
 * People who did the steps in order, each within the conversion window of their first step.
 * Other events in between are allowed. A breakdown groups people by the property on their first
 * step event.
 */
export async function funnel(
	config: ClickHouseConfig,
	projectId: string,
	query: FunnelQuery,
	now?: Date
): Promise<FunnelResult> {
	const { from, to } = timeWindow(query.range, now);
	const source = eventsSource(projectId, { from, to }, query.filters);
	const params: Record<string, string> = {
		...source.params,
		window: String(WINDOWS[query.window].ms)
	};
	query.steps.forEach((step, i) => {
		params[`s${i}`] = step;
	});
	const conditions = query.steps.map((_, i) => `event = {s${i}:String}`).join(', ');
	const breakdown = query.breakdown ? `toString(${property(query.breakdown)})` : `''`;
	const body = await clickhouseQuery(
		config,
		`SELECT value, level, count() AS people FROM (
			SELECT
				person,
				argMinIf(value, ts, event = {s0:String}) AS value,
				windowFunnel({window:UInt64})(toUInt64(toUnixTimestamp64Milli(ts)), ${conditions}) AS level
			FROM (
				SELECT ${PERSON} AS person, e.timestamp AS ts, e.event AS event, ${breakdown} AS value
				${source.sql}
					AND e.event IN (${query.steps.map((_, i) => `{s${i}:String}`).join(', ')})
			)
			GROUP BY person
		)
		WHERE level > 0
		GROUP BY value, level
		FORMAT JSONEachRow`,
		{ params }
	);

	const empty = () => query.steps.map(() => 0);
	const total = empty();
	const byValue = new Map<string, number[]>();
	for (const line of body.split('\n').filter(Boolean)) {
		const row = JSON.parse(line) as { value: string; level: number; people: string };
		const counts = byValue.get(row.value) ?? empty();
		byValue.set(row.value, counts);
		// Reaching level n means every step up to n was done.
		for (let i = 0; i < row.level; i++) {
			counts[i] += Number(row.people);
			total[i] += Number(row.people);
		}
	}
	const groups = query.breakdown
		? [...byValue]
				.map(([breakdown, counts]) => ({ breakdown, counts }))
				.sort((a, b) => b.counts[0] - a.counts[0] || (a.breakdown < b.breakdown ? -1 : 1))
				.slice(0, MAX_LINES)
		: [];
	return { steps: query.steps, total: { counts: total }, groups };
}

const DAY_MS = 86_400_000;

/**
 * Cohorts of people by the day or week (Monday, UTC) they first did the start event in the
 * range, and how many did the returning event in each later period.
 */
export async function retention(
	config: ClickHouseConfig,
	projectId: string,
	query: RetentionQuery,
	now?: Date
): Promise<RetentionResult> {
	const period = retentionPeriod(query.range);
	const window = timeWindow(query.range, now);
	// Weekly cohorts start on the Monday on or before the window start.
	const firstDay = window.from.getTime();
	const first =
		period === 'day' ? firstDay : firstDay - ((new Date(firstDay).getUTCDay() + 6) % 7) * DAY_MS;
	const step = period === 'day' ? DAY_MS : 7 * DAY_MS;
	const starts: string[] = [];
	for (let t = first; t <= window.to.getTime(); t += step) {
		starts.push(new Date(t).toISOString().replace('.000Z', 'Z'));
	}

	const source = eventsSource(projectId, window, query.filters);
	const trunc = period === 'day' ? 'toStartOfDay(e.timestamp)' : 'toStartOfWeek(e.timestamp, 1)';
	const body = await clickhouseQuery(
		config,
		`WITH
			cohorts AS (
				SELECT ${PERSON} AS person, min(${trunc}) AS cohort
				${source.sql} AND e.event = {start:String}
				GROUP BY person
			),
			visits AS (
				SELECT DISTINCT ${PERSON} AS person, ${trunc} AS visited
				${source.sql} AND e.event = {returning:String}
			)
		SELECT formatDateTime(cohort, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS start, 0 AS n, count() AS people
		FROM cohorts GROUP BY cohort
		UNION ALL
		SELECT
			formatDateTime(c.cohort, '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS start,
			dateDiff('${period}', c.cohort, v.visited) AS n,
			uniqExact(c.person) AS people
		FROM cohorts AS c INNER JOIN visits AS v ON v.person = c.person
		WHERE v.visited > c.cohort
		GROUP BY c.cohort, n
		FORMAT JSONEachRow`,
		{ params: { ...source.params, start: query.start, returning: query.returning } }
	);

	const cohorts = starts.map((start, i) => ({
		start,
		size: 0,
		returned: starts.slice(i + 1).map(() => 0)
	}));
	const byStart = new Map(cohorts.map((cohort) => [cohort.start, cohort]));
	for (const line of body.split('\n').filter(Boolean)) {
		const row = JSON.parse(line) as { start: string; n: number; people: string };
		const cohort = byStart.get(row.start);
		if (!cohort) continue;
		if (row.n === 0) cohort.size = Number(row.people);
		else if (row.n <= cohort.returned.length) cohort.returned[row.n - 1] = Number(row.people);
	}
	return { period, cohorts };
}

export interface EventName {
	event: string;
	count: number;
}

/** Events seen in the last 30 days, most frequent first. */
export async function eventNames(
	config: ClickHouseConfig,
	projectId: string
): Promise<EventName[]> {
	const body = await clickhouseQuery(
		config,
		`SELECT event, count() AS count FROM events
		WHERE project_id = {project:UUID} AND timestamp > now() - INTERVAL 30 DAY
		GROUP BY event ORDER BY count DESC, event LIMIT 500
		FORMAT JSONEachRow`,
		{ params: { project: projectId } }
	);
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const row = JSON.parse(line) as { event: string; count: string };
			return { event: row.event, count: Number(row.count) };
		});
}

export interface PropertyName {
	name: string;
	/** Seen with a number value; the property maths offer these. */
	numeric: boolean;
}

/** Event property names seen in the last 30 days, sorted. */
export async function propertyNames(
	config: ClickHouseConfig,
	projectId: string
): Promise<PropertyName[]> {
	const body = await clickhouseQuery(
		config,
		`SELECT distinctJSONPathsAndTypes(properties) AS paths FROM events
		WHERE project_id = {project:UUID} AND timestamp > now() - INTERVAL 30 DAY
		FORMAT JSONEachRow`,
		{ params: { project: projectId } }
	);
	const { paths } = JSON.parse(body) as { paths: Record<string, string[]> };
	return Object.entries(paths)
		.filter(([name]) => validName(name))
		.map(([name, types]) => ({
			name,
			numeric: types.some((type) => /^(U?Int|Float)\d+$/.test(type))
		}))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
