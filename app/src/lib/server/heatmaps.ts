// Click heatmaps from autocaptured clicks and `$heatmap_click` events (see docs/heatmaps.md).

import {
	HEATMAP_COLUMNS,
	HEATMAP_DEVICES,
	HEATMAP_MAX_ROWS,
	type Heatmap,
	type HeatmapDevice,
	type HeatmapPage
} from '../heatmaps';
import type { InternalRule } from '../internal-users';
import type { Range } from '../web';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import { internalUsersSql } from './internal-users';
import { chTime, rows, str, timeWindow } from './web';

export type { Heatmap, HeatmapDevice, HeatmapPage };

interface Options {
	range: Range;
	now?: Date;
	internal?: InternalRule[];
}

const num = (path: string) => `toFloat64OrNull(toString(e.properties.\`${path}\`))`;

/** Window parameters and the condition every click query starts from. */
function clicksWhere(projectId: string, options: Options) {
	const { from, to } = timeWindow(options.range, options.now);
	const params: Record<string, string> = {
		project: projectId,
		from: chTime(from),
		to: chTime(to)
	};
	const internal = internalUsersSql(options.internal, params);
	const where = `e.project_id = {project:UUID}
		AND e.timestamp >= {from:DateTime64(3, 'UTC')}
		AND e.timestamp < {to:DateTime64(3, 'UTC')}
		AND ${str('$device_type')} != 'Bot'${internal}`;
	const clicks = `${where}
		AND (e.event = '$heatmap_click' OR (e.event = '$autocapture' AND ${str('$event_type')} = 'click'))`;
	return { params, where, clicks };
}

/**
 * The most clicked paths over the last `range`, and the origins pages were viewed on, most
 * viewed first, to load a page behind the heatmap.
 */
export async function heatmapPages(
	config: ClickHouseConfig,
	projectId: string,
	options: Options
): Promise<{ pages: HeatmapPage[]; origins: string[] }> {
	const { params, where, clicks } = clicksWhere(projectId, options);
	const [pagesBody, originsBody] = await Promise.all([
		clickhouseQuery(
			config,
			`SELECT ${str('$pathname')} AS path, count() AS clicks
			FROM events AS e
			WHERE ${clicks} AND path != ''
			GROUP BY path ORDER BY clicks DESC, path LIMIT 25
			FORMAT JSONEachRow`,
			{ params }
		),
		clickhouseQuery(
			config,
			`SELECT extract(${str('$current_url')}, '^(https?://[^/?#]+)') AS origin, count() AS views
			FROM events AS e
			WHERE ${where} AND e.event IN ('$pageview', '$autocapture') AND origin != ''
			GROUP BY origin ORDER BY views DESC, origin LIMIT 5
			FORMAT JSONEachRow`,
			{ params }
		)
	]);
	return {
		pages: rows<{ path: string; clicks: string }>(pagesBody).map((row) => ({
			path: row.path,
			clicks: Number(row.clicks)
		})),
		origins: rows<{ origin: string }>(originsBody).map((row) => row.origin)
	};
}

/**
 * Click density on one path for one device size, binned into a grid of `HEATMAP_COLUMNS`
 * columns and as many rows as keep the cells square on the typical page, and the most clicked
 * elements there. Positions are fractions of the document, so clicks line up however far the
 * page was scrolled.
 */
export async function heatmap(
	config: ClickHouseConfig,
	projectId: string,
	options: Options & { path: string; device: HeatmapDevice }
): Promise<Heatmap> {
	const { params, clicks } = clicksWhere(projectId, options);
	const device = HEATMAP_DEVICES[options.device];
	params.path = options.path;
	params.vmin = String(device.min);
	if (device.max !== null) params.vmax = String(device.max);
	const cte = `WITH clicks AS (
		SELECT
			e.event AS event,
			${num('$click_x')} AS x,
			${num('$click_y')} AS y,
			${num('$document_height')} AS doc_height,
			${num('$viewport_width')} AS vw,
			${str('$el_selector')} AS selector,
			${str('$el_text')} AS text
		FROM events AS e
		WHERE ${clicks} AND ${str('$pathname')} = {path:String}
	),
	device_clicks AS (
		SELECT * FROM clicks
		WHERE vw >= {vmin:Float64}${device.max !== null ? ' AND vw <= {vmax:Float64}' : ''}
	)`;
	const run = (select: string) =>
		clickhouseQuery(config, `${cte} ${select} FORMAT JSONEachRow`, { params });
	const placed = 'x IS NOT NULL AND y IS NOT NULL';
	const [shapeBody, elementsBody] = await Promise.all([
		run(`SELECT
				countIf(${placed}) AS clicks,
				medianIf(doc_height, ${placed} AND doc_height > 0) AS doc_height,
				medianIf(vw, ${placed}) AS vw
			FROM device_clicks`),
		run(`SELECT selector, text, event = '$heatmap_click' AS other, count() AS clicks
			FROM device_clicks
			WHERE selector != ''
			GROUP BY selector, text, other
			ORDER BY clicks DESC, selector, text LIMIT 20`)
	]);
	const shape = rows<Record<string, string | number | null>>(shapeBody)[0];
	const total = Number(shape?.clicks ?? 0);
	const finite = (value: unknown, fallback: number) => {
		const n = Number(value);
		return value != null && Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
	};
	const viewportWidth = finite(shape?.vw, device.width);
	const documentHeight = finite(shape?.doc_height, viewportWidth * 2);
	const gridRows = Math.min(
		HEATMAP_MAX_ROWS,
		Math.max(1, Math.round((HEATMAP_COLUMNS * documentHeight) / viewportWidth))
	);
	let cells: [number, number, number][] = [];
	if (total > 0) {
		params.cols = String(HEATMAP_COLUMNS);
		params.rows = String(gridRows);
		const bin = (v: string, n: string) =>
			`toUInt32(greatest(0., least({${n}:UInt32} - 1., floor(${v} * {${n}:UInt32}))))`;
		const cellsBody =
			await run(`SELECT ${bin('x', 'cols')} AS cx, ${bin('y', 'rows')} AS cy, count() AS c
			FROM device_clicks WHERE ${placed}
			GROUP BY cx, cy ORDER BY cx, cy`);
		cells = rows<{ cx: number; cy: number; c: string }>(cellsBody).map((row) => [
			Number(row.cx),
			Number(row.cy),
			Number(row.c)
		]);
	}
	return {
		path: options.path,
		device: options.device,
		columns: HEATMAP_COLUMNS,
		rows: gridRows,
		clicks: total,
		cells,
		documentHeight,
		viewportWidth,
		elements: rows<{ selector: string; text: string; other: number; clicks: string }>(
			elementsBody
		).map((row) => ({
			selector: row.selector,
			text: row.text,
			clicks: Number(row.clicks),
			other: Boolean(Number(row.other))
		}))
	};
}
