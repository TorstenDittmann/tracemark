import { describe, expect, it } from 'vitest';
import { generatePublicKey, safeEqual } from './keys';

describe('generatePublicKey', () => {
	it('has the prefix and 32 hex characters', () => {
		expect(generatePublicKey()).toMatch(/^fp_pub_[0-9a-f]{32}$/);
	});

	it('is random', () => {
		expect(generatePublicKey()).not.toBe(generatePublicKey());
	});
});

describe('safeEqual', () => {
	it('compares strings', () => {
		expect(safeEqual('secret', 'secret')).toBe(true);
		expect(safeEqual('secret', 'secreT')).toBe(false);
		expect(safeEqual('secret', 'secret-longer')).toBe(false);
		expect(safeEqual('', '')).toBe(true);
	});
});
