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
