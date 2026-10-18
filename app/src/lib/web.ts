// Web analytics options shared by the dashboard and its server queries.

export const RANGES = {
	'24h': { label: 'Last 24 hours', hours: 24, bucket: 'hour' },
	'7d': { label: 'Last 7 days', hours: 24 * 7, bucket: 'day' },
	'30d': { label: 'Last 30 days', hours: 24 * 30, bucket: 'day' },
	'90d': { label: 'Last 90 days', hours: 24 * 90, bucket: 'day' }
} as const;

export type Range = keyof typeof RANGES;

export function parseRange(value: string | null): Range {
	return value && Object.hasOwn(RANGES, value) ? (value as Range) : '7d';
}

/**
 * Session attributes the dashboard can be broken down and filtered by. Each comes from the
 * session's first page view, except `page`, which matches any page the session viewed.
 */
export const DIMENSIONS = {
	page: 'Page',
	entry: 'Entry page',
	exit: 'Exit page',
	referrer: 'Referrer',
	utm_source: 'UTM source',
	utm_medium: 'UTM medium',
	utm_campaign: 'UTM campaign',
	country: 'Country',
	device: 'Device',
	browser: 'Browser',
	os: 'OS'
} as const;

export type Dimension = keyof typeof DIMENSIONS;
export type WebFilters = Partial<Record<Dimension, string>>;

export function parseFilters(params: URLSearchParams): WebFilters {
	const filters: WebFilters = {};
	for (const key of Object.keys(DIMENSIONS) as Dimension[]) {
		const value = params.get(key);
		if (value !== null) filters[key] = value;
	}
	return filters;
}

/**
 * Web vitals the browser SDK sends in `$web_vitals` events, with Google's thresholds: at or under
 * `good` is good, over `poor` is poor, anything between needs improvement. Times are in ms.
 */
export const VITALS = {
	LCP: { label: 'Largest Contentful Paint', good: 2500, poor: 4000 },
	INP: { label: 'Interaction to Next Paint', good: 200, poor: 500 },
	CLS: { label: 'Cumulative Layout Shift', good: 0.1, poor: 0.25 },
	FCP: { label: 'First Contentful Paint', good: 1800, poor: 3000 },
	TTFB: { label: 'Time to First Byte', good: 800, poor: 1800 }
} as const;

export type Vital = keyof typeof VITALS;
export type VitalRating = 'good' | 'needs-improvement' | 'poor';

export function rateVital(vital: Vital, value: number): VitalRating {
	const { good, poor } = VITALS[vital];
	return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

/** A vital for display: seconds from one second up, two decimals for CLS. */
export function formatVital(vital: Vital, value: number): string {
	if (vital === 'CLS') return value.toFixed(2);
	return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

/** The filters web vitals are narrowed by: the ones that are properties of each event. */
export const VITAL_FILTERS = ['page', 'country', 'device', 'browser', 'os'] as const;

export interface VitalSummary {
	/** 75th percentile, ms for times, or null without measurements. */
	p75: number | null;
	/** How many page views measured it. */
	samples: number;
}

export interface WebVitalsPath {
	path: string;
	/** `$web_vitals` events for the path. */
	pageviews: number;
	vitals: Record<Vital, VitalSummary>;
}

export interface WebVitals {
	vitals: Record<Vital, VitalSummary>;
	/** The paths with the most measured page views, at most 10. */
	paths: WebVitalsPath[];
}
