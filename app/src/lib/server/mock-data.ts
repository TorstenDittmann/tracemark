// Mock data for trying the dashboard without an SDK: a month of web traffic, product events,
// errors, AI traces and flag exposures from made-up people and companies, plus the flags,
// experiment, cohorts, insights and dashboard that read them. Every mock person and company id
// starts with `demo-`, which is how adding again replaces the old mock events and how removing
// finds them; definitions are found by their key or name. Real data is never touched.
import { createHash } from 'node:crypto';
import { evaluate, type FlagDefinition, parseFlag } from '@tracemark/flags';
import { and, eq, inArray } from 'drizzle-orm';
import type { ExperimentMetric } from '../experiments';
import { type ClickHouseConfig, clickhouseQuery } from './clickhouse';
import type { Db } from './db/client';
import {
	cohorts,
	dashboardInsights,
	dashboards,
	errorIssues,
	experiments,
	featureFlags,
	flagVersions,
	insights
} from './db/schema';
import type { SavedQuery } from './saved';

export const MOCK_PREFIX = 'demo-';
const DAYS = 30;
const PEOPLE = 900;
const DAY_MS = 86_400_000;
const HOST = 'demo.tracemark.dev';

export interface MockEvent {
	uuid: string;
	project_id: string;
	event: string;
	timestamp: string;
	distinct_id: string;
	session_id: string;
	properties: Record<string, unknown>;
	person_set: Record<string, unknown>;
	person_set_once: Record<string, unknown>;
	groups: Record<string, string>;
}

/** A small seeded generator, so a project gets the same people every time. */
function random(seed: string) {
	let state = Number.parseInt(createHash('sha1').update(seed).digest('hex').slice(0, 8), 16);
	const next = () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
	const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
	/** One of `items`, by weight. */
	const weighted = <I extends readonly [unknown, number]>(items: readonly I[]): I[0] => {
		let at = next() * items.reduce((sum, [, w]) => sum + w, 0);
		for (const [item, w] of items) {
			at -= w;
			if (at < 0) return item;
		}
		return items[items.length - 1]?.[0];
	};
	const hex = (length: number) =>
		Array.from({ length }, () => Math.floor(next() * 16).toString(16)).join('');
	const uuid = () =>
		`${hex(8)}-${hex(4)}-4${hex(3)}-${pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
	return { next, int, pick, weighted, uuid };
}

const FIRST_NAMES =
	'Ada Ben Chloe Daniel Elena Felix Grace Hugo Iris Jonas Kira Liam Maya Noah Olivia Paul Quinn Rosa Sam Tara Umar Vera Will Yara Zoe Mateo Lena Arjun Sofia Kenji'.split(
		' '
	);
const LAST_NAMES =
	'Lovelace Meyer Novak Garcia Okafor Schmidt Rossi Kim Silva Larsen Dubois Tanaka Patel Cohen Moreau Fischer Nguyen Haddad Berg Walsh'.split(
		' '
	);

export const MOCK_COMPANIES = [
	{
		key: 'demo-acme',
		name: 'Acme Inc',
		plan: 'enterprise',
		industry: 'Manufacturing',
		employees: 1200
	},
	{ key: 'demo-globex', name: 'Globex', plan: 'pro', industry: 'Energy', employees: 340 },
	{ key: 'demo-initech', name: 'Initech', plan: 'pro', industry: 'Software', employees: 85 },
	{
		key: 'demo-umbrella',
		name: 'Umbrella Labs',
		plan: 'enterprise',
		industry: 'Biotech',
		employees: 2300
	},
	{ key: 'demo-hooli', name: 'Hooli', plan: 'pro', industry: 'Software', employees: 610 },
	{
		key: 'demo-stark',
		name: 'Stark Industries',
		plan: 'enterprise',
		industry: 'Aerospace',
		employees: 4100
	},
	{
		key: 'demo-wayne',
		name: 'Wayne Enterprises',
		plan: 'free',
		industry: 'Finance',
		employees: 25
	},
	{ key: 'demo-piedpiper', name: 'Pied Piper', plan: 'free', industry: 'Software', employees: 12 },
	{ key: 'demo-wonka', name: 'Wonka Foods', plan: 'pro', industry: 'Retail', employees: 150 },
	{ key: 'demo-cyberdyne', name: 'Cyberdyne', plan: 'free', industry: 'Robotics', employees: 40 }
] as const;

const COUNTRIES = [
	[{ code: 'US', name: 'United States', city: 'New York' }, 30],
	[{ code: 'DE', name: 'Germany', city: 'Berlin' }, 14],
	[{ code: 'GB', name: 'United Kingdom', city: 'London' }, 11],
	[{ code: 'FR', name: 'France', city: 'Paris' }, 7],
	[{ code: 'IN', name: 'India', city: 'Bengaluru' }, 9],
	[{ code: 'BR', name: 'Brazil', city: 'São Paulo' }, 6],
	[{ code: 'CA', name: 'Canada', city: 'Toronto' }, 6],
	[{ code: 'NL', name: 'Netherlands', city: 'Amsterdam' }, 5],
	[{ code: 'JP', name: 'Japan', city: 'Tokyo' }, 5],
	[{ code: 'AU', name: 'Australia', city: 'Sydney' }, 4],
	[{ code: 'ES', name: 'Spain', city: 'Madrid' }, 3]
] as const;

const DEVICES = [
	[{ device: 'Desktop', os: 'Mac OS X', browser: 'Chrome' }, 26],
	[{ device: 'Desktop', os: 'Windows', browser: 'Chrome' }, 22],
	[{ device: 'Desktop', os: 'Mac OS X', browser: 'Safari' }, 10],
	[{ device: 'Desktop', os: 'Windows', browser: 'Edge' }, 7],
	[{ device: 'Desktop', os: 'Linux', browser: 'Firefox' }, 6],
	[{ device: 'Mobile', os: 'iOS', browser: 'Mobile Safari' }, 16],
	[{ device: 'Mobile', os: 'Android', browser: 'Chrome Mobile' }, 10],
	[{ device: 'Tablet', os: 'iOS', browser: 'Mobile Safari' }, 3]
] as const;

type Source = { referrer: string; utm?: { source: string; medium: string; campaign?: string } };
const SOURCES: (readonly [Source, number])[] = [
	[{ referrer: '$direct' }, 30],
	[{ referrer: 'www.google.com' }, 28],
	[{ referrer: 'news.ycombinator.com' }, 8],
	[{ referrer: 'github.com' }, 7],
	[{ referrer: 'www.reddit.com' }, 5],
	[{ referrer: 't.co', utm: { source: 'twitter', medium: 'social', campaign: 'launch-week' } }, 6],
	[{ referrer: 'www.linkedin.com', utm: { source: 'linkedin', medium: 'social' } }, 4],
	[{ referrer: 'duckduckgo.com' }, 3],
	[
		{
			referrer: 'www.google.com',
			utm: { source: 'google', medium: 'cpc', campaign: 'brand-search' }
		},
		5
	],
	[
		{
			referrer: '$direct',
			utm: { source: 'newsletter', medium: 'email', campaign: 'october-digest' }
		},
		4
	]
];

const LANDING_PAGES = [
	['/', 40],
	['/pricing', 12],
	['/blog/self-hosted-analytics', 10],
	['/blog/feature-flags-without-the-bloat', 7],
	['/docs', 12],
	['/docs/getting-started', 9],
	['/features/error-tracking', 5],
	['/features/ai-observability', 5]
] as const;
const MARKETING_PAGES = [
	'/',
	'/pricing',
	'/docs',
	'/docs/getting-started',
	'/docs/sdk/browser',
	'/docs/flags',
	'/features/web-analytics',
	'/features/error-tracking',
	'/features/ai-observability',
	'/changelog',
	'/about'
] as const;
const APP_PAGES = [
	['/app', 20],
	['/app/dashboards', 14],
	['/app/insights/trends', 12],
	['/app/insights/funnels', 6],
	['/app/events', 10],
	['/app/flags', 7],
	['/app/settings', 4],
	['/app/billing', 2]
] as const;

/** Exception kinds, each with the page it happens on and how often, per app session. */
const ERRORS = [
	{
		type: 'TypeError',
		value: "Cannot read properties of undefined (reading 'map')",
		fn: 'renderChart',
		file: 'chart-Cx81a0.js',
		page: '/app/insights/trends',
		rate: 0.05
	},
	{
		type: 'ChunkLoadError',
		value: 'Loading chunk 412 failed.',
		fn: 'loadRoute',
		file: 'router-9bQ2e1.js',
		page: '/app',
		rate: 0.025
	},
	{
		type: 'Error',
		value: 'Request failed with status 502',
		fn: 'fetchDashboard',
		file: 'api-DH3k2p.js',
		page: '/app/dashboards',
		rate: 0.07
	},
	{
		type: 'RangeError',
		value: 'Invalid time value',
		fn: 'formatDate',
		file: 'date-a83Ldd.js',
		page: '/app/events',
		rate: 0.04
	},
	{
		type: 'SyntaxError',
		value: 'Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON',
		fn: 'parseResponse',
		file: 'api-DH3k2p.js',
		page: '/app/flags',
		rate: 0.05
	},
	{
		type: 'ResizeObserver',
		value: 'ResizeObserver loop completed with undelivered notifications.',
		fn: 'observe',
		file: 'layout-K2p0aa.js',
		page: '/app',
		rate: 0.04
	}
] as const;

export const MOCK_RELEASES = ['1.8.0', '1.8.1', '1.9.0'] as const;

/** The 16 hex characters ingest would give an issue; any stable value groups it the same. */
const fingerprintOf = (error: (typeof ERRORS)[number]) =>
	createHash('sha1').update(`demo:${error.type}:${error.fn}`).digest('hex').slice(0, 16);
export const MOCK_FINGERPRINTS = ERRORS.map(fingerprintOf);

const QUESTIONS = [
	'Why did signups drop last Tuesday?',
	'Which pages have the highest bounce rate?',
	'Summarize errors from the latest release.',
	'How many people used the new onboarding?',
	'Compare conversion between the pricing variants.',
	'Which countries grew fastest this month?',
	'What is our weekly retention for paid users?',
	'Write a SQL query for daily active users.'
] as const;

const CHAT_MODELS = [
	[{ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' }, 60],
	[{ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' }, 20],
	[{ provider: 'openai', model: 'gpt-4o-mini-2024-07-18' }, 20]
] as const;

/** USD per million input and output tokens of the models above, as the providers list them. */
const PRICES: Record<string, [number, number]> = {
	'claude-sonnet-4-5-20250929': [3, 15],
	'claude-haiku-4-5-20251001': [1, 5],
	'gpt-4o-mini-2024-07-18': [0.15, 0.6],
	'text-embedding-3-small': [0.02, 0]
};

/** USD for a call. Mock events skip ingest, so they carry their cost like a client-sent one. */
function cost(model: string, input: number, output: number): number {
	const [inputPrice, outputPrice] = PRICES[model] ?? [0, 0];
	return (input * inputPrice + output * outputPrice) / 1_000_000;
}

export const MOCK_FLAGS: { key: string; description: string; flag: Omit<FlagDefinition, 'key'> }[] =
	[
		{
			key: 'new-onboarding',
			description: 'Demo: the redesigned onboarding checklist, rolling out to half of everyone.',
			flag: { active: true, conditions: [{ filters: [], rollout: 50 }], variants: [], payloads: {} }
		},
		{
			key: 'pricing-page-redesign',
			description: 'Demo: A/B test of the new pricing page.',
			flag: {
				active: true,
				conditions: [{ filters: [], rollout: 100 }],
				variants: [
					{ key: 'control', rollout: 50 },
					{ key: 'redesign', rollout: 50 }
				],
				payloads: {}
			}
		},
		{
			key: 'ai-assistant',
			description: 'Demo: the AI assistant, for enterprise companies only.',
			flag: {
				active: true,
				groupType: 'company',
				conditions: [
					{
						filters: [
							{
								type: 'group',
								groupType: 'company',
								property: 'plan',
								operator: 'eq',
								value: 'enterprise'
							}
						],
						rollout: 100
					}
				],
				variants: [],
				payloads: { true: { model: 'claude-sonnet-4-5', maxTokens: 1024 } }
			}
		},
		{
			key: 'dark-mode',
			description: 'Demo: dark theme, for people on the pro plan.',
			flag: {
				active: false,
				conditions: [
					{
						filters: [{ type: 'person', property: 'plan', operator: 'eq', value: 'pro' }],
						rollout: 100
					}
				],
				variants: [],
				payloads: {}
			}
		}
	];

const EXPERIMENT_FLAG = 'pricing-page-redesign';
const EXPERIMENT_NAME = 'Pricing page redesign';
const EXPERIMENT_METRICS: ExperimentMetric[] = [
	{ kind: 'conversion', event: 'signed_up' },
	{ kind: 'conversion', event: 'subscription_started' },
	{ kind: 'count', event: '$pageview' }
];
const EXPERIMENT_DAYS = 14;

export const MOCK_COHORTS = [
	{
		name: 'Pro customers',
		kind: 'properties' as const,
		filters: [{ property: 'plan', operator: 'eq' as const, value: 'pro' }]
	},
	{ name: 'Beta testers', kind: 'static' as const, filters: [] }
];

export const MOCK_INSIGHTS: { name: string; saved: SavedQuery }[] = [
	{
		name: 'Daily page views',
		saved: {
			kind: 'trends',
			query: { series: [{ event: '$pageview', math: 'total' }], range: '30d', filters: [] }
		}
	},
	{
		name: 'Signups by method',
		saved: {
			kind: 'trends',
			query: {
				series: [{ event: 'signed_up', math: 'total' }],
				range: '30d',
				breakdown: 'method',
				filters: []
			}
		}
	},
	{
		name: 'Signup to paid funnel',
		saved: {
			kind: 'funnel',
			query: {
				steps: ['$pageview', 'signed_up', 'project_created', 'subscription_started'],
				window: '14d',
				range: '30d',
				filters: []
			}
		}
	},
	{
		name: 'Product retention',
		saved: {
			kind: 'retention',
			query: { start: 'signed_up', returning: 'insight_viewed', range: '30d', filters: [] }
		}
	}
];
export const MOCK_DASHBOARD = 'Demo overview';

interface Person {
	anonId: string;
	userId: string;
	name: string;
	email: string;
	company: (typeof MOCK_COMPANIES)[number];
	plan: string;
	country: (typeof COUNTRIES)[number][0];
	device: (typeof DEVICES)[number][0];
	source: Source;
	/** Day offsets from the start of the window, in order. */
	visits: number[];
	/** Index of the visit they sign up in, or -1. */
	signupVisit: number;
	subscribes: boolean;
}

/** Ids of the mock people who are put in the static "Beta testers" cohort. */
export function betaTesters(events: MockEvent[]): string[] {
	const ids = new Set(events.filter((e) => e.event === 'signed_up').map((e) => e.distinct_id));
	return [...ids].filter((_, i) => i % 7 === 0);
}

/**
 * A month of events for `projectId`, ending at `now`. `flags` are the project's mock flags as
 * stored, so exposures match what the flags would serve.
 */
export function mockEvents(projectId: string, now: Date, flags: FlagDefinition[]): MockEvent[] {
	const r = random(`mock:${projectId}`);
	const end = now.getTime();
	const start = end - DAYS * DAY_MS;
	const experimentStart = end - EXPERIMENT_DAYS * DAY_MS;
	const pricingFlag = flags.find((f) => f.key === EXPERIMENT_FLAG);
	const onboardingFlag = flags.find((f) => f.key === 'new-onboarding');
	const events: MockEvent[] = [];

	const push = (
		e: Omit<
			MockEvent,
			'uuid' | 'project_id' | 'timestamp' | 'person_set' | 'person_set_once' | 'groups'
		> &
			Partial<Pick<MockEvent, 'person_set' | 'person_set_once' | 'groups'>> & { at: number }
	) => {
		if (e.at > end) return;
		events.push({
			uuid: r.uuid(),
			project_id: projectId,
			event: e.event,
			timestamp: new Date(e.at).toISOString().replace('Z', ''),
			distinct_id: e.distinct_id,
			session_id: e.session_id,
			properties: e.properties,
			person_set: e.person_set ?? {},
			person_set_once: e.person_set_once ?? {},
			groups: e.groups ?? {}
		});
	};

	// Each company is identified by the first of its people to sign up.
	const identifiedCompanies = new Set<string>();

	const people: Person[] = Array.from({ length: PEOPLE }, (_, i) => {
		const first = r.pick(FIRST_NAMES);
		const last = r.pick(LAST_NAMES);
		const company = r.pick(MOCK_COMPANIES);
		// More people arrive later in the month, so traffic grows.
		const firstDay = Math.floor(DAYS * r.next() ** 0.75);
		const visits = [firstDay];
		let day = firstDay;
		const loyalty = r.next();
		while (true) {
			day += r.int(1, loyalty > 0.6 ? 3 : 9);
			if (day >= DAYS || r.next() > 0.35 + loyalty * 0.55) break;
			visits.push(day);
		}
		const signupVisit = r.next() < 0.42 ? Math.min(visits.length - 1, r.int(0, 1)) : -1;
		return {
			anonId: `${MOCK_PREFIX}anon-${String(i).padStart(4, '0')}`,
			userId: `${MOCK_PREFIX}user-${String(i).padStart(4, '0')}`,
			name: `${first} ${last}`,
			email: `${first}.${last}${i}@${company.key.slice(MOCK_PREFIX.length)}.example`.toLowerCase(),
			company,
			plan: company.plan === 'free' ? 'free' : r.next() < 0.7 ? company.plan : 'free',
			country: r.weighted(COUNTRIES),
			device: r.weighted(DEVICES),
			source: r.weighted(SOURCES),
			visits,
			signupVisit,
			subscribes: false
		};
	});

	for (const person of people) {
		let identified = false;
		for (const [visitIndex, visitDay] of person.visits.entries()) {
			// Weekdays are busier, and most visits happen in working hours.
			// Days are UTC calendar days, the last one being today, so today has traffic up to now.
			const dayStart = Math.floor(end / DAY_MS) * DAY_MS - (DAYS - 1 - visitDay) * DAY_MS;
			const weekday = new Date(dayStart).getUTCDay();
			if ((weekday === 0 || weekday === 6) && r.next() < 0.45) continue;
			const hour = r.next() < 0.7 ? r.int(7, 20) : r.int(0, 23);
			let at = dayStart + hour * 3_600_000 + r.int(0, 3_599_999);
			const sessionId = `${MOCK_PREFIX}${r.uuid()}`;
			const id = () => (identified ? person.userId : person.anonId);
			const firstVisit = visitIndex === 0;
			const source = firstVisit
				? person.source
				: r.next() < 0.7
					? { referrer: '$direct' }
					: r.weighted(SOURCES);
			const base = () => ({
				$host: HOST,
				$lib: 'web',
				$browser: person.device.browser,
				$os: person.device.os,
				$device_type: person.device.device,
				$geoip_country_code: person.country.code,
				$geoip_country_name: person.country.name,
				$geoip_city_name: person.country.city
			});
			const groups = (): Record<string, string> =>
				identified ? { company: person.company.key } : {};
			const pageview = (path: string, entry = false) => {
				push({
					event: '$pageview',
					at,
					distinct_id: id(),
					session_id: sessionId,
					groups: groups(),
					properties: {
						...base(),
						$current_url: `https://${HOST}${path}`,
						$pathname: path,
						...(entry
							? {
									$referrer:
										source.referrer === '$direct' ? '$direct' : `https://${source.referrer}/`,
									$referring_domain: source.referrer,
									...(source.utm
										? {
												utm_source: source.utm.source,
												utm_medium: source.utm.medium,
												...(source.utm.campaign ? { utm_campaign: source.utm.campaign } : {})
											}
										: {})
								}
							: { $referrer: '$direct', $referring_domain: '$direct' })
					}
				});
				at += r.int(8, 150) * 1000;
			};
			const track = (event: string, properties: Record<string, unknown> = {}) => {
				push({
					event,
					at,
					distinct_id: id(),
					session_id: sessionId,
					groups: groups(),
					properties: { ...base(), $current_url: `https://${HOST}/app`, ...properties }
				});
				at += r.int(2, 40) * 1000;
			};
			const flagCalled = (flag: FlagDefinition | undefined) => {
				if (!flag || at < (flag.key === EXPERIMENT_FLAG ? experimentStart : start)) return null;
				const value = evaluate(flag, { distinctId: id() }).value;
				track('$feature_flag_called', { $feature_flag: flag.key, $feature_flag_response: value });
				return value;
			};

			let path: string = identified ? '/app' : r.weighted(LANDING_PAGES);
			pageview(path, true);
			let variant: string | boolean | null = null;

			if (!identified) {
				const pages = r.int(0, 4);
				for (let p = 0; p < pages; p++) {
					path = r.pick(MARKETING_PAGES);
					if (path === '/pricing') variant = flagCalled(pricingFlag) ?? variant;
					pageview(path);
				}
				// The pricing redesign gets a few more people to sign up.
				const signsUp =
					visitIndex === person.signupVisit ||
					(person.signupVisit === -1 && variant === 'redesign' && r.next() < 0.15);
				if (signsUp) {
					// The pricing redesign converts a little better.
					if (variant === null) {
						pageview('/pricing');
						variant = flagCalled(pricingFlag);
					}
					if (variant === 'control' && r.next() < 0.25) {
						pageview('/');
					} else {
						pageview('/signup');
						identified = true;
						push({
							event: '$identify',
							at,
							distinct_id: person.userId,
							session_id: sessionId,
							groups: groups(),
							properties: { ...base(), $anon_distinct_id: person.anonId },
							person_set: {
								email: person.email,
								name: person.name,
								plan: person.plan,
								company: person.company.name,
								role: r.pick(['Engineer', 'Founder', 'Product manager', 'Designer', 'Data analyst'])
							},
							person_set_once: {
								first_seen_country: person.country.code,
								initial_referring_domain: person.source.referrer
							}
						});
						at += 1000;
						const company = person.company;
						if (!identifiedCompanies.has(company.key)) {
							identifiedCompanies.add(company.key);
							track('$groupidentify', {
								$group_type: 'company',
								$group_key: company.key,
								$group_set: {
									name: company.name,
									plan: company.plan,
									industry: company.industry,
									employees: company.employees
								}
							});
						}
						track('signed_up', {
							method: r.weighted([
								['email', 5],
								['github', 4],
								['google', 3]
							])
						});
						flagCalled(onboardingFlag);
						pageview('/app');
						if (r.next() < 0.8)
							track('project_created', {
								framework: r.pick(['nextjs', 'sveltekit', 'astro', 'react', 'node'])
							});
						person.subscribes = r.next() < (variant === 'redesign' ? 0.42 : 0.3);
					}
				}
			}

			if (identified) {
				const actions = r.int(1, 6);
				for (let a = 0; a < actions; a++) {
					path = r.weighted(APP_PAGES);
					pageview(path);
					if (path.startsWith('/app/insights') || path === '/app/dashboards')
						track('insight_viewed', {
							insight_kind: path.split('/').pop() === 'funnels' ? 'funnel' : 'trends'
						});
					if (path === '/app/flags' && r.next() < 0.3)
						track('flag_toggled', { enabled: r.next() < 0.6 });
					if (r.next() < 0.08) track('invite_sent', { role: r.pick(['member', 'admin']) });
					for (const error of ERRORS) {
						if (path !== error.page && error.page !== '/app') continue;
						// The chart bug arrived with 1.9.0, a week ago.
						const recent = at > end - 7 * DAY_MS;
						if (error.fn === 'renderChart' && !recent) continue;
						// The date bug was fixed and resolved three days ago.
						if (error.fn === 'formatDate' && at > end - 3.5 * DAY_MS) continue;
						if (r.next() >= error.rate * (error.fn === 'renderChart' ? 3 : 1)) continue;
						push({
							event: '$exception',
							at,
							distinct_id: id(),
							session_id: sessionId,
							groups: groups(),
							properties: {
								...base(),
								$current_url: `https://${HOST}${path}`,
								$pathname: path,
								$release: recent ? '1.9.0' : at > end - 18 * DAY_MS ? '1.8.1' : '1.8.0',
								$exception_level: 'error',
								$exception_fingerprint: fingerprintOf(error),
								$exception_list: [
									{
										type: error.type,
										value: error.value,
										mechanism: { type: 'onerror', handled: false },
										stacktrace: {
											frames: [
												{
													filename: `https://${HOST}/assets/vendor-7f3a1c.js`,
													function: 'invokeGuarded',
													lineno: 1,
													colno: r.int(1000, 9000),
													in_app: false
												},
												{
													filename: `https://${HOST}/assets/${error.file}`,
													function: error.fn,
													lineno: 1,
													colno: r.int(100, 4000),
													in_app: true
												}
											]
										}
									}
								]
							}
						});
					}
				}
				if (person.subscribes && r.next() < 0.5) {
					pageview('/app/billing');
					track('subscription_started', {
						plan: person.plan === 'free' ? 'pro' : person.plan,
						amount: person.plan === 'enterprise' ? 499 : 49
					});
					person.subscribes = false;
				}
				if (r.next() < 0.35) {
					const chats = r.int(1, 3);
					for (let c = 0; c < chats; c++) at = aiTrace(r, push, id(), sessionId, groups(), at);
				}
			}

			push({
				event: '$pageleave',
				at,
				distinct_id: id(),
				session_id: sessionId,
				groups: groups(),
				properties: { ...base(), $current_url: `https://${HOST}${path}`, $pathname: path }
			});
		}
	}

	return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * One assistant chat: a retrieval span with an embedding, then a generation, and maybe scores
 * for it. Returns its end.
 */
function aiTrace(
	r: ReturnType<typeof random>,
	push: (
		e: Omit<MockEvent, 'uuid' | 'project_id' | 'timestamp' | 'person_set' | 'person_set_once'> & {
			at: number;
		}
	) => void,
	distinctId: string,
	sessionId: string,
	groups: Record<string, string>,
	at: number
): number {
	const traceId = r.uuid();
	const question = r.pick(QUESTIONS);
	const { provider, model } = r.weighted(CHAT_MODELS);
	const failed = r.next() < 0.04;
	const embedLatency = 0.08 + r.next() * 0.2;
	const retrieveLatency = embedLatency + 0.05 + r.next() * 0.3;
	const genLatency = failed ? 0.4 + r.next() * 2 : 1.2 + r.next() * 6;
	const input = r.int(800, 6000);
	const output = failed ? 0 : r.int(80, 900);
	const embedTokens = r.int(8, 40);
	const ids = { trace: r.uuid(), retrieve: r.uuid(), embed: r.uuid(), chat: r.uuid() };
	const common = { $ai_trace_id: traceId };
	const event = (name: string, offset: number, properties: Record<string, unknown>) =>
		push({
			event: name,
			at: at + offset,
			distinct_id: distinctId,
			session_id: sessionId,
			groups,
			properties: { ...common, ...properties }
		});

	event('$ai_embedding', 10, {
		$ai_span_id: ids.embed,
		$ai_parent_id: ids.retrieve,
		$ai_span_name: 'embed question',
		$ai_provider: 'openai',
		$ai_model: 'text-embedding-3-small',
		$ai_input: question,
		$ai_input_tokens: embedTokens,
		$ai_latency: embedLatency,
		$ai_http_status: 200,
		$ai_cost_usd: cost('text-embedding-3-small', embedTokens, 0)
	});
	event('$ai_span', 0, {
		$ai_span_id: ids.retrieve,
		$ai_parent_id: ids.trace,
		$ai_span_name: 'retrieve',
		$ai_latency: retrieveLatency,
		$ai_input_state: { query: question, limit: 8 },
		$ai_output_state: { documents: r.int(3, 8) }
	});
	const chatAt = Math.round(retrieveLatency * 1000) + 20;
	event('$ai_generation', chatAt, {
		$ai_span_id: ids.chat,
		$ai_parent_id: ids.trace,
		$ai_span_name: 'chat',
		$ai_provider: provider,
		$ai_model: model,
		$ai_input: [
			{
				role: 'system',
				content: 'You are the Tracemark analytics assistant. Answer from the project data given.'
			},
			{ role: 'user', content: question }
		],
		...(failed
			? { $ai_is_error: true, $ai_error: 'overloaded_error: Overloaded', $ai_http_status: 529 }
			: {
					$ai_output_choices: [
						{
							role: 'assistant',
							content: `Here is what I found for “${question}” in the last 30 days of data…`
						}
					],
					$ai_http_status: 200
				}),
		$ai_input_tokens: input,
		$ai_output_tokens: output,
		$ai_latency: genLatency,
		$ai_stream: true,
		$ai_temperature: 0.2,
		$ai_max_tokens: 1024,
		$ai_cost_usd: cost(model, input, output)
	});
	const total = chatAt / 1000 + genLatency;
	event('$ai_trace', 0, {
		$ai_span_id: ids.trace,
		$ai_span_name: 'assistant',
		$ai_latency: total,
		$ai_input_state: { question },
		...(failed
			? { $ai_is_error: true, $ai_error: 'overloaded_error: Overloaded' }
			: { $ai_output_state: { answered: true } })
	});
	// An LLM judge grades most answers, smaller models a little lower, and some people click
	// thumbs up or down on the answer, down more often when it failed.
	const done = Math.round(total * 1000);
	if (!failed && r.next() < 0.7) {
		const base = model.startsWith('claude-sonnet') ? 0.85 : 0.7;
		event('$ai_score', done + 500, {
			$ai_span_id: ids.chat,
			$ai_score_name: 'accuracy',
			$ai_score_value:
				Math.round(Math.min(1, Math.max(0, base + (r.next() - 0.5) * 0.4)) * 100) / 100
		});
	}
	if (r.next() < (failed ? 0.6 : 0.3)) {
		const up = !failed && r.next() < (model.startsWith('claude-sonnet') ? 0.85 : 0.65);
		event('$ai_score', done + r.int(3, 40) * 1000, {
			$ai_score_name: 'thumbs',
			$ai_score_value: up ? 1 : 0,
			...(!up && r.next() < 0.5
				? { $ai_score_comment: failed ? 'It just errored out.' : 'The numbers look wrong.' }
				: {})
		});
	}
	return at + done + r.int(20, 120) * 1000;
}

const LIKE_MOCK = `startsWith({column}, '${MOCK_PREFIX}')`;
const mockWhere = (column: string) => LIKE_MOCK.replace('{column}', column);

/** Deletes every mock row from ClickHouse; real people and groups never have a `demo-` id. */
export async function deleteMockEvents(config: ClickHouseConfig, projectId: string): Promise<void> {
	for (const [table, column] of [
		['events', 'distinct_id'],
		['person_aliases', 'alias'],
		['person_properties', 'distinct_id'],
		['group_properties', 'group_key'],
		['cohort_people', 'person']
	] as const) {
		await clickhouseQuery(
			config,
			`DELETE FROM ${table} WHERE project_id = {project:UUID} AND ${mockWhere(column)}`,
			{ params: { project: projectId } }
		);
	}
}

/** Inserts events in batches, so one request body stays a few megabytes. */
export async function insertMockEvents(
	config: ClickHouseConfig,
	events: MockEvent[]
): Promise<void> {
	const BATCH = 5000;
	for (let i = 0; i < events.length; i += BATCH) {
		const rows = events.slice(i, i + BATCH).map((e) => JSON.stringify(e));
		await clickhouseQuery(
			config,
			`INSERT INTO events (uuid, project_id, event, timestamp, distinct_id, session_id, properties, person_set, person_set_once, groups)
			FORMAT JSONEachRow\n${rows.join('\n')}`
		);
	}
}

/**
 * Creates the mock flags, experiment, cohorts, insights and dashboard that aren't there yet,
 * leaving any with the same key or name alone. Returns the flags as stored.
 */
export async function seedMockDefinitions(
	db: Db,
	projectId: string,
	userId: string,
	now: Date
): Promise<{ flags: FlagDefinition[]; betaCohortId: string | null }> {
	const existing = await db
		.select()
		.from(featureFlags)
		.where(
			and(
				eq(featureFlags.projectId, projectId),
				inArray(
					featureFlags.key,
					MOCK_FLAGS.map((f) => f.key)
				)
			)
		);
	const flags: FlagDefinition[] = [];
	for (const mock of MOCK_FLAGS) {
		const found = existing.find((row) => row.key === mock.key);
		const flag = parseFlag({
			...(found ? JSON.parse(found.definition) : mock.flag),
			key: mock.key,
			active: found ? found.active : mock.flag.active
		});
		flags.push(flag);
		if (found) continue;
		const { key: _key, active: _active, ...definition } = flag;
		await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(featureFlags)
				.values({
					projectId,
					key: mock.key,
					description: mock.description,
					active: flag.active,
					definition: JSON.stringify(definition),
					createdBy: userId
				})
				.returning();
			if (!row) throw new Error('failed to create flag');
			await tx.insert(flagVersions).values({
				flagId: row.id,
				version: row.version,
				description: row.description,
				active: row.active,
				definition: row.definition,
				changedBy: userId
			});
		});
	}

	const [experiment] = await db
		.select({ id: experiments.id })
		.from(experiments)
		.where(and(eq(experiments.projectId, projectId), eq(experiments.name, EXPERIMENT_NAME)));
	if (!experiment) {
		const [flagRow] = await db
			.select({ id: featureFlags.id })
			.from(featureFlags)
			.where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.key, EXPERIMENT_FLAG)));
		if (flagRow)
			await db.insert(experiments).values({
				projectId,
				flagId: flagRow.id,
				name: EXPERIMENT_NAME,
				description:
					'Demo: does the redesigned pricing page lead to more signups and subscriptions?',
				status: 'running',
				metrics: JSON.stringify(EXPERIMENT_METRICS),
				startedAt: new Date(now.getTime() - EXPERIMENT_DAYS * DAY_MS),
				createdBy: userId
			});
	}

	const cohortRows = await db
		.select({ id: cohorts.id, name: cohorts.name })
		.from(cohorts)
		.where(
			and(
				eq(cohorts.projectId, projectId),
				inArray(
					cohorts.name,
					MOCK_COHORTS.map((c) => c.name)
				)
			)
		);
	let betaCohortId: string | null = null;
	for (const mock of MOCK_COHORTS) {
		let row = cohortRows.find((c) => c.name === mock.name);
		if (!row) {
			[row] = await db
				.insert(cohorts)
				.values({
					projectId,
					name: mock.name,
					kind: mock.kind,
					filters: JSON.stringify(mock.filters),
					createdBy: userId
				})
				.returning({ id: cohorts.id, name: cohorts.name });
		}
		if (mock.kind === 'static') betaCohortId = row?.id ?? null;
	}

	const insightRows = await db
		.select({ id: insights.id, name: insights.name })
		.from(insights)
		.where(
			and(
				eq(insights.projectId, projectId),
				inArray(
					insights.name,
					MOCK_INSIGHTS.map((i) => i.name)
				)
			)
		);
	const insightIds: string[] = [];
	for (const mock of MOCK_INSIGHTS) {
		let row = insightRows.find((i) => i.name === mock.name);
		if (!row) {
			[row] = await db
				.insert(insights)
				.values({
					projectId,
					name: mock.name,
					kind: mock.saved.kind,
					query: JSON.stringify(mock.saved.query),
					createdBy: userId
				})
				.returning({ id: insights.id, name: insights.name });
		}
		if (row) insightIds.push(row.id);
	}

	const [dashboard] = await db
		.select({ id: dashboards.id })
		.from(dashboards)
		.where(and(eq(dashboards.projectId, projectId), eq(dashboards.name, MOCK_DASHBOARD)));
	if (!dashboard) {
		const [row] = await db
			.insert(dashboards)
			.values({ projectId, name: MOCK_DASHBOARD })
			.returning();
		if (row && insightIds.length)
			await db
				.insert(dashboardInsights)
				.values(
					insightIds.map((insightId, position) => ({ dashboardId: row.id, insightId, position }))
				);
	}

	// One issue already fixed and one ignored, so the triage states show.
	for (const [fingerprint, status] of [
		[MOCK_FINGERPRINTS[3], 'resolved'],
		[MOCK_FINGERPRINTS[5], 'ignored']
	] as const) {
		if (!fingerprint) continue;
		await db
			.insert(errorIssues)
			.values({
				projectId,
				fingerprint,
				status,
				statusChangedAt: new Date(now.getTime() - 3 * DAY_MS),
				statusChangedBy: userId
			})
			.onConflictDoNothing();
	}

	return { flags, betaCohortId };
}

/** Removes the definitions `seedMockDefinitions` creates, by their keys and names. */
export async function deleteMockDefinitions(db: Db, projectId: string): Promise<void> {
	await db
		.delete(experiments)
		.where(and(eq(experiments.projectId, projectId), eq(experiments.name, EXPERIMENT_NAME)));
	await db.delete(featureFlags).where(
		and(
			eq(featureFlags.projectId, projectId),
			inArray(
				featureFlags.key,
				MOCK_FLAGS.map((f) => f.key)
			)
		)
	);
	await db.delete(cohorts).where(
		and(
			eq(cohorts.projectId, projectId),
			inArray(
				cohorts.name,
				MOCK_COHORTS.map((c) => c.name)
			)
		)
	);
	await db
		.delete(dashboards)
		.where(and(eq(dashboards.projectId, projectId), eq(dashboards.name, MOCK_DASHBOARD)));
	await db.delete(insights).where(
		and(
			eq(insights.projectId, projectId),
			inArray(
				insights.name,
				MOCK_INSIGHTS.map((i) => i.name)
			)
		)
	);
	await db
		.delete(errorIssues)
		.where(
			and(eq(errorIssues.projectId, projectId), inArray(errorIssues.fingerprint, MOCK_FINGERPRINTS))
		);
}

/**
 * Fills a project with mock data: definitions first, then a fresh month of events in place of
 * any earlier mock events. Safe to run again. Returns how many events it added.
 */
export async function addMockData(
	db: Db,
	config: ClickHouseConfig,
	projectId: string,
	userId: string,
	now = new Date()
): Promise<number> {
	const { flags, betaCohortId } = await seedMockDefinitions(db, projectId, userId, now);
	const events = mockEvents(projectId, now, flags);
	await deleteMockEvents(config, projectId);
	await insertMockEvents(config, events);
	if (betaCohortId) {
		await clickhouseQuery(
			config,
			`INSERT INTO cohort_people (project_id, cohort_id, person)
			SELECT {project:UUID}, {cohort:UUID}, arrayJoin({ids:Array(String)})`,
			{ params: { project: projectId, cohort: betaCohortId, ids: betaTesters(events) } }
		);
	}
	return events.length;
}

/** Removes everything `addMockData` added. Real events, and definitions with other names, stay. */
export async function removeMockData(
	db: Db,
	config: ClickHouseConfig,
	projectId: string
): Promise<void> {
	await deleteMockDefinitions(db, projectId);
	await deleteMockEvents(config, projectId);
}
