// Internal users: rules for the team's own traffic, which analytics can leave out (see
// docs/internal-users.md). Shared by the settings page, the editors and the server queries.
// Rules are stored as JSON and submitted in forms, so everything here is parsed defensively.
import { validName } from './insights';

export const INTERNAL_RULE_KINDS = {
	email: 'Email is',
	email_domain: 'Email ends with',
	distinct_id: 'Distinct id is',
	property: 'Event property equals'
} as const;

export type InternalRuleKind = keyof typeof INTERNAL_RULE_KINDS;

/**
 * Email rules match the person property `email` (case-insensitive), distinct id rules a person by
 * any of their distinct ids, and property rules single events.
 */
export type InternalRule =
	| { kind: 'email' | 'email_domain' | 'distinct_id'; value: string }
	| { kind: 'property'; property: string; value: string };

/** Rules a project can have at most. */
export const MAX_INTERNAL_RULES = 50;

const MAX_VALUE = 200;

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
const CONTROL = /[\u0000-\u001f]/;

/** A rule from untrusted input, normalized, or a message saying what is wrong. */
export function parseInternalRule(input: {
	kind: unknown;
	property?: unknown;
	value: unknown;
}): InternalRule | string {
	const kind = input.kind;
	if (typeof kind !== 'string' || !Object.hasOwn(INTERNAL_RULE_KINDS, kind)) {
		return 'Choose what to match.';
	}
	const raw = typeof input.value === 'string' ? input.value.trim() : '';
	if (!raw) return 'Enter a value.';
	if (raw.length > MAX_VALUE) return `Use at most ${MAX_VALUE} characters.`;
	if (CONTROL.test(raw)) return 'The value has invalid characters.';
	switch (kind as InternalRuleKind) {
		case 'email': {
			const value = raw.toLowerCase();
			if (!/^[^\s@]+@[^\s@]+$/.test(value)) return 'Enter an email address.';
			return { kind: 'email', value };
		}
		case 'email_domain': {
			const value = (raw.startsWith('@') ? raw : `@${raw}`).toLowerCase();
			if (!/^@[^\s@]+$/.test(value)) return 'Enter a domain, like @example.com.';
			return { kind: 'email_domain', value };
		}
		case 'distinct_id':
			return { kind: 'distinct_id', value: raw };
		case 'property': {
			const property = typeof input.property === 'string' ? input.property.trim() : '';
			if (!validName(property)) return 'Enter a property name.';
			return { kind: 'property', property, value: raw };
		}
	}
}

/** Rules as stored, dropping anything invalid and duplicates. */
export function parseInternalRules(input: unknown): InternalRule[] {
	const rules: InternalRule[] = [];
	const seen = new Set<string>();
	for (const raw of Array.isArray(input) ? input : []) {
		if (typeof raw !== 'object' || raw === null) continue;
		const { kind, property, value } = raw as Record<string, unknown>;
		const rule = parseInternalRule({ kind, property, value });
		if (typeof rule === 'string') continue;
		const key = internalRuleKey(rule);
		if (seen.has(key)) continue;
		seen.add(key);
		rules.push(rule);
		if (rules.length === MAX_INTERNAL_RULES) break;
	}
	return rules;
}

/** Stored JSON as rules; anything unreadable is no rules. */
export function parseInternalRulesJson(json: string | null | undefined): InternalRule[] {
	try {
		return parseInternalRules(JSON.parse(json ?? '[]'));
	} catch {
		return [];
	}
}

/** Identifies a rule, to find duplicates. */
export function internalRuleKey(rule: InternalRule): string {
	return JSON.stringify([rule.kind, rule.kind === 'property' ? rule.property : '', rule.value]);
}

export function describeInternalRule(rule: InternalRule): string {
	switch (rule.kind) {
		case 'email':
			return `Email is ${rule.value}`;
		case 'email_domain':
			return `Email ends with ${rule.value}`;
		case 'distinct_id':
			return `Distinct id is ${rule.value}`;
		case 'property':
			return `${rule.property} equals ${rule.value}`;
	}
}
