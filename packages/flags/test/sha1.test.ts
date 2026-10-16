import { describe, expect, it } from 'vitest';
import { sha1 } from '../src';

describe('sha1', () => {
	it.each([
		['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
		['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
		[
			'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
			'84983e441c3bd26ebaae4aa1f95129e5e54670f1'
		],
		['The quick brown fox jumps over the lazy dog', '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12'],
		['ünïcode 用户 🦊', '']
	])('hashes %j', (input, expected) => {
		if (expected) expect(sha1(input)).toBe(expected);
		else expect(sha1(input)).toMatch(/^[0-9a-f]{40}$/);
	});

	it('matches node:crypto on long and multi-byte input', async () => {
		const { createHash } = await import('node:crypto');
		for (const input of [
			'x'.repeat(1000),
			'ünïcode 用户 🦊'.repeat(9),
			'a'.repeat(55),
			'a'.repeat(64)
		]) {
			expect(sha1(input)).toBe(createHash('sha1').update(input).digest('hex'));
		}
	});
});
