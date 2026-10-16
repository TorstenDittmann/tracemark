import { describe, expect, it } from 'vitest';
import { arrayParam, escaped } from './clickhouse';

describe('query parameters', () => {
	it('escapes strings for the escaped text format', () => {
		expect(escaped(`plain`)).toBe('plain');
		expect(escaped(`a\\b\tc\nd`)).toBe('a\\\\b\\tc\\nd');
		// Quotes need no escaping outside an array.
		expect(escaped(`o'brien`)).toBe(`o'brien`);
	});

	it('quotes array elements', () => {
		expect(arrayParam([])).toBe('[]');
		expect(arrayParam(['a', `o'b\\c`])).toBe(`['a','o\\'b\\\\c']`);
	});
});
