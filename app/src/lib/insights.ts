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
		filters
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
}

export const MIN_STEPS = 2;
export const MAX_STEPS = 10;

export const DEFAULT_FUNNEL: FunnelQuery = {
	steps: ['$pageview', '$identify'],
	window: '1d',
	range: '30d',
	filters: []
};

function parseFilters(input: unknown): PropertyFilter[] {
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
		filters: parseFilters(input.filters)
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
		filters: parseFilters(input.filters)
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
