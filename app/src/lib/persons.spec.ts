import { describe, expect, it } from 'vitest';
import { formatPersonCursor, parsePersonCursor, personName } from './persons';

describe('person cursors', () => {
	it('round-trips ids containing underscores', () => {
		const cursor = { lastSeen: '2026-10-16T12:00:00.000Z', person: 'user_42_b' };
		expect(parsePersonCursor(formatPersonCursor(cursor))).toEqual(cursor);
	});

	it('ignores malformed values', () => {
		expect(parsePersonCursor(null)).toBeUndefined();
		expect(parsePersonCursor('nope')).toBeUndefined();
		expect(parsePersonCursor('2026-10-16_x')).toBeUndefined();
		expect(parsePersonCursor('2026-10-16T12:00:00Z_')).toBeUndefined();
	});
});

describe('person names', () => {
	it('prefers email, then name, then the id', () => {
		expect(personName('u1', { name: 'Ada', email: 'ada@example.com' })).toBe('ada@example.com');
		expect(personName('u1', { name: ' Ada ' })).toBe('Ada');
		expect(personName('u1', { email: 42, name: '' })).toBe('u1');
	});
});
