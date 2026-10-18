// Runs against a real ClickHouse when CLICKHOUSE_TEST_URL is set (CI's migrations job does), skipped otherwise.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClickHouseConfig } from './clickhouse';
import {
	clickhouseTestUrl,
	createTestDatabase,
	dropTestDatabase,
	insertEvents,
	type TestEvent
} from './clickhouse-test';
import { webAnalytics, webVitals } from './web';

const project = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const cookieless = '55555555-5555-4555-8555-555555555555';
const vitalsProject = '66666666-6666-4666-8666-666666666666';
// 12:30 UTC, so the last hourly bucket is 12:00.
const now = new Date(Date.UTC(2026, 9, 16, 12, 30));

const desktop = {
	$browser: 'Chrome',
	$os: 'macOS',
	$device_type: 'Desktop',
	$geoip_country_code: 'DE'
};
const mobile = {
	$browser: 'Safari',
	$os: 'iOS',
	$device_type: 'Mobile',
	$geoip_country_code: 'US'
};

function view(
	distinctId: string,
	sessionId: string,
	minutesAgo: number,
	properties: Record<string, unknown>,
	extra: Partial<TestEvent> = {}
): TestEvent {
	return {
		distinctId,
		sessionId,
		event: '$pageview',
		minutesAgo,
		projectId: project,
		properties: { $referring_domain: '$direct', ...properties },
		...extra
	};
}

let config: ClickHouseConfig;

describe.skipIf(!clickhouseTestUrl)('web analytics in ClickHouse', () => {
	beforeAll(async () => {
		config = await createTestDatabase('web');
		await insertEvents(
			config,
			[
				// s1: two pages from Google, ten minutes long.
				view('anon-a', 's1', 120, {
					...desktop,
					$pathname: '/',
					$referring_domain: 'google.com',
					utm_source: 'news'
				}),
				view('anon-a', 's1', 115, {
					...desktop,
					$pathname: '/pricing',
					$referring_domain: 'google.com'
				}),
				view('anon-a', 's1', 110, { $pathname: '/pricing' }, { event: '$pageleave' }),
				{
					distinctId: 'user-a',
					event: '$identify',
					minutesAgo: 100,
					projectId: project,
					properties: { $anon_distinct_id: 'anon-a' }
				},
				// s2: the same person, signed in, bounces.
				view('user-a', 's2', 30, { ...desktop, $pathname: '/pricing' }),
				// s3: another visitor on mobile, one minute on one page.
				view('anon-b', 's3', 60, { ...mobile, $pathname: '/', $referring_domain: 'twitter.com' }),
				view('anon-b', 's3', 59, { $pathname: '/' }, { event: '$pageleave' }),
				// No session id: one session per visit.
				view('anon-c', '', 10, { ...desktop, $pathname: '/docs' }),
				// Left out: bots, other projects, sessions without a page view.
				view('bot', 's4', 20, { $pathname: '/', $device_type: 'Bot' }),
				view('anon-d', 's6', 20, { $pathname: '/' }, { projectId: other }),
				view('anon-e', 's7', 20, { $pathname: '/' }, { event: '$pageleave' }),
				// Two days ago: only in the weekly view.
				view('anon-f', 's5', 60 * 48, { ...mobile, $pathname: '/blog' }),
				// Cookieless: no session ids. A 90 minute pause starts a new visit; signing in does not.
				view('cookieless_1', '', 300, { $pathname: '/' }, { projectId: cookieless }),
				view('cookieless_1', '', 290, { $pathname: '/docs' }, { projectId: cookieless }),
				view('cookieless_1', '', 200, { $pathname: '/' }, { projectId: cookieless }),
				{
					distinctId: 'user-x',
					event: '$identify',
					minutesAgo: 199,
					projectId: cookieless,
					properties: { $anon_distinct_id: 'cookieless_1' }
				},
				view('user-x', '', 195, { $pathname: '/app' }, { projectId: cookieless }),
				// Web vitals: four page views of / and two of /docs, one from a bot.
				...[
					[2000, 100, 0.05, 1000, 300, '/'],
					[2400, 150, 0, 1200, 500, '/'],
					[3000, 250, 0.2, 1500, 700, '/'],
					[5000, null, 0.3, 2500, 900, '/'],
					[1200, 80, null, 800, 200, '/docs'],
					[null, 600, 0.01, null, null, '/docs'],
					[9000, 9000, 1, 9000, 9000, '/bot']
				].map(([LCP, INP, CLS, FCP, TTFB, path], i) => {
					const properties: Record<string, unknown> = {
						...(path === '/docs' ? mobile : desktop),
						$pathname: path,
						...(path === '/bot' ? { $device_type: 'Bot' } : {})
					};
					for (const [name, value] of Object.entries({ LCP, INP, CLS, FCP, TTFB }))
						if (value !== null) properties[`$web_vitals_${name}_value`] = value;
					return {
						distinctId: `vitals-${i}`,
						sessionId: `v${i}`,
						event: '$web_vitals',
						minutesAgo: 30 + i,
						projectId: vitalsProject,
						properties
					};
				}),
				// Too old for the last day.
				{
					distinctId: 'vitals-old',
					event: '$web_vitals',
					minutesAgo: 60 * 48,
					projectId: vitalsProject,
					properties: { $pathname: '/', $web_vitals_LCP_value: 100 }
				}
			],
			now.getTime()
		);
	});

	afterAll(() => dropTestDatabase(config));

	it('summarizes visitors, sessions, bounces and duration', async () => {
		const web = await webAnalytics(config, project, { range: '24h', now });
		expect(web.overview).toEqual({
			visitors: 3,
			pageviews: 5,
			sessions: 4,
			bounceRate: 0.75,
			avgDuration: (600 + 0 + 60 + 0) / 4
		});
	});

	it('fills an hourly series for the last day', async () => {
		const web = await webAnalytics(config, project, { range: '24h', now });
		expect(web.bucket).toBe('hour');
		expect(web.series).toHaveLength(24);
		expect(web.series[0].t).toBe('2026-10-15T13:00:00Z');
		expect(web.series.slice(-3)).toEqual([
			{ t: '2026-10-16T10:00:00Z', visitors: 1, pageviews: 2 },
			{ t: '2026-10-16T11:00:00Z', visitors: 1, pageviews: 1 },
			{ t: '2026-10-16T12:00:00Z', visitors: 2, pageviews: 2 }
		]);
	});

	it('breaks down by page, entry and exit page, and referrer', async () => {
		const { breakdowns } = await webAnalytics(config, project, { range: '24h', now });
		expect(breakdowns.page).toEqual([
			{ value: '/', visitors: 2, pageviews: 2 },
			{ value: '/pricing', visitors: 1, pageviews: 2 },
			{ value: '/docs', visitors: 1, pageviews: 1 }
		]);
		expect(breakdowns.entry.map((row) => row.value)).toEqual(['/', '/docs', '/pricing']);
		expect(breakdowns.exit.map((row) => row.value)).toEqual(['/pricing', '/', '/docs']);
		expect(breakdowns.referrer).toEqual([
			{ value: '', visitors: 2, pageviews: 2 },
			{ value: 'google.com', visitors: 1, pageviews: 2 },
			{ value: 'twitter.com', visitors: 1, pageviews: 1 }
		]);
		expect(breakdowns.utm_source).toEqual([
			{ value: '', visitors: 3, pageviews: 3 },
			{ value: 'news', visitors: 1, pageviews: 2 }
		]);
		expect(breakdowns.country.map((row) => [row.value, row.visitors])).toEqual([
			['DE', 2],
			['US', 1]
		]);
		expect(breakdowns.device.map((row) => row.value)).toEqual(['Desktop', 'Mobile']);
	});

	it('narrows every number to sessions matching the filters', async () => {
		const google = await webAnalytics(config, project, {
			range: '24h',
			now,
			filters: { referrer: 'google.com' }
		});
		expect(google.overview).toMatchObject({
			visitors: 1,
			sessions: 1,
			pageviews: 2,
			bounceRate: 0
		});

		const pricing = await webAnalytics(config, project, {
			range: '24h',
			now,
			filters: { page: '/pricing' }
		});
		expect(pricing.overview).toMatchObject({ visitors: 1, sessions: 2, pageviews: 3 });

		const directDesktop = await webAnalytics(config, project, {
			range: '24h',
			now,
			filters: { referrer: '', device: 'Desktop' }
		});
		expect(directDesktop.overview).toMatchObject({ visitors: 2, sessions: 2 });
	});

	it('splits visits without session ids at 30 minute gaps', async () => {
		const web = await webAnalytics(config, cookieless, { range: '24h', now });
		expect(web.overview).toEqual({
			visitors: 1,
			pageviews: 4,
			sessions: 2,
			bounceRate: 0,
			avgDuration: (600 + 300) / 2
		});
		expect(web.breakdowns.entry.map((row) => row.value)).toEqual(['/']);
		expect(web.breakdowns.exit.map((row) => row.value)).toEqual(['/app', '/docs']);
	});

	it('covers a week in daily buckets', async () => {
		const web = await webAnalytics(config, project, { range: '7d', now });
		expect(web.bucket).toBe('day');
		expect(web.series).toHaveLength(7);
		expect(web.series.at(-1)?.t).toBe('2026-10-16T00:00:00Z');
		expect(web.series.find((p) => p.t === '2026-10-14T00:00:00Z')).toEqual({
			t: '2026-10-14T00:00:00Z',
			visitors: 1,
			pageviews: 1
		});
		expect(web.overview.sessions).toBe(5);
	});

	it('summarizes web vitals at the 75th percentile, overall and by path', async () => {
		const { vitals, paths } = await webVitals(config, vitalsProject, { range: '24h', now });
		// LCP 1200, 2000, 2400, 3000 and 5000; the bot's 9000 is left out.
		expect(vitals.LCP).toEqual({ p75: 3000, samples: 5 });
		expect(vitals.INP.samples).toBe(5);
		expect(vitals.CLS).toEqual({ p75: 0.2, samples: 5 });
		expect(vitals.TTFB.samples).toBe(5);
		expect(paths.map((p) => [p.path, p.pageviews])).toEqual([
			['/', 4],
			['/docs', 2]
		]);
		expect(paths[1]?.vitals.LCP).toEqual({ p75: 1200, samples: 1 });
		expect(paths[1]?.vitals.FCP).toEqual({ p75: 800, samples: 1 });
	});

	it('narrows web vitals by event properties and reports missing metrics as null', async () => {
		const mobileOnly = await webVitals(config, vitalsProject, {
			range: '24h',
			now,
			filters: { device: 'Mobile', referrer: 'ignored.com' }
		});
		expect(mobileOnly.paths.map((p) => p.path)).toEqual(['/docs']);
		const none = await webVitals(config, vitalsProject, {
			range: '24h',
			now,
			filters: { page: '/nowhere' }
		});
		expect(none.vitals.LCP).toEqual({ p75: null, samples: 0 });
		expect(none.paths).toEqual([]);
		const week = await webVitals(config, vitalsProject, { range: '7d', now });
		expect(week.vitals.LCP.samples).toBe(6);
	});
});
