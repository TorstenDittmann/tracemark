import { describe, expect, it } from 'vitest';
import {
	DEFAULT_FUNNEL,
	DEFAULT_RETENTION,
	DEFAULT_TRENDS,
	MAX_SERIES,
	MAX_STEPS,
	parseFunnel,
	parseFunnelParam,
	parseRetention,
	parseRetentionParam,
	parseTrends,
	parseTrendsParam
} from './insights';

describe('parseTrends', () => {
	it('keeps a valid query', () => {
		const query = {
			series: [
				{ event: 'signed_up', math: 'unique_users' },
				{ event: 'purchase', math: 'sum', property: 'amount' }
			],
			range: '30d',
			breakdown: '$browser',
			filters: [
				{ property: 'plan', operator: 'eq', value: 'pro' },
				{ property: 'email', operator: 'is_set' }
			]
		};
		expect(parseTrends(query)).toEqual(query);
	});

	it('drops invalid parts and falls back to defaults', () => {
		expect(
			parseTrends({
				series: [
					{ event: 'a`b', math: 'total' },
					{ event: 'ok', math: 'nope' },
					{ event: 'avg', math: 'avg' },
					'junk'
				],
				range: 'forever',
				breakdown: '',
				filters: [
					{ property: 'x', operator: 'eq' },
					{ property: 'x', operator: 'drop table', value: '1' },
					{ property: 'y', operator: 'is_set', value: 'ignored' }
				]
			})
		).toEqual({
			series: [{ event: 'ok', math: 'total' }],
			range: '7d',
			breakdown: undefined,
			filters: [{ property: 'y', operator: 'is_set' }]
		});
		expect(parseTrends(null)).toEqual(DEFAULT_TRENDS);
		expect(parseTrends({ series: [] }).series).toEqual(DEFAULT_TRENDS.series);
	});

	it('caps the number of series', () => {
		const series = Array.from({ length: 9 }, (_, i) => ({ event: `e${i}`, math: 'total' }));
		expect(parseTrends({ series }).series).toHaveLength(MAX_SERIES);
	});

	it('reads the URL parameter', () => {
		expect(parseTrendsParam('{not json')).toEqual(DEFAULT_TRENDS);
		expect(parseTrendsParam(null)).toEqual(DEFAULT_TRENDS);
		expect(parseTrendsParam('{"series":[{"event":"x","math":"total"}]}').series).toEqual([
			{ event: 'x', math: 'total' }
		]);
	});
});

describe('parseFunnel', () => {
	it('keeps a valid funnel', () => {
		const funnel = {
			steps: ['$pageview', 'signed_up', 'purchase'],
			window: '7d',
			range: '90d',
			breakdown: 'utm_source',
			filters: [{ property: '$browser', operator: 'eq', value: 'Chrome' }]
		};
		expect(parseFunnel(funnel)).toEqual(funnel);
	});

	it('needs two valid steps and known windows', () => {
		expect(parseFunnel({ steps: ['only'], window: '1y' })).toEqual(DEFAULT_FUNNEL);
		expect(parseFunnel({ steps: ['a', 'b`', 'c'] }).steps).toEqual(['a', 'c']);
		expect(
			parseFunnel({ steps: Array.from({ length: 12 }, (_, i) => `s${i}`) }).steps
		).toHaveLength(MAX_STEPS);
		expect(parseFunnelParam('nope')).toEqual(DEFAULT_FUNNEL);
	});
});

describe('parseRetention', () => {
	it('keeps a valid query and has no hourly cohorts', () => {
		const query = { start: 'signed_up', returning: 'purchase', range: '90d', filters: [] };
		expect(parseRetention(query)).toEqual(query);
		expect(parseRetention({ ...query, range: '24h' }).range).toBe('7d');
		expect(parseRetention({ start: 'a`', returning: 5 })).toEqual(DEFAULT_RETENTION);
		expect(parseRetentionParam('{')).toEqual(DEFAULT_RETENTION);
	});
});
