// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InternalRule } from '../internal-users';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import { heatmap, heatmapPages } from './heatmaps';

const project = '77777777-7777-4777-8777-777777777777';
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));
const internal: InternalRule[] = [{ kind: 'distinct_id', value: 'staff' }];

const button = { $el_selector: 'main > button.btn', $el_text: 'Get started', $el_tag: 'button' };

function click(
	distinctId: string,
	properties: Record<string, unknown>,
	extra: Partial<TestEvent> = {}
): TestEvent {
	return {
		distinctId,
		event: '$autocapture',
		minutesAgo: 60,
		projectId: project,
		properties: {
			$event_type: 'click',
			$pathname: '/',
			$current_url: 'https://example.com/',
			$device_type: 'Desktop',
			$viewport_width: 1440,
			$document_height: 3000,
			...properties
		},
		...extra
	};
}

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('click heatmaps in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('heatmaps');
		await insertEvents(
			config,
			[
				click('a', { ...button, $click_x: 0.505, $click_y: 0.102 }),
				click('b', {
					...button,
					$click_x: 0.509,
					$click_y: 0.104,
					$viewport_width: 1280,
					$document_height: 3200
				}),
				// A click on text, from the `heatmaps` option: no URL, no element text.
				click(
					'c',
					{ $el_selector: 'footer > p', $click_x: 0.2, $click_y: 0.9, $current_url: undefined },
					{ event: '$heatmap_click' }
				),
				// A keyboard click has no position but still counts for its element.
				click('d', button),
				click('d', { $event_type: 'submit', $el_selector: 'form#signup' }),
				click('e', { ...button, $click_x: 0.5, $click_y: 0.5, $viewport_width: 390 }),
				click('bot', { ...button, $click_x: 0.5, $click_y: 0.5, $device_type: 'Bot' }),
				click('staff', { ...button, $click_x: 0.9, $click_y: 0.9 }),
				click('a', { ...button, $pathname: '/pricing', $click_x: 0.1, $click_y: 0.1 }),
				click('a', { ...button, $click_x: 0.1, $click_y: 0.1 }, { minutesAgo: 3 * 24 * 60 }),
				...['https://example.com/', 'https://example.com/docs', 'http://localhost:5173/'].map(
					(url): TestEvent => ({
						distinctId: 'a',
						event: '$pageview',
						minutesAgo: 30,
						projectId: project,
						properties: { $current_url: url, $pathname: new URL(url).pathname }
					})
				)
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('lists the most clicked paths and the origins pages were viewed on', async () => {
		const { pages, origins } = await heatmapPages(config, project, { range: '24h', now });
		expect(pages).toEqual([
			{ path: '/', clicks: 6 },
			{ path: '/pricing', clicks: 1 }
		]);
		expect(origins).toEqual(['https://example.com', 'http://localhost:5173']);
		const filtered = await heatmapPages(config, project, { range: '24h', now, internal });
		expect(filtered.pages[0]).toEqual({ path: '/', clicks: 5 });
	});

	it('bins positioned clicks into a grid shaped like the page', async () => {
		const map = await heatmap(config, project, {
			range: '24h',
			now,
			path: '/',
			device: 'desktop',
			internal
		});
		// Median page 3000 px tall at 1440 px wide: 100 columns, 208 rows.
		expect(map).toMatchObject({
			columns: 100,
			rows: 208,
			clicks: 3,
			documentHeight: 3000,
			viewportWidth: 1440
		});
		expect(map.cells).toEqual([
			[20, 187, 1],
			[50, 21, 2]
		]);
		expect(map.elements).toEqual([
			{ selector: 'main > button.btn', text: 'Get started', clicks: 3, other: false },
			{ selector: 'footer > p', text: '', clicks: 1, other: true }
		]);
	});

	it('keeps device sizes apart and leaves out internal users only when asked', async () => {
		const all = await heatmap(config, project, { range: '24h', now, path: '/', device: 'desktop' });
		expect(all.clicks).toBe(4);
		const mobile = await heatmap(config, project, {
			range: '24h',
			now,
			path: '/',
			device: 'mobile'
		});
		expect(mobile).toMatchObject({ clicks: 1, viewportWidth: 390 });
		expect(mobile.rows).toBe(Math.round((100 * 3000) / 390));
		const tablet = await heatmap(config, project, {
			range: '24h',
			now,
			path: '/',
			device: 'tablet'
		});
		expect(tablet).toMatchObject({ clicks: 0, cells: [], elements: [], viewportWidth: 820 });
	});
});
