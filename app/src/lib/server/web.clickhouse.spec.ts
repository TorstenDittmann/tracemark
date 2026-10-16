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
import { webAnalytics } from './web';

const project = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';
const cookieless = '55555555-5555-4555-8555-555555555555';
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
				view('user-x', '', 195, { $pathname: '/app' }, { projectId: cookieless })
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
});
