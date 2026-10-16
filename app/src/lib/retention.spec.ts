import { describe, expect, it } from 'vitest';
import { parseRetention, retentionLabel } from './retention';

describe('retention', () => {
	it('reads offered periods and nothing else', () => {
		expect(parseRetention('forever')).toBeNull();
		expect(parseRetention('90')).toBe(90);
		expect(parseRetention('91')).toBeUndefined();
		expect(parseRetention(null)).toBeUndefined();
		expect(parseRetention('')).toBeUndefined();
	});

	it('labels periods', () => {
		expect(retentionLabel(null)).toBe('Keep forever');
		expect(retentionLabel(30)).toBe('30 days');
		expect(retentionLabel(365)).toBe('1 year');
		expect(retentionLabel(1825)).toBe('5 years');
	});
});
