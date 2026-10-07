import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

describe('RateLimiter', () => {
	it('allows up to the limit per window', () => {
		const limiter = new RateLimiter(2, 1000);
		expect(limiter.consume('a', 0)).toBe(true);
		expect(limiter.consume('a', 10)).toBe(true);
		expect(limiter.consume('a', 20)).toBe(false);
		expect(limiter.consume('b', 20)).toBe(true);
		expect(limiter.consume('a', 1000)).toBe(true);
	});

	it('can be reset', () => {
		const limiter = new RateLimiter(1, 1000);
		limiter.consume('a', 0);
		limiter.reset('a');
		expect(limiter.consume('a', 1)).toBe(true);
	});
});
