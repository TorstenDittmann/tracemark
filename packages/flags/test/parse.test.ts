import { describe, expect, it } from 'vitest';
import { evaluateAll, parseFlag } from '../src';

const base = { key: 'flag', active: true, conditions: [{ filters: [], rollout: 100 }] };

describe('parseFlag', () => {
	it('fills in defaults', () => {
		expect(parseFlag({ key: 'flag' })).toEqual({
			key: 'flag',
			active: false,
			conditions: [],
			variants: [],
			payloads: {}
		});
	});

	it.each([
		[null, /object/],
		[{ key: 'has space' }, /key/],
		[
			{
				...base,
				variants: [
					{ key: 'a', rollout: 60 },
					{ key: 'b', rollout: 30 }
				]
			},
			/100%/
		],
		[
			{
				...base,
				variants: [
					{ key: 'a', rollout: 50 },
					{ key: 'a', rollout: 50 }
				]
			},
			/unique/
		],
		[{ ...base, conditions: [{ filters: [], rollout: 101 }] }, /rollout/],
		[{ ...base, conditions: [{ filters: [], rollout: 100, variant: 'nope' }] }, /variant/],
		[
			{
				...base,
				conditions: [
					{ filters: [{ type: 'person', property: 'a', operator: 'like', value: 'x' }], rollout: 1 }
				]
			},
			/operator/
		],
		[
			{
				...base,
				conditions: [{ filters: [{ type: 'person', property: 'a', operator: 'eq' }], rollout: 1 }]
			},
			/value/
		],
		[
			{
				...base,
				conditions: [
					{ filters: [{ type: 'group', property: 'a', operator: 'is_set' }], rollout: 1 }
				]
			},
			/group type/
		],
		[{ ...base, payloads: { control: 1 } }, /payload/]
	])('rejects %j', (input, message) => {
		expect(() => parseFlag(input)).toThrow(message);
	});

	it('drops a value on operators that take none', () => {
		const flag = parseFlag({
			...base,
			conditions: [
				{ filters: [{ type: 'person', property: 'a', operator: 'is_set', value: 'x' }], rollout: 5 }
			]
		});
		expect(flag.conditions[0]?.filters[0]).toEqual({
			type: 'person',
			property: 'a',
			operator: 'is_set'
		});
	});
});

describe('evaluateAll', () => {
	it('sets aside flags it cannot decide', () => {
		const flags = [
			parseFlag(base),
			parseFlag({
				...base,
				key: 'cohort',
				conditions: [{ filters: [{ type: 'cohort', cohort: 'c' }], rollout: 100 }]
			})
		];
		const { results, inconclusive } = evaluateAll(flags, { distinctId: 'ada' });
		expect(Object.keys(results)).toEqual(['flag']);
		expect(inconclusive).toEqual(['cohort']);
	});
});
