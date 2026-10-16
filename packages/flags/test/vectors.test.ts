import { describe, expect, it } from 'vitest';
import {
	bucket,
	type EvaluateOptions,
	evaluate,
	type FlagContext,
	type FlagResult,
	parseFlag
} from '../src';
import vectors from '../vectors.json';

interface Case {
	context: FlagContext;
	missing?: EvaluateOptions['missing'];
	expected: FlagResult | 'inconclusive' | Omit<FlagResult, 'key'>;
}

describe('shared vectors', () => {
	it.each(vectors.buckets)('buckets $id for $flag$salt', ({ flag, id, salt, bucket: expected }) => {
		expect(bucket(flag, id, salt)).toBe(expected);
	});

	describe.each(vectors.flags)('$name', ({ flag: raw, cases }) => {
		const flag = parseFlag(raw);

		it('is a canonical definition', () => {
			expect(flag).toEqual(raw);
		});

		it.each(cases as Case[])('case %#', ({ context, missing, expected }) => {
			const run = () => evaluate(flag, context, { missing });
			if (expected === 'inconclusive') {
				expect(run).toThrow(/locally/);
			} else {
				expect(run()).toEqual({ key: flag.key, ...expected });
			}
		});
	});
});
