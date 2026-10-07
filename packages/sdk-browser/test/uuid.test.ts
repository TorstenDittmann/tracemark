import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/uuid';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
	it('has the v7 layout and variant bits', () => {
		for (let i = 0; i < 1000; i++) expect(uuidv7()).toMatch(V7);
	});

	it('encodes the millisecond timestamp in the first 48 bits', () => {
		const ts = Date.UTC(2030, 0, 1);
		const id = uuidv7(ts);
		expect(Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(ts);
	});

	it('is strictly increasing, including within one millisecond', () => {
		const now = Date.UTC(2031, 0, 1);
		const ids = Array.from({ length: 10_000 }, () => uuidv7(now));
		for (let i = 1; i < ids.length; i++)
			expect((ids[i] as string) > (ids[i - 1] as string)).toBe(true);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(V7);
	});

	it('never goes backwards when the clock does', () => {
		const a = uuidv7(Date.UTC(2032, 0, 1));
		const b = uuidv7(Date.UTC(2020, 0, 1));
		expect(b > a).toBe(true);
	});
});
