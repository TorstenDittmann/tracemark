import { type FramingCheck, heatmapFrameUrl, parseHeatmapDevice } from '#lib/heatmaps.js';
import { type Heatmap, type HeatmapPage, heatmap, heatmapPages } from '#lib/server/analytics.js';
import { checkFraming } from '#lib/server/framing.js';
import { parseRange } from '#lib/web.js';
import { PUBLIC_URL } from '$app/env/private';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, url }) => {
	const { project } = await parent();
	const range = parseRange(url.searchParams.get('range'));
	const device = parseHeatmapDevice(url.searchParams.get('device'));
	const override = url.searchParams.get('url');
	let pages: HeatmapPage[] = [];
	let origins: string[] = [];
	let map: Heatmap | null = null;
	let path = url.searchParams.get('path') ?? '';
	let available = true;
	try {
		({ pages, origins } = await heatmapPages(project.id, { range }));
		path ||= pages[0]?.path ?? '/';
		map = await heatmap(project.id, { range, path, device });
	} catch (err) {
		console.error('heatmaps unavailable:', err);
		available = false;
	}
	path ||= '/';
	const frameUrl = heatmapFrameUrl(origins[0] ?? null, path, override);
	// Only sites the project's own events came from are fetched, never any URL typed in.
	const known = frameUrl !== null && origins.includes(new URL(frameUrl).origin);
	const framing: Promise<FramingCheck> = known
		? checkFraming(frameUrl, (PUBLIC_URL || url.origin).replace(/\/+$/, ''))
		: Promise.resolve({ status: 'unknown' });
	return {
		range,
		device,
		path,
		pages,
		origin: origins[0] ?? null,
		override,
		frameUrl,
		heatmap: map,
		available,
		framing
	};
};
