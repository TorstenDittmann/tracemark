import type { InternalRule } from '../internal-users';
import {
	DIMENSIONS,
	type Dimension,
	parseFilters,
	parseRange,
	RANGES,
	type Range,
	VITAL_FILTERS,
	VITALS,
	type Vital,
	type VitalSummary,
	type WebFilters,
	type WebVitals
} from '../web';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { internalUsersSql } from './internal-users';

export type { Dimension, Range, WebFilters, WebVitals };
export { DIMENSIONS, parseFilters, parseRange, RANGES };

const COLUMNS: Record<Exclude<Dimension, 'page'>, string> = {
	entry: 'entry',
	exit: 'exit',
	referrer: 'referrer',
	utm_source: 'utm_source',
	utm_medium: 'utm_medium',
	utm_campaign: 'utm_campaign',
	country: 'country',
	device: 'device',
	browser: 'browser',
	os: 'os'
};

export interface WebOverview {
	visitors: number;
	pageviews: number;
	sessions: number;
	/** Share of sessions with a single page view, 0 to 1. */
	bounceRate: number;
	/** Mean session length in seconds, from first to last event. */
	avgDuration: number;
}

export interface WebSeriesPoint {
	/** Bucket start, ISO 8601 in UTC. */
	t: string;
	visitors: number;
	pageviews: number;
}

export interface WebBreakdownRow {
	value: string;
	visitors: number;
	pageviews: number;
}

export interface WebAnalytics {
	range: Range;
	from: string;
	to: string;
	bucket: 'hour' | 'day';
	overview: WebOverview;
	series: WebSeriesPoint[];
	breakdowns: Record<Dimension, WebBreakdownRow[]>;
}

/** Idle time after which a visitor without a session id starts a new session. */
const SESSION_GAP_SECONDS = 30 * 60;

const str = (path: string) => `ifNull(e.properties.\`${path}\`.:String, '')`;

/**
 * One row per session in the window, built from `$pageview` and `$pageleave` events. Visitors
 * are people: an anonymous id linked to an identified one by `$identify` counts once. Events
 * without a session id (cookieless SDKs) are split into sessions per person wherever 30 minutes
 * pass without an event. Bot traffic is left out, and so are internal users when `internal`
 * (their condition from internalUsersSql) is given.
 */
function sessionsQuery(filters: WebFilters, internal: string): string {
	const conditions = (Object.keys(filters) as Dimension[]).map((key) =>
		key === 'page' ? `has(pages, {f_page:String})` : `${COLUMNS[key]} = {f_${key}:String}`
	);
	return `sessions AS (
		SELECT * FROM (
			SELECT
				session,
				any(person) AS person,
				min(ts) AS started,
				max(ts) AS ended,
				groupArrayIf(ts, is_pageview) AS times,
				groupArrayIf(pathname, is_pageview) AS pages,
				argMinIf(pathname, ts, is_pageview) AS entry,
				argMaxIf(pathname, ts, is_pageview) AS exit,
				argMinIf(referrer, ts, is_pageview) AS referrer,
				argMinIf(utm_source, ts, is_pageview) AS utm_source,
				argMinIf(utm_medium, ts, is_pageview) AS utm_medium,
				argMinIf(utm_campaign, ts, is_pageview) AS utm_campaign,
				argMinIf(country, ts, is_pageview) AS country,
				argMinIf(device, ts, is_pageview) AS device,
				argMinIf(browser, ts, is_pageview) AS browser,
				argMinIf(os, ts, is_pageview) AS os
			FROM (
				SELECT *, if(sid = '', concat(person, '/', toString(sum(gap) OVER (
					PARTITION BY person, sid ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
				))), sid) AS session
				FROM (
				SELECT *, dateDiff('second', lagInFrame(ts, 1, ts) OVER (
					PARTITION BY person, sid ORDER BY ts ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
				), ts) > ${SESSION_GAP_SECONDS} AS gap
				FROM (
				SELECT
					e.timestamp AS ts,
					e.event = '$pageview' AS is_pageview,
					if(a.person = '', e.distinct_id, a.person) AS person,
					e.session_id AS sid,
					${str('$pathname')} AS pathname,
					if(${str('$referring_domain')} = '$direct', '', ${str('$referring_domain')}) AS referrer,
					${str('utm_source')} AS utm_source,
					${str('utm_medium')} AS utm_medium,
					${str('utm_campaign')} AS utm_campaign,
					${str('$geoip_country_code')} AS country,
					${str('$device_type')} AS device,
					${str('$browser')} AS browser,
					${str('$os')} AS os
				FROM events AS e
				LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
					ON a.alias = e.distinct_id
				WHERE e.project_id = {project:UUID}
					AND e.event IN ('$pageview', '$pageleave')
					AND e.timestamp >= {from:DateTime64(3, 'UTC')}
					AND e.timestamp < {to:DateTime64(3, 'UTC')}${internal}
				)
				)
			)
			GROUP BY session
		)
		WHERE length(pages) > 0 AND device != 'Bot'${conditions.map((c) => ` AND ${c}`).join('')}
	)`;
}

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

const num = (value: string | number) => Number(value);

export interface TimeWindow {
	bucket: 'hour' | 'day';
	/** ClickHouse function that truncates a timestamp to its bucket. */
	bucketFn: 'toStartOfHour' | 'toStartOfDay';
	from: Date;
	to: Date;
	count: number;
	/** Every bucket start in the window, ISO 8601 without milliseconds. */
	buckets: string[];
}

/** Buckets are aligned to whole hours or days in UTC, so the window starts on a bucket boundary. */
export function timeWindow(range: Range, now?: Date): TimeWindow {
	const { hours, bucket } = RANGES[range];
	const to = new Date(now ?? Date.now());
	const step = bucket === 'hour' ? 3_600_000 : 86_400_000;
	const lastBucket = Math.floor(to.getTime() / step) * step;
	const count = Math.round((hours * 3_600_000) / step);
	const from = new Date(lastBucket - (count - 1) * step);
	const buckets = Array.from({ length: count }, (_, i) =>
		new Date(from.getTime() + i * step).toISOString().replace('.000Z', 'Z')
	);
	return {
		bucket,
		bucketFn: bucket === 'hour' ? 'toStartOfHour' : 'toStartOfDay',
		from,
		to,
		count,
		buckets
	};
}

/** A Date as a DateTime64 query parameter. */
export const chTime = (date: Date) => date.toISOString().replace('Z', '');

/** Web analytics for a project over the last `range`, narrowed by `filters`. */
export async function webAnalytics(
	config: ClickHouseConfig,
	projectId: string,
	options: { range: Range; filters?: WebFilters; now?: Date; internal?: InternalRule[] }
): Promise<WebAnalytics> {
	const { range } = options;
	const filters = options.filters ?? {};
	const { bucket, bucketFn, from, to, buckets } = timeWindow(range, options.now);
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(from),
		to: chTime(to)
	};
	for (const [key, value] of Object.entries(filters)) params[`f_${key}`] = value;
	const sessions = sessionsQuery(filters, internalUsersSql(options.internal, params));
	const run = (select: string) =>
		clickhouseQuery(config, `WITH ${sessions} ${select} FORMAT JSONEachRow`, {
			params
		});

	const overviewQuery = run(`SELECT
			uniqExact(person) AS visitors,
			sum(length(pages)) AS pageviews,
			count() AS sessions,
			if(count() = 0, 0, countIf(length(pages) = 1) / count()) AS bounceRate,
			if(count() = 0, 0, avg(dateDiff('millisecond', started, ended)) / 1000) AS avgDuration
		FROM sessions`);

	const seriesQuery = run(`SELECT
			formatDateTime(${bucketFn}(viewed), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS t,
			uniqExact(person) AS visitors,
			count() AS pageviews
		FROM sessions ARRAY JOIN times AS viewed
		GROUP BY t ORDER BY t`);

	const breakdownQuery = (dimension: Dimension) =>
		dimension === 'page'
			? run(`SELECT page AS value, uniqExact(person) AS visitors, count() AS pageviews
				FROM sessions ARRAY JOIN pages AS page
				GROUP BY value ORDER BY visitors DESC, pageviews DESC, value LIMIT 10`)
			: run(`SELECT ${COLUMNS[dimension]} AS value, uniqExact(person) AS visitors, sum(length(pages)) AS pageviews
				FROM sessions
				GROUP BY value ORDER BY visitors DESC, pageviews DESC, value LIMIT 10`);

	const dimensions = Object.keys(DIMENSIONS) as Dimension[];
	const [overviewBody, seriesBody, ...breakdownBodies] = await Promise.all([
		overviewQuery,
		seriesQuery,
		...dimensions.map(breakdownQuery)
	]);

	const [overview] = rows<Record<keyof WebOverview, string | number>>(overviewBody);
	const byBucket = new Map(
		rows<{ t: string; visitors: string; pageviews: string }>(seriesBody).map((row) => [row.t, row])
	);
	const series = buckets.map((t) => {
		const row = byBucket.get(t);
		return { t, visitors: row ? num(row.visitors) : 0, pageviews: row ? num(row.pageviews) : 0 };
	});
	const breakdowns = Object.fromEntries(
		dimensions.map((dimension, i) => [
			dimension,
			rows<{ value: string; visitors: string; pageviews: string }>(breakdownBodies[i]).map(
				(row) => ({ value: row.value, visitors: num(row.visitors), pageviews: num(row.pageviews) })
			)
		])
	) as Record<Dimension, WebBreakdownRow[]>;

	return {
		range,
		from: from.toISOString(),
		to: to.toISOString(),
		bucket,
		overview: {
			visitors: num(overview.visitors),
			pageviews: num(overview.pageviews),
			sessions: num(overview.sessions),
			bounceRate: num(overview.bounceRate),
			avgDuration: num(overview.avgDuration)
		},
		series,
		breakdowns
	};
}

const VITAL_COLUMNS: Record<(typeof VITAL_FILTERS)[number], string> = {
	page: '$pathname',
	country: '$geoip_country_code',
	device: '$device_type',
	browser: '$browser',
	os: '$os'
};

/**
 * The 75th percentile of each web vital over the last `range`, overall and for the busiest paths,
 * from `$web_vitals` events. Only the filters that are properties of each event apply; bot
 * traffic is left out, and internal users with `internal`.
 */
export async function webVitals(
	config: ClickHouseConfig,
	projectId: string,
	options: { range: Range; filters?: WebFilters; now?: Date; internal?: InternalRule[] }
): Promise<WebVitals> {
	const { from, to } = timeWindow(options.range, options.now);
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(from),
		to: chTime(to)
	};
	const conditions: string[] = [];
	for (const key of VITAL_FILTERS) {
		const value = options.filters?.[key];
		if (value === undefined) continue;
		params[`f_${key}`] = value;
		conditions.push(`${str(VITAL_COLUMNS[key])} = {f_${key}:String}`);
	}
	const internal = internalUsersSql(options.internal, params);
	const names = Object.keys(VITALS) as Vital[];
	const measured = `SELECT
			${str('$pathname')} AS path,
			${names
				.map(
					(name) =>
						`toFloat64OrNull(toString(e.properties.\`$web_vitals_${name}_value\`)) AS ${name}`
				)
				.join(',\n\t\t\t')}
		FROM events AS e
		WHERE e.project_id = {project:UUID}
			AND e.event = '$web_vitals'
			AND e.timestamp >= {from:DateTime64(3, 'UTC')}
			AND e.timestamp < {to:DateTime64(3, 'UTC')}
			AND ${str('$device_type')} != 'Bot'${conditions.map((c) => ` AND ${c}`).join('')}${internal}`;
	// NULLs, metrics an event did not carry, are skipped by both aggregates.
	const aggregates = names
		.map((name) => `quantile(0.75)(${name}) AS ${name}_p75, count(${name}) AS ${name}_samples`)
		.join(', ');
	const run = (select: string) =>
		clickhouseQuery(config, `${select} FORMAT JSONEachRow`, { params });
	const [totalBody, pathsBody] = await Promise.all([
		run(`SELECT ${aggregates} FROM (${measured})`),
		run(`SELECT path, count() AS pageviews, ${aggregates} FROM (${measured})
			GROUP BY path ORDER BY pageviews DESC, path LIMIT 10`)
	]);
	type Row = Record<string, string | number | null>;
	const summarize = (row: Row | undefined) =>
		Object.fromEntries(
			names.map((name) => {
				const samples = num(row?.[`${name}_samples`] ?? 0);
				const p75 = row?.[`${name}_p75`];
				return [name, { p75: samples && p75 != null ? num(p75) : null, samples }];
			})
		) as Record<Vital, VitalSummary>;
	return {
		vitals: summarize(rows<Row>(totalBody)[0]),
		paths: rows<Row>(pathsBody).map((row) => ({
			path: String(row.path),
			pageviews: num(row.pageviews ?? 0),
			vitals: summarize(row)
		}))
	};
}
