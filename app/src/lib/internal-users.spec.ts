import { describe, expect, it } from 'vitest';
import {
	describeInternalRule,
	internalRuleKey,
	MAX_INTERNAL_RULES,
	parseInternalRule,
	parseInternalRules,
	parseInternalRulesJson
} from './internal-users';

describe('internal user rules', () => {
	it('normalizes emails and domains', () => {
		expect(parseInternalRule({ kind: 'email', value: ' Dev@Acme.com ' })).toEqual({
			kind: 'email',
			value: 'dev@acme.com'
		});
		expect(parseInternalRule({ kind: 'email_domain', value: 'Acme.com' })).toEqual({
			kind: 'email_domain',
			value: '@acme.com'
		});
		expect(parseInternalRule({ kind: 'email_domain', value: '@acme.com' })).toEqual({
			kind: 'email_domain',
			value: '@acme.com'
		});
		expect(parseInternalRule({ kind: 'email', value: 'not an email' })).toBe(
			'Enter an email address.'
		);
		expect(parseInternalRule({ kind: 'email_domain', value: '@' })).toMatch(/domain/);
		expect(parseInternalRule({ kind: 'email_domain', value: 'a@b.com' })).toMatch(/domain/);
	});

	it('keeps distinct ids and property values as typed', () => {
		expect(parseInternalRule({ kind: 'distinct_id', value: ' QA-Bot ' })).toEqual({
			kind: 'distinct_id',
			value: 'QA-Bot'
		});
		expect(parseInternalRule({ kind: 'property', property: '$host', value: 'localhost' })).toEqual({
			kind: 'property',
			property: '$host',
			value: 'localhost'
		});
	});

	it('rejects invalid rules', () => {
		expect(parseInternalRule({ kind: 'cohort', value: 'x' })).toBe('Choose what to match.');
		expect(parseInternalRule({ kind: 'toString', value: 'x' })).toBe('Choose what to match.');
		expect(parseInternalRule({ kind: 'distinct_id', value: '  ' })).toBe('Enter a value.');
		expect(parseInternalRule({ kind: 'distinct_id', value: 3 })).toBe('Enter a value.');
		expect(parseInternalRule({ kind: 'distinct_id', value: 'x'.repeat(201) })).toMatch(/200/);
		expect(parseInternalRule({ kind: 'distinct_id', value: 'a\tb' })).toMatch(/invalid/);
		expect(parseInternalRule({ kind: 'property', property: 'a`b', value: 'x' })).toBe(
			'Enter a property name.'
		);
		expect(parseInternalRule({ kind: 'property', value: 'x' })).toBe('Enter a property name.');
	});

	it('reads stored rules, dropping invalid ones and duplicates', () => {
		expect(
			parseInternalRules([
				{ kind: 'email_domain', value: '@acme.com' },
				{ kind: 'email_domain', value: 'ACME.com' },
				{ kind: 'property', property: 'bad`name', value: 'x' },
				null,
				'x',
				{ kind: 'distinct_id', value: 'qa' }
			])
		).toEqual([
			{ kind: 'email_domain', value: '@acme.com' },
			{ kind: 'distinct_id', value: 'qa' }
		]);
		const many = Array.from({ length: 60 }, (_, i) => ({ kind: 'distinct_id', value: `u${i}` }));
		expect(parseInternalRules(many)).toHaveLength(MAX_INTERNAL_RULES);
		expect(parseInternalRulesJson('{')).toEqual([]);
		expect(parseInternalRulesJson(null)).toEqual([]);
		expect(parseInternalRulesJson('{"kind":"email"}')).toEqual([]);
	});

	it('describes and identifies rules', () => {
		expect(describeInternalRule({ kind: 'property', property: '$host', value: 'localhost' })).toBe(
			'$host equals localhost'
		);
		expect(describeInternalRule({ kind: 'email_domain', value: '@acme.com' })).toBe(
			'Email ends with @acme.com'
		);
		expect(internalRuleKey({ kind: 'distinct_id', value: 'a' })).not.toBe(
			internalRuleKey({ kind: 'email', value: 'a' })
		);
	});
});
