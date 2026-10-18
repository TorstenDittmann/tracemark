// Insight definitions shared by the editor and the server queries. Queries travel in the URL
// as JSON, so everything here is parsed defensively.
import { parseRange, type Range } from './web';

export const MATHS = {
	total: 'Total count',
	unique_users: 'Unique users',
	sum: 'Sum of property',
	avg: 'Average of property',
	min: 'Minimum of property',
	max: 'Maximum of property'
} as const;

export type Aggregation = keyof typeof MATHS;

export const OPERATORS = {
	eq: 'equals',
	neq: 'does not equal',
	contains: 'contains',
	not_contains: 'does not contain',
	gt: 'greater than',
	lt: 'less than',
	is_set: 'is set',
	is_not_set: 'is not set'
} as const;

export type Operator = keyof typeof OPERATORS;

export interface Series {
	event: string;
	math: Aggregation;
	/** Required for the property maths. */
	property?: string;
}

export interface PropertyFilter {
	property: string;
	operator: Operator;
	value?: string;
}

export interface TrendsQuery {
	series: Series[];
	range: Range;
	breakdown?: string;
	filters: PropertyFilter[];
	/** Only people in this cohort. */
	cohort?: string;
}

export const MAX_SERIES = 5;
export const MAX_FILTERS = 10;
/** Lines drawn at most; the categorical palette has eight distinguishable hues. */
export const MAX_LINES = 8;

const propertyMaths: Aggregation[] = ['sum', 'avg', 'min', 'max'];

export function needsProperty(math: Aggregation): boolean {
	return propertyMaths.includes(math);
}

/** Event and property names as stored: 1 to 200 characters, no backticks or control characters. */
export function validName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= 200 &&
		// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
		!/[`\\\u0000-\u001f]/.test(value)
	);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cohort id from untrusted input, or undefined. */
export function parseCohortId(value: unknown): string | undefined {
	return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined;
}

/** `{ cohort }` when the input names one, so queries without a cohort stay unchanged. */
function cohortOf(input: Record<string, unknown>): { cohort?: string } {
	const cohort = parseCohortId(input.cohort);
	return cohort ? { cohort } : {};
}

export const DEFAULT_TRENDS: TrendsQuery = {
	series: [{ event: '$pageview', math: 'total' }],
	range: '7d',
	filters: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a query from untrusted JSON. Invalid parts are dropped rather than rejected. */
export function parseTrends(input: unknown): TrendsQuery {
	if (!isRecord(input)) return DEFAULT_TRENDS;
	const series: Series[] = [];
	for (const raw of Array.isArray(input.series) ? input.series : []) {
		if (!isRecord(raw) || !validName(raw.event)) continue;
		const math =
			typeof raw.math === 'string' && raw.math in MATHS ? (raw.math as Aggregation) : 'total';
		if (needsProperty(math)) {
			if (!validName(raw.property)) continue;
			series.push({ event: raw.event, math, property: raw.property });
		} else {
			series.push({ event: raw.event, math });
		}
		if (series.length === MAX_SERIES) break;
	}
	const filters: PropertyFilter[] = [];
	for (const raw of Array.isArray(input.filters) ? input.filters : []) {
		if (!isRecord(raw) || !validName(raw.property)) continue;
		if (typeof raw.operator !== 'string' || !(raw.operator in OPERATORS)) continue;
		const operator = raw.operator as Operator;
		if (operator === 'is_set' || operator === 'is_not_set') {
			filters.push({ property: raw.property, operator });
		} else if (typeof raw.value === 'string' && raw.value.length <= 1000) {
			filters.push({ property: raw.property, operator, value: raw.value });
		}
		if (filters.length === MAX_FILTERS) break;
	}
	return {
		series: series.length ? series : DEFAULT_TRENDS.series,
		range: parseRange(typeof input.range === 'string' ? input.range : null),
		breakdown: validName(input.breakdown) ? input.breakdown : undefined,
		filters,
		...cohortOf(input)
	};
}

export function parseTrendsParam(value: string | null): TrendsQuery {
	if (!value) return DEFAULT_TRENDS;
	try {
		return parseTrends(JSON.parse(value));
	} catch {
		return DEFAULT_TRENDS;
	}
}

export function seriesLabel(series: Series): string {
	const event = series.event === '$pageview' ? 'Page views' : series.event;
	switch (series.math) {
		case 'total':
			return event;
		case 'unique_users':
			return `${event} · unique users`;
		default:
			return `${event} · ${series.math} of ${series.property}`;
	}
}

export const WINDOWS = {
	'1h': { label: '1 hour', ms: 3_600_000 },
	'1d': { label: '1 day', ms: 86_400_000 },
	'7d': { label: '7 days', ms: 7 * 86_400_000 },
	'14d': { label: '14 days', ms: 14 * 86_400_000 },
	'30d': { label: '30 days', ms: 30 * 86_400_000 }
} as const;

export type ConversionWindow = keyof typeof WINDOWS;

export interface FunnelQuery {
	/** Events in order; a person converts by doing each one after the previous. */
	steps: string[];
	/** Time from the first step in which the rest must happen. */
	window: ConversionWindow;
	range: Range;
	/** Property of the first step to compare groups by. */
	breakdown?: string;
	filters: PropertyFilter[];
	/** Only people in this cohort. */
	cohort?: string;
}

export const MIN_STEPS = 2;
export const MAX_STEPS = 10;

export const DEFAULT_FUNNEL: FunnelQuery = {
	steps: ['$pageview', '$identify'],
	window: '1d',
	range: '30d',
	filters: []
};

/** Reads property filters from untrusted JSON, dropping invalid ones. */
export function parsePropertyFilters(input: unknown): PropertyFilter[] {
	return parseTrends({ filters: input }).filters;
}

/** Reads a funnel from untrusted JSON. Invalid parts are dropped rather than rejected. */
export function parseFunnel(input: unknown): FunnelQuery {
	if (!isRecord(input)) return DEFAULT_FUNNEL;
	const steps = (Array.isArray(input.steps) ? input.steps : [])
		.filter(validName)
		.slice(0, MAX_STEPS);
	return {
		steps: steps.length >= MIN_STEPS ? steps : DEFAULT_FUNNEL.steps,
		window:
			typeof input.window === 'string' && Object.hasOwn(WINDOWS, input.window)
				? (input.window as ConversionWindow)
				: DEFAULT_FUNNEL.window,
		range: parseRange(typeof input.range === 'string' ? input.range : DEFAULT_FUNNEL.range),
		breakdown: validName(input.breakdown) ? input.breakdown : undefined,
		filters: parsePropertyFilters(input.filters),
		...cohortOf(input)
	};
}

export function parseFunnelParam(value: string | null): FunnelQuery {
	if (!value) return DEFAULT_FUNNEL;
	try {
		return parseFunnel(JSON.parse(value));
	} catch {
		return DEFAULT_FUNNEL;
	}
}

export interface RetentionQuery {
	/** The event that puts a person in a cohort, by the period they first did it in the range. */
	start: string;
	/** The event that counts as coming back in a later period. */
	returning: string;
	/** Daily cohorts for 7 and 30 days, weekly for 90. */
	range: Exclude<Range, '24h'>;
	filters: PropertyFilter[];
	/** Only people in this cohort. */
	cohort?: string;
}

export const RETENTION_RANGES: RetentionQuery['range'][] = ['7d', '30d', '90d'];

export const DEFAULT_RETENTION: RetentionQuery = {
	start: '$pageview',
	returning: '$pageview',
	range: '30d',
	filters: []
};

export function retentionPeriod(range: RetentionQuery['range']): 'day' | 'week' {
	return range === '90d' ? 'week' : 'day';
}

/** Reads a retention query from untrusted JSON. Invalid parts fall back to defaults. */
export function parseRetention(input: unknown): RetentionQuery {
	if (!isRecord(input)) return DEFAULT_RETENTION;
	const range = parseRange(typeof input.range === 'string' ? input.range : DEFAULT_RETENTION.range);
	return {
		start: validName(input.start) ? input.start : DEFAULT_RETENTION.start,
		returning: validName(input.returning) ? input.returning : DEFAULT_RETENTION.returning,
		range: range === '24h' ? '7d' : range,
		filters: parsePropertyFilters(input.filters),
		...cohortOf(input)
	};
}

export function parseRetentionParam(value: string | null): RetentionQuery {
	if (!value) return DEFAULT_RETENTION;
	try {
		return parseRetention(JSON.parse(value));
	} catch {
		return DEFAULT_RETENTION;
	}
}

export const PATH_LABELS = {
	page: 'Page paths',
	event: 'Event names'
} as const;

export type PathLabel = keyof typeof PATH_LABELS;

export interface PathsQuery {
	/** What a step is: a page view, named by its path, or any event, named by the event. */
	label: PathLabel;
	/** Where paths begin: a page path or an event name, as `label` says. Absent: the session start. */
	start?: string;
	/** Where paths stop, inclusive. With an end and no start, steps count back from the end. */
	end?: string;
	/** Steps shown after the start (or before the end). */
	steps: number;
	range: Range;
	filters: PropertyFilter[];
	/** Only people in this cohort. */
	cohort?: string;
}

export const MIN_PATH_STEPS = 1;
export const MAX_PATH_STEPS = 10;
/** Nodes per step; the rest are grouped as other. */
export const MAX_PATH_NODES = 8;

export const DEFAULT_PATHS: PathsQuery = {
	label: 'page',
	steps: 5,
	range: '7d',
	filters: []
};

/** Reads a paths query from untrusted JSON. Invalid parts fall back to defaults. */
export function parsePaths(input: unknown): PathsQuery {
	if (!isRecord(input)) return DEFAULT_PATHS;
	const steps = Number(input.steps);
	const label =
		typeof input.label === 'string' && Object.hasOwn(PATH_LABELS, input.label)
			? (input.label as PathLabel)
			: DEFAULT_PATHS.label;
	return {
		label,
		...(validName(input.start) ? { start: input.start } : {}),
		...(validName(input.end) ? { end: input.end } : {}),
		steps:
			Number.isInteger(steps) && steps >= MIN_PATH_STEPS && steps <= MAX_PATH_STEPS
				? steps
				: DEFAULT_PATHS.steps,
		range: parseRange(typeof input.range === 'string' ? input.range : DEFAULT_PATHS.range),
		filters: parsePropertyFilters(input.filters),
		...cohortOf(input)
	};
}

export function parsePathsParam(value: string | null): PathsQuery {
	if (!value) return DEFAULT_PATHS;
	try {
		return parsePaths(JSON.parse(value));
	} catch {
		return DEFAULT_PATHS;
	}
}

export const LIFECYCLE_INTERVALS = {
	day: 'Day',
	week: 'Week',
	month: 'Month'
} as const;

export type LifecycleInterval = keyof typeof LIFECYCLE_INTERVALS;

export interface LifecycleQuery {
	/** The event that makes a person active in a period. */
	event: string;
	interval: LifecycleInterval;
	range: Exclude<Range, '24h'>;
	filters: PropertyFilter[];
	/** Only people in this cohort. */
	cohort?: string;
}

export const LIFECYCLE_RANGES: LifecycleQuery['range'][] = ['7d', '30d', '90d'];

export const DEFAULT_LIFECYCLE: LifecycleQuery = {
	event: '$pageview',
	interval: 'day',
	range: '30d',
	filters: []
};

/** Reads a lifecycle query from untrusted JSON. Invalid parts fall back to defaults. */
export function parseLifecycle(input: unknown): LifecycleQuery {
	if (!isRecord(input)) return DEFAULT_LIFECYCLE;
	const range = parseRange(typeof input.range === 'string' ? input.range : DEFAULT_LIFECYCLE.range);
	return {
		event: validName(input.event) ? input.event : DEFAULT_LIFECYCLE.event,
		interval:
			typeof input.interval === 'string' && Object.hasOwn(LIFECYCLE_INTERVALS, input.interval)
				? (input.interval as LifecycleInterval)
				: DEFAULT_LIFECYCLE.interval,
		range: range === '24h' ? '7d' : range,
		filters: parsePropertyFilters(input.filters),
		...cohortOf(input)
	};
}

export function parseLifecycleParam(value: string | null): LifecycleQuery {
	if (!value) return DEFAULT_LIFECYCLE;
	try {
		return parseLifecycle(JSON.parse(value));
	} catch {
		return DEFAULT_LIFECYCLE;
	}
}

// Results, as the server queries return them.

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

export interface FunnelGroup {
	/** The breakdown value; absent without a breakdown. */
	breakdown?: string;
	/** People who reached each step, in step order. */
	counts: number[];
}

export interface FunnelResult {
	steps: string[];
	/** The whole funnel, then up to MAX_LINES breakdown groups by people entering it. */
	total: FunnelGroup;
	groups: FunnelGroup[];
}

export interface RetentionCohort {
	/** Period start, ISO 8601 in UTC. */
	start: string;
	/** People who did the start event first in this period. */
	size: number;
	/** People who came back, for each later period that has begun: index 0 is one period later. */
	returned: number[];
}

export interface RetentionResult {
	period: 'day' | 'week';
	cohorts: RetentionCohort[];
}

export interface PathNode {
	/** The page path or event name; null for the steps grouped as other. */
	label: string | null;
	/** Sessions at this step. */
	sessions: number;
	/** Sessions whose path has no further step: they dropped off here (or, counting back from an end, started here). */
	ended: number;
}

export interface PathLink {
	source: string | null;
	target: string | null;
	sessions: number;
}

export interface PathStep {
	/** Most sessions first, then other. */
	nodes: PathNode[];
	/** Transitions to the next step, most sessions first; empty for the last step. */
	links: PathLink[];
}

export interface PathsResult {
	/** Steps in time order. Counting back from an end, the last step is the end. */
	steps: PathStep[];
	/** Sessions with a path. */
	sessions: number;
}

/**
 * Lifecycle states, as PostHog defines them. For a period, an active person is new (their first
 * time ever), returning (also active the period before) or resurrecting (active before, but not
 * the period before); a person active the period before but not in this one is dormant.
 */
export const LIFECYCLE_STATUSES = ['new', 'returning', 'resurrecting', 'dormant'] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export interface LifecycleResult {
	interval: LifecycleInterval;
	/** Period starts, ISO 8601 in UTC; weeks start on Monday. */
	periods: string[];
	/** People per status for each period; dormant counts are negative. */
	counts: Record<LifecycleStatus, number[]>;
}
