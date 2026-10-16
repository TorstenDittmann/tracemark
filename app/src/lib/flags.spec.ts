import { describe, expect, it } from 'vitest';
import { evenSplit, flagKind, flagSummary, parsePayloads } from './flags';

const flag = {
	key: 'f',
	active: true,
	conditions: [{ filters: [], rollout: 30 }],
	variants: [],
	payloads: {}
};

describe('flag helpers', () => {
	it('split 100% evenly', () => {
		expect(evenSplit(2)).toEqual([50, 50]);
		expect(evenSplit(3)).toEqual([34, 33, 33]);
		expect(evenSplit(7).reduce((a, b) => a + b)).toBe(100);
	});

	it('parse payload text', () => {
		expect(parsePayloads({ true: ' {"a": 1} ', control: '', test: '"x"' })).toEqual({
			true: { a: 1 },
			test: 'x'
		});
		expect(() => parsePayloads({ test: '{nope' })).toThrow(/test isn't valid JSON/);
		expect(() => parsePayloads({ test: `"${'x'.repeat(10_000)}"` })).toThrow(/KB/);
	});

	it('summarize who gets a flag', () => {
		expect(flagSummary(flag)).toBe('30% of everyone');
		expect(flagSummary({ ...flag, groupType: 'company' })).toBe('30% of groups');
		expect(
			flagSummary({
				...flag,
				conditions: [{ filters: [{ type: 'cohort', cohort: 'c' }], rollout: 100 }]
			})
		).toBe('100% of matching people');
		expect(flagSummary({ ...flag, conditions: [] })).toBe('Nobody');
		expect(flagSummary({ ...flag, conditions: [flag.conditions[0], flag.conditions[0]] })).toBe(
			'2 conditions'
		);
		expect(flagKind(flag)).toBe('Boolean');
		expect(flagKind({ ...flag, variants: [{ key: 'a', rollout: 100 }] })).toBe('1 variant');
	});
});
