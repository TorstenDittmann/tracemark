import { describe, expect, it } from 'vitest';
import { MAX_METRICS, metricLabel, parseMetrics, storedMetrics } from './experiments';

describe('experiment metrics', () => {
	it('keep valid conversion and count metrics', () => {
		expect(
			parseMetrics([
				{ kind: 'conversion', event: 'purchase', extra: 1 },
				{ kind: 'count', event: '$pageview' }
			])
		).toEqual([
			{ kind: 'conversion', event: 'purchase' },
			{ kind: 'count', event: '$pageview' }
		]);
	});

	it('reject anything else', () => {
		expect(() => parseMetrics({})).toThrow('list');
		expect(() => parseMetrics([{ kind: 'sum', event: 'a' }])).toThrow('type');
		expect(() => parseMetrics([{ kind: 'count', event: '' }])).toThrow('event');
		expect(() => parseMetrics([{ kind: 'count', event: 'a`b' }])).toThrow('event');
		expect(() => parseMetrics([null])).toThrow('type');
		const many = Array.from({ length: MAX_METRICS + 1 }, () => ({ kind: 'count', event: 'a' }));
		expect(() => parseMetrics(many)).toThrow(`${MAX_METRICS}`);
	});

	it('read invalid stored metrics as none', () => {
		expect(storedMetrics('nope')).toEqual([]);
		expect(storedMetrics('[{"kind":"count","event":"a"}]')).toEqual([
			{ kind: 'count', event: 'a' }
		]);
	});

	it('label metrics', () => {
		expect(metricLabel({ kind: 'conversion', event: 'purchase' })).toBe('Converted to purchase');
		expect(metricLabel({ kind: 'count', event: 'purchase' })).toBe('purchase per person');
	});
});
