import { CATEGORY_KEYS, type UsageCategory, type UsageRange } from '../usage';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { chTime, timeWindow } from './web';

export interface ProjectVolume {
	id: string;
	/** Events stored on each day of `buckets`. */
	daily: number[];
	total: number;
	categories: Record<UsageCategory, number>;
}

export interface UsageVolume {
	range: UsageRange;
	from: string;
	to: string;
	/** Start of each UTC day in the range. */
	buckets: string[];
	/** One entry per requested project, in the order asked for, including those without events. */
	projects: ProjectVolume[];
	categories: Record<UsageCategory, number>;
	total: number;
}

export interface TableStorage {
	database: string;
	table: string;
	rows: number;
	parts: number;
	compressedBytes: number;
	uncompressedBytes: number;
}

export interface StorageUsage {
	/** The database Tracemark's tables live in. */
	database: string;
	/** Every table ClickHouse reports active parts for, largest on disk first. */
	tables: TableStorage[];
	/** Each requested project's share of the events table on disk, by its share of the rows. */
	estimates: Record<string, number>;
}

// Keep in sync with USAGE_CATEGORIES.
const CATEGORY_SQL = `multiIf(
	event IN ('$pageview', '$pageleave'), 'pageview',
	event IN ('$autocapture', '$web_vitals'), 'autocapture',
	event = '$exception', 'exception',
	startsWith(event, '$ai_'), 'ai',
	event IN ('$identify', '$set', '$groupidentify'), 'identity',
	startsWith(event, '$'), 'other',
	'custom'
)`;

function rows<T>(body: string): T[] {
	return body
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T);
}

const emptyCategories = () =>
	Object.fromEntries(CATEGORY_KEYS.map((key) => [key, 0])) as Record<UsageCategory, number>;

/**
 * Events stored per project, day and category. Days follow `inserted_at`, when ClickHouse stored
 * the event, not when it happened, so a batch of old events counts on the day it arrived. Rows
 * not yet deduplicated by a merge count each time, as they take disk space until then.
 */
export async function usageVolume(
	config: ClickHouseConfig,
	projectIds: string[],
	options: { range: UsageRange; now?: Date }
): Promise<UsageVolume> {
	const { from, to, buckets } = timeWindow(options.range, options.now);
	const body = projectIds.length
		? await clickhouseQuery(
				config,
				`SELECT
					toString(project_id) AS project,
					formatDateTime(toStartOfDay(inserted_at), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS t,
					${CATEGORY_SQL} AS category,
					count() AS events
				FROM events
				WHERE project_id IN {projects:Array(UUID)}
					AND inserted_at >= {from:DateTime64(3, 'UTC')}
					AND inserted_at <= {to:DateTime64(3, 'UTC')}
				GROUP BY project, t, category
				FORMAT JSONEachRow`,
				{ params: { projects: projectIds, from: chTime(from), to: chTime(to) } }
			)
		: '';

	const index = new Map(buckets.map((t, i) => [t, i]));
	const byProject = new Map<string, ProjectVolume>(
		projectIds.map((id) => [
			id,
			{ id, daily: buckets.map(() => 0), total: 0, categories: emptyCategories() }
		])
	);
	const categories = emptyCategories();
	let total = 0;
	for (const row of rows<{ project: string; t: string; category: UsageCategory; events: string }>(
		body
	)) {
		const project = byProject.get(row.project);
		const day = index.get(row.t);
		if (!project || day === undefined) continue;
		const count = Number(row.events);
		project.daily[day] += count;
		project.total += count;
		project.categories[row.category] += count;
		categories[row.category] += count;
		total += count;
	}
	return {
		range: options.range,
		from: from.toISOString(),
		to: to.toISOString(),
		buckets,
		projects: projectIds.map((id) => byProject.get(id) as ProjectVolume),
		categories,
		total
	};
}

/**
 * Splits `bytes` across projects by their share of `rows`. An estimate: projects' events differ
 * in size, and parts hold deleted and duplicate rows until they merge.
 */
export function estimateBytes(
	rows: Map<string, number>,
	bytes: number,
	projectIds: string[]
): Record<string, number> {
	let total = 0;
	for (const count of rows.values()) total += count;
	return Object.fromEntries(
		projectIds.map((id) => [id, total ? Math.round(((rows.get(id) ?? 0) / total) * bytes) : 0])
	);
}

/**
 * Disk use of every table on the ClickHouse server (active parts only), with each project's
 * estimated share of the events table. Null when the ClickHouse user can't read `system.parts`.
 */
export async function storageUsage(
	config: ClickHouseConfig,
	projectIds: string[]
): Promise<StorageUsage | null> {
	let partsBody: string;
	try {
		partsBody = await clickhouseQuery(
			config,
			`SELECT
				database,
				table,
				sum(rows) AS rows,
				count() AS parts,
				sum(data_compressed_bytes) AS compressedBytes,
				sum(data_uncompressed_bytes) AS uncompressedBytes
			FROM system.parts
			WHERE active
			GROUP BY database, table
			ORDER BY compressedBytes DESC, database, table
			FORMAT JSONEachRow`
		);
	} catch (err) {
		console.warn('storage usage unavailable:', err);
		return null;
	}
	const tables = rows<Record<keyof TableStorage, string>>(partsBody).map((row) => ({
		database: row.database,
		table: row.table,
		rows: Number(row.rows),
		parts: Number(row.parts),
		compressedBytes: Number(row.compressedBytes),
		uncompressedBytes: Number(row.uncompressedBytes)
	}));

	// Every project's rows, so the shares add up across organizations.
	const rowsBody = await clickhouseQuery(
		config,
		`SELECT toString(project_id) AS project, count() AS rows
		FROM events
		GROUP BY project
		FORMAT JSONEachRow`
	);
	const projectRows = new Map(
		rows<{ project: string; rows: string }>(rowsBody).map((row) => [row.project, Number(row.rows)])
	);
	const events = tables.find((t) => t.database === config.database && t.table === 'events');
	return {
		database: config.database,
		tables,
		estimates: estimateBytes(projectRows, events?.compressedBytes ?? 0, projectIds)
	};
}
