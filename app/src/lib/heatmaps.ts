// Click heatmap options shared by the dashboard and its server queries (see docs/heatmaps.md).

/**
 * Layouts differ by screen size, so clicks are only drawn together with clicks from viewports
 * of about the same width. `width` is the frame width used when no click says otherwise.
 */
export const HEATMAP_DEVICES = {
	desktop: { label: 'Desktop', min: 1024, max: null, width: 1280 },
	tablet: { label: 'Tablet', min: 768, max: 1023, width: 820 },
	mobile: { label: 'Mobile', min: 0, max: 767, width: 390 }
} as const;

export type HeatmapDevice = keyof typeof HEATMAP_DEVICES;

export function parseHeatmapDevice(value: string | null): HeatmapDevice {
	return value && Object.hasOwn(HEATMAP_DEVICES, value) ? (value as HeatmapDevice) : 'desktop';
}

/** Grid columns clicks are binned into; rows follow the page's height. */
export const HEATMAP_COLUMNS = 100;
export const HEATMAP_MAX_ROWS = 1000;

export interface HeatmapPage {
	path: string;
	clicks: number;
}

export interface HeatmapElement {
	selector: string;
	text: string;
	clicks: number;
	/** From `$heatmap_click`: a click outside the buttons and links click autocapture covers. */
	other: boolean;
}

export interface Heatmap {
	path: string;
	device: HeatmapDevice;
	columns: number;
	rows: number;
	/** Clicks with a position. */
	clicks: number;
	/** `[column, row, clicks]` for every cell that was clicked. */
	cells: [number, number, number][];
	/** Median document height and viewport width of the clicks, in CSS pixels. */
	documentHeight: number;
	viewportWidth: number;
	/** The most clicked elements, with or without a position. */
	elements: HeatmapElement[];
}

/** Whether the site lets the dashboard show it in a frame, as far as its headers tell. */
export type FramingCheck =
	| { status: 'allowed' | 'unknown' }
	| { status: 'blocked'; reason: 'x-frame-options' | 'frame-ancestors' | 'mixed-content' };

/**
 * The page to show behind a heatmap: `override` when it is an http(s) URL, else `path` on the
 * site's origin, or null without either.
 */
export function heatmapFrameUrl(
	origin: string | null,
	path: string,
	override?: string | null
): string | null {
	const candidate = override?.trim() || (origin ? `${origin}${path}` : '');
	if (!candidate) return null;
	try {
		const url = new URL(candidate);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}
