import { describe, expect, it } from 'vitest';
import { formatVital, rateVital } from './web';

describe('web vitals', () => {
	it("rates values by Google's thresholds, inclusive of the good and poor limits", () => {
		expect(rateVital('LCP', 2500)).toBe('good');
		expect(rateVital('LCP', 2501)).toBe('needs-improvement');
		expect(rateVital('LCP', 4000)).toBe('needs-improvement');
		expect(rateVital('LCP', 4001)).toBe('poor');
		expect(rateVital('INP', 180)).toBe('good');
		expect(rateVital('INP', 600)).toBe('poor');
		expect(rateVital('CLS', 0.1)).toBe('good');
		expect(rateVital('CLS', 0.2)).toBe('needs-improvement');
		expect(rateVital('TTFB', 2000)).toBe('poor');
	});

	it('formats times in ms or seconds and CLS without a unit', () => {
		expect(formatVital('INP', 183.6)).toBe('184 ms');
		expect(formatVital('LCP', 2450)).toBe('2.45 s');
		expect(formatVital('CLS', 0.0912)).toBe('0.09');
	});
});
