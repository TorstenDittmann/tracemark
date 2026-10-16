import { describe, expect, it } from 'vitest';
import { beta, conversionResults, countResults, gamma, random, sampleSize } from './stats';

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

describe('sampling', () => {
	it('is deterministic for a seed', () => {
		const a = random(7);
		const b = random(7);
		expect([a(), a(), a()]).toEqual([b(), b(), b()]);
		expect(random(8)()).not.toBe(random(7)());
	});

	it('draws gamma and beta samples with the right means', () => {
		const rand = random(1);
		for (const shape of [0.5, 1, 3, 40]) {
			const draws = Array.from({ length: 20_000 }, () => gamma(rand, shape));
			expect(mean(draws)).toBeCloseTo(shape, shape < 5 ? 1 : 0);
		}
		const draws = Array.from({ length: 20_000 }, () => beta(rand, 3, 7));
		expect(mean(draws)).toBeCloseTo(0.3, 2);
	});
});

describe('conversion results', () => {
	it('gives a clear winner a high chance to be best', () => {
		const [control, test] = conversionResults([
			{ key: 'control', people: 1000, value: 100 },
			{ key: 'test', people: 1000, value: 150 }
		]);
		expect(control?.rate).toBe(0.1);
		expect(test?.chanceToBeBest).toBeGreaterThan(0.99);
		expect(control?.interval[0]).toBeGreaterThan(0.08);
		expect(control?.interval[1]).toBeLessThan(0.125);
		expect((control?.chanceToBeBest ?? 0) + (test?.chanceToBeBest ?? 0)).toBe(1);
	});

	it('splits the chance between variants that are the same', () => {
		const results = conversionResults([
			{ key: 'a', people: 500, value: 50 },
			{ key: 'b', people: 500, value: 50 },
			{ key: 'c', people: 500, value: 50 }
		]);
		for (const result of results) expect(result.chanceToBeBest).toBeCloseTo(1 / 3, 1);
	});

	it('handles variants nobody saw yet', () => {
		const [empty] = conversionResults([
			{ key: 'a', people: 0, value: 0 },
			{ key: 'b', people: 10, value: 5 }
		]);
		expect(empty?.rate).toBe(0);
		// A uniform prior: the interval spans almost everything.
		expect(empty?.interval[0]).toBeLessThan(0.05);
		expect(empty?.interval[1]).toBeGreaterThan(0.95);
	});
});

describe('count results', () => {
	it('compares events per person', () => {
		const [control, test] = countResults([
			{ key: 'control', people: 400, value: 800 },
			{ key: 'test', people: 400, value: 1000 }
		]);
		expect(control?.rate).toBe(2);
		expect(test?.rate).toBe(2.5);
		expect(test?.chanceToBeBest).toBeGreaterThan(0.99);
		expect(test?.interval[0]).toBeGreaterThan(2.2);
		expect(test?.interval[1]).toBeLessThan(2.8);
	});
});

describe('sample size', () => {
	it('matches the usual two-proportion formula', () => {
		// 10% baseline, detecting a 20% relative lift (to 12%).
		expect(sampleSize(0.1, 0.2)).toBe(3841);
		expect(sampleSize(0.5, 0.1)).toBe(1565);
	});

	it('refuses impossible inputs', () => {
		expect(sampleSize(0, 0.1)).toBeNull();
		expect(sampleSize(0.9, 0.5)).toBeNull();
		expect(sampleSize(0.1, 0)).toBeNull();
	});
});
