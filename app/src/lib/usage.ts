// Usage page helpers shared by the server and the page: ranges, event categories and formatting.
import type { Range } from './web';

export const USAGE_RANGES = ['7d', '30d', '90d'] as const satisfies readonly Range[];

export type UsageRange = (typeof USAGE_RANGES)[number];

export function parseUsageRange(value: string | null): UsageRange {
	return USAGE_RANGES.find((range) => range === value) ?? '30d';
}

/** What drives event volume, in display order. `events` names what each category counts. */
export const USAGE_CATEGORIES = {
	pageview: { label: 'Page views', events: '$pageview, $pageleave' },
	autocapture: { label: 'Autocapture', events: '$autocapture, $web_vitals' },
	exception: { label: 'Exceptions', events: '$exception' },
	ai: { label: 'AI', events: '$ai_*' },
	identity: { label: 'People and groups', events: '$identify, $set, $groupidentify' },
	other: { label: 'Other reserved', events: 'other $ events, such as $feature_flag_called' },
	custom: { label: 'Custom events', events: 'events without a $ prefix' }
} as const;

export type UsageCategory = keyof typeof USAGE_CATEGORIES;

export const CATEGORY_KEYS = Object.keys(USAGE_CATEGORIES) as UsageCategory[];

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Bytes in binary units, such as `1.5 GB` for 1.5 × 1024³. */
export function formatBytes(bytes: number): string {
	let value = Math.max(0, bytes);
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(digits)} ${UNITS[unit]}`;
}
