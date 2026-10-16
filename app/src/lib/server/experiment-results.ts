// Experiment results from ClickHouse: who saw which variant of the flag, and what they did after.
import type { ExperimentMetric } from '../experiments';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { PERSON } from './insights';
import { chTime } from './web';

export interface VariantCounts {
	variant: string;
	/** People whose first answer for the flag in the window was this variant. */
	people: number;
	/** Per metric: people who converted, or events in total, after their first exposure. */
	values: number[];
}

const ALIASES = `LEFT JOIN (SELECT alias, person FROM person_distinct_ids WHERE project_id = {project:UUID}) AS a
	ON a.alias = e.distinct_id`;

/**
 * Counts per variant. Exposure comes from `$feature_flag_called` events; a person belongs to the
 * variant they were first served, and people first served something else (false, an old variant)
 * are left out. Metric events only count from a person's first exposure to the end of the window.
 */
export async function experimentCounts(
	config: ClickHouseConfig,
	projectId: string,
	query: {
		flag: string;
		variants: string[];
		metrics: ExperimentMetric[];
		from: Date;
		to: Date;
	}
): Promise<VariantCounts[]> {
	const params: Record<string, string | string[]> = {
		project: projectId,
		flag: query.flag,
		variants: query.variants,
		events: query.metrics.map((metric) => metric.event),
		from: chTime(query.from),
		to: chTime(query.to)
	};
	const window = `e.project_id = {project:UUID}
		AND e.timestamp >= {from:DateTime64(3, 'UTC')}
		AND e.timestamp < {to:DateTime64(3, 'UTC')}`;
	const values = query.metrics.map((metric, i) => {
		params[`m${i}`] = metric.event;
		const after = `m.event = {m${i}:String} AND m.timestamp >= x.first_seen`;
		return metric.kind === 'conversion'
			? `toUInt64(uniqExactIf(x.person, ${after}))`
			: `toUInt64(countIf(${after}))`;
	});
	const joined = query.metrics.length
		? `LEFT JOIN (
			SELECT ${PERSON} AS person, e.event AS event, e.timestamp AS timestamp
			FROM events AS e ${ALIASES}
			WHERE ${window} AND e.event IN {events:Array(String)}
		) AS m ON m.person = x.person`
		: '';
	const body = await clickhouseQuery(
		config,
		`SELECT x.variant AS variant, uniqExact(x.person) AS people,
			[${values.join(', ')}]::Array(UInt64) AS values
		FROM (
			SELECT ${PERSON} AS person,
				argMin(toString(e.properties.\`$feature_flag_response\`), e.timestamp) AS variant,
				min(e.timestamp) AS first_seen
			FROM events AS e ${ALIASES}
			WHERE ${window}
				AND e.event = '$feature_flag_called'
				AND toString(e.properties.\`$feature_flag\`) = {flag:String}
			GROUP BY person
		) AS x
		${joined}
		WHERE x.variant IN {variants:Array(String)}
		GROUP BY x.variant
		FORMAT JSONEachRow`,
		{ params }
	);
	const rows = body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as { variant: string; people: string; values: string[] });
	// Every variant gets a row, in the flag's order, even before anyone saw it.
	return query.variants.map((variant) => {
		const row = rows.find((r) => r.variant === variant);
		return {
			variant,
			people: Number(row?.people ?? 0),
			values: query.metrics.map((_, i) => Number(row?.values[i] ?? 0))
		};
	});
}
