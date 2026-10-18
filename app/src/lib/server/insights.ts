import type { CohortSpec } from '../cohorts';
import {
	type FunnelQuery,
	type FunnelResult,
	LIFECYCLE_STATUSES,
	type LifecycleQuery,
	type LifecycleResult,
	type LifecycleStatus,
	MAX_LINES,
	MAX_PATH_NODES,
	needsProperty,
	type PathLink,
	type PathNode,
	type PathStep,
	type PathsQuery,
	type PathsResult,
	type PropertyFilter,
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
import { cohortPeopleSql } from './cohort-people';
import { compareSql } from './compare';
import { chTime, timeWindow } from './web';

export type { FunnelResult, LifecycleResult, PathsResult, RetentionResult, TrendsResult };

/** An event property as a ClickHouse expression. Names are validated, so quoting is enough. */
function property(name: string): string {
	if (!validName(name)) throw new Error(`invalid property name ${JSON.stringify(name)}`);
	return `e.properties.\`${name}\``;
}

export function filterSql(filter: PropertyFilter, param: string): string {
	return compareSql(`toString(${property(filter.property)})`, filter.operator, param);
}

/**
 * The FROM, JOIN and WHERE shared by every insight: a project's events in a time window with
 * property filters applied, joined to people. Selects can use `e.*` and `person`.
 */
function eventsSource(
	projectId: string,
	window: { from: Date; to: Date },
	filters: PropertyFilter[],
	cohort?: CohortSpec
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
	if (cohort) conditions.push(` AND ${PERSON} IN (${cohortPeopleSql(cohort, params)})`);
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

export const PERSON = `if(a.person = '', e.distinct_id, a.person)`;

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
	now?: Date,
	cohort?: CohortSpec
): Promise<TrendsResult> {
	const { bucket, bucketFn, from, to, buckets } = timeWindow(query.range, now);
	const source = eventsSource(projectId, { from, to }, query.filters, cohort);
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
	now?: Date,
	cohort?: CohortSpec
): Promise<FunnelResult> {
	const { from, to } = timeWindow(query.range, now);
	const source = eventsSource(projectId, { from, to }, query.filters, cohort);
	const params: Record<string, string> = {
		...source.params,
		window: String(WINDOWS[query.window].ms)
	};
	query.steps.forEach((step, i) => {
		params[`s${i}`] = step;
	});
	const conditions = query.steps.map((_, i) => `event = {s${i}:String}`).join(', ');
	// strict_once: one event counts for one step only, so a repeated step needs a second event.
	const breakdown = query.breakdown ? `toString(${property(query.breakdown)})` : `''`;
	const body = await clickhouseQuery(
		config,
		`SELECT value, level, count() AS people FROM (
			SELECT
				person,
				argMinIf(value, ts, event = {s0:String}) AS value,
				windowFunnel({window:UInt64}, 'strict_once')(toUInt64(toUnixTimestamp64Milli(ts)), ${conditions}) AS level
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
	now?: Date,
	cohort?: CohortSpec
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

	const source = eventsSource(projectId, window, query.filters, cohort);
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

/** Labels in the order SQL ranks ties, with the other group (null) last. */
function compareLabels(a: string | null, b: string | null): number {
	if (a === b) return 0;
	if (a === null || b === null) return a === null ? 1 : -1;
	return a < b ? -1 : 1;
}

/** Most sessions first, with the other group last. */
const byNode = (a: PathNode, b: PathNode) =>
	(a.label === null ? 1 : 0) - (b.label === null ? 1 : 0) ||
	b.sessions - a.sessions ||
	compareLabels(a.label, b.label);

const byLink = (a: PathLink, b: PathLink) =>
	b.sessions - a.sessions || compareLabels(a.source, b.source) || compareLabels(a.target, b.target);

/**
 * The most common paths through sessions. A session's steps are its page views (named by path)
 * or its events (named by event, without $pageleave), in time order with repeats in a row
 * collapsed. A path begins at the first start and stops at the first end after it; sessions
 * without them are left out. Each step keeps its MAX_PATH_NODES busiest labels and groups the
 * rest as other. Events without a session id form one session per person.
 */
export async function paths(
	config: ClickHouseConfig,
	projectId: string,
	query: PathsQuery,
	now?: Date,
	cohort?: CohortSpec
): Promise<PathsResult> {
	const { from, to } = timeWindow(query.range, now);
	const source = eventsSource(projectId, { from, to }, query.filters, cohort);
	const page = query.label === 'page';
	// With only an end, the path is reversed so its first step is the end, then flipped back.
	const reversed = !query.start && !!query.end;
	const depth = query.steps + 1;
	const body = await clickhouseQuery(
		config,
		`WITH
			collapsed AS (
				SELECT arrayFilter((x, i) -> i = 1 OR x != raw[i - 1], raw, arrayEnumerate(raw)) AS steps
				FROM (
					SELECT arrayMap(x -> x.2, arraySort(x -> x.1, groupArray((ts, label)))) AS raw
					FROM (
						SELECT
							if(e.session_id = '', concat('person:', ${PERSON}), e.session_id) AS session,
							e.timestamp AS ts,
							${page ? `toString(${property('$pathname')})` : 'toString(e.event)'} AS label
						${source.sql}
							AND ${page ? `e.event = '$pageview'` : `e.event != '$pageleave'`}
					)
					GROUP BY session
				)
			),
			started AS (
				SELECT if({start:String} = '', steps, arraySlice(steps, indexOf(steps, {start:String}))) AS steps
				FROM collapsed
				WHERE {start:String} = '' OR has(steps, {start:String})
			),
			ended AS (
				SELECT if({end:String} = '', steps, arraySlice(steps, 1, indexOf(steps, {end:String}))) AS steps
				FROM started
				WHERE {end:String} = '' OR has(steps, {end:String})
			),
			-- One step more than shown, so a path that goes on past the last step does not count as ending there.
			cut AS (
				SELECT arraySlice(${reversed ? 'arrayReverse(steps)' : 'steps'}, 1, ${depth + 1}) AS path
				FROM ended
				WHERE length(steps) > 0
			),
			transitions AS (
				SELECT
					n,
					path[n] AS label,
					if(n < length(path), toNullable(path[n + 1]), NULL) AS next,
					count() AS sessions
				FROM cut ARRAY JOIN arrayEnumerate(path) AS n
				WHERE n <= ${depth}
				GROUP BY n, label, next
			),
			-- Every path at step n + 1 came from step n, so ranking a step's targets by the sessions
			-- going into them ranks the next step's labels.
			ranked AS (
				SELECT *,
					dense_rank() OVER (PARTITION BY n ORDER BY label_total DESC, label) AS label_rank,
					dense_rank() OVER (PARTITION BY n, isNull(next) ORDER BY next_total DESC, next) AS next_rank
				FROM (
					SELECT *,
						sum(sessions) OVER (PARTITION BY n, label) AS label_total,
						sum(sessions) OVER (PARTITION BY n, next) AS next_total
					FROM transitions
				)
			)
		SELECT
			n,
			if(label_rank <= ${MAX_PATH_NODES}, toNullable(label), NULL) AS source,
			isNull(next) AS ended,
			if(isNull(next) OR next_rank > ${MAX_PATH_NODES}, NULL, next) AS target,
			sum(sessions) AS count
		FROM ranked
		GROUP BY n, source, ended, target
		FORMAT JSONEachRow`,
		{ params: { ...source.params, start: query.start ?? '', end: query.end ?? '' } }
	);

	const found: { nodes: Map<string | null, PathNode>; links: PathLink[] }[] = [];
	for (const line of body.split('\n').filter(Boolean)) {
		const row = JSON.parse(line) as {
			n: number;
			source: string | null;
			ended: number | boolean;
			target: string | null;
			count: string;
		};
		while (found.length < row.n) found.push({ nodes: new Map(), links: [] });
		const step = found[row.n - 1];
		const sessions = Number(row.count);
		let node = step.nodes.get(row.source);
		if (!node) {
			node = { label: row.source, sessions: 0, ended: 0 };
			step.nodes.set(row.source, node);
		}
		node.sessions += sessions;
		if (row.ended) node.ended += sessions;
		// Transitions out of the last step shown only tell whether the path went on.
		else if (row.n < depth) step.links.push({ source: row.source, target: row.target, sessions });
	}
	let steps: PathStep[] = found.map((step) => ({
		nodes: [...step.nodes.values()].sort(byNode),
		links: step.links.sort(byLink)
	}));
	if (reversed) {
		// Links from reversed step n run back in time to step n + 1: swap their ends and move
		// them onto the earlier step.
		const back = steps;
		steps = back
			.map((step, i) => ({
				nodes: step.nodes,
				links: (back[i - 1]?.links ?? [])
					.map((link) => ({ source: link.target, target: link.source, sessions: link.sessions }))
					.sort(byLink)
			}))
			.reverse();
	}
	const sessions = steps.at(reversed ? -1 : 0)?.nodes.reduce((sum, n) => sum + n.sessions, 0) ?? 0;
	return { steps, sessions };
}

/** A UTC period start as ISO 8601, like the other insights. */
const isoDay = (date: string) => `${date}T00:00:00Z`;

/** The start of the period holding `time`, in UTC; weeks start on Monday. */
function periodStart(interval: LifecycleQuery['interval'], time: Date): Date {
	const day = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate());
	if (interval === 'day') return new Date(day);
	if (interval === 'week') return new Date(day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS);
	return new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), 1));
}

function nextPeriod(interval: LifecycleQuery['interval'], start: Date): Date {
	if (interval === 'day') return new Date(start.getTime() + DAY_MS);
	if (interval === 'week') return new Date(start.getTime() + 7 * DAY_MS);
	return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

const LIFECYCLE_SQL = {
	day: { trunc: 'toDate(e.timestamp)', add: 'addDays' },
	week: { trunc: 'toStartOfWeek(e.timestamp, 1)', add: 'addWeeks' },
	month: { trunc: 'toStartOfMonth(e.timestamp)', add: 'addMonths' }
} as const;

/**
 * People by lifecycle state in each period of the range: new (first did the event ever),
 * returning, resurrecting and dormant, as PostHog defines them (see LIFECYCLE_STATUSES). The
 * first period is whole even when the range starts inside it, and "ever" looks back over all
 * the project's events.
 */
export async function lifecycle(
	config: ClickHouseConfig,
	projectId: string,
	query: LifecycleQuery,
	now?: Date,
	cohort?: CohortSpec
): Promise<LifecycleResult> {
	const { interval } = query;
	const window = timeWindow(query.range, now);
	const first = periodStart(interval, window.from);
	const periods: string[] = [];
	for (let t = first; t < window.to; t = nextPeriod(interval, t)) {
		periods.push(t.toISOString().replace('.000Z', 'Z'));
	}
	// The period before the first, to tell returning from resurrecting and who went dormant.
	const previous = periodStart(interval, new Date(first.getTime() - DAY_MS));

	const source = eventsSource(
		projectId,
		{ from: new Date(0), to: window.to },
		query.filters,
		cohort
	);
	const { trunc, add } = LIFECYCLE_SQL[interval];
	const date = (d: Date) => d.toISOString().slice(0, 10);
	const body = await clickhouseQuery(
		config,
		`WITH people AS (
			SELECT
				${PERSON} AS person,
				min(${trunc}) AS first,
				groupUniqArrayIf(${trunc}, e.timestamp >= {previous:DateTime64(3, 'UTC')}) AS active
			${source.sql}
				AND e.event = {event:String}
			GROUP BY person
		)
		SELECT formatDateTime(period, '%Y-%m-%d') AS period, status, count() AS people FROM (
			SELECT p AS period, multiIf(p = first, 'new', has(active, ${add}(p, -1)), 'returning', 'resurrecting') AS status
			FROM people ARRAY JOIN active AS p
			WHERE p >= {first:Date}
			UNION ALL
			SELECT ${add}(p, 1) AS period, 'dormant' AS status
			FROM people ARRAY JOIN active AS p
			WHERE NOT has(active, ${add}(p, 1)) AND ${add}(p, 1) BETWEEN {first:Date} AND {last:Date}
		)
		GROUP BY period, status
		FORMAT JSONEachRow`,
		{
			params: {
				...source.params,
				event: query.event,
				previous: chTime(previous),
				first: date(first),
				last: periods.at(-1)?.slice(0, 10) ?? date(first)
			}
		}
	);

	const counts = Object.fromEntries(
		LIFECYCLE_STATUSES.map((status) => [status, periods.map(() => 0)])
	) as LifecycleResult['counts'];
	for (const line of body.split('\n').filter(Boolean)) {
		const row = JSON.parse(line) as {
			period: string;
			status: LifecycleStatus;
			people: string;
		};
		const i = periods.indexOf(isoDay(row.period));
		if (i < 0 || !(row.status in counts)) continue;
		counts[row.status][i] = row.status === 'dormant' ? -Number(row.people) : Number(row.people);
	}
	return { interval, periods, counts };
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

/** Page paths viewed in the last 30 days, most viewed first. */
export async function pagePaths(config: ClickHouseConfig, projectId: string): Promise<string[]> {
	const body = await clickhouseQuery(
		config,
		`SELECT toString(properties.\`$pathname\`) AS path FROM events
		WHERE project_id = {project:UUID} AND event = '$pageview' AND timestamp > now() - INTERVAL 30 DAY
			AND path != ''
		GROUP BY path ORDER BY count() DESC, path LIMIT 200
		FORMAT JSONEachRow`,
		{ params: { project: projectId } }
	);
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => (JSON.parse(line) as { path: string }).path);
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
