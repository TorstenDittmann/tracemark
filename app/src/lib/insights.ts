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
