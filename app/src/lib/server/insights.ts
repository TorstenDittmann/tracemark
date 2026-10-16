import {
	MAX_LINES,
	needsProperty,
	type PropertyFilter,
	type Series,
	seriesLabel,
	type TrendsQuery,
	validName
} from '../insights';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { chTime, timeWindow } from './web';

export interface TrendLine {
	/** Index into the query's series. */
	series: number;
	label: string;
	/** The breakdown value, when the query has a breakdown. */
	breakdown?: string;
	/** One value per bucket. */
	data: number[];
	/** The aggregate over the whole range (not the sum of `data` for unique users or averages). */
	total: number;
}

export interface TrendsResult {
	bucket: 'hour' | 'day';
	buckets: string[];
	lines: TrendLine[];
}

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
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(from),
		to: chTime(to)
	};
	const filters = query.filters.map((filter, i) => {
		if (filter.value !== undefined) params[`v${i}`] = filter.value;
		return ` AND ${filterSql(filter, `v${i}`)}`;
	});
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
						if(a.person = '', e.distinct_id, a.person) AS person,
						${breakdown} AS value,
						${num} AS num
					FROM events AS e
					LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
						ON a.alias = e.distinct_id
					WHERE e.project_id = {project:UUID}
						AND e.event = {event:String}
						AND e.timestamp >= {from:DateTime64(3, 'UTC')}
						AND e.timestamp < {to:DateTime64(3, 'UTC')}${filters.join('')}
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
				{ params: { ...params, event: series.event } }
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
