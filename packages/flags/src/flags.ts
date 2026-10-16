import { sha1 } from './sha1';

export const OPERATORS = [
	'eq',
	'neq',
	'contains',
	'not_contains',
	'gt',
	'lt',
	'is_set',
	'is_not_set'
] as const;
export type Operator = (typeof OPERATORS)[number];

/** A person or group property compared to a value; `is_set` and `is_not_set` take none. */
export type PropertyMatch =
	| { property: string; operator: 'is_set' | 'is_not_set' }
	| { property: string; operator: Exclude<Operator, 'is_set' | 'is_not_set'>; value: string };

export type FlagFilter =
	| ({ type: 'person' } & PropertyMatch)
	| ({ type: 'group'; groupType: string } & PropertyMatch)
	| { type: 'cohort'; cohort: string };

/** Who a condition matches (every filter) and what share of them get the flag. */
export interface FlagCondition {
	filters: FlagFilter[];
	/** Percent of matching ids that get the flag, 0 to 100. */
	rollout: number;
	/** Serve this variant to everyone the condition lets in, instead of splitting by weight. */
	variant?: string;
}

export interface FlagVariant {
	key: string;
	/** Percent of enabled ids served this variant; a flag's variants add up to 100. */
	rollout: number;
}

export interface FlagDefinition {
	key: string;
	active: boolean;
	/** Bucket by this group's key instead of the person, so a whole company gets one answer. */
	groupType?: string;
	/** Matched in order; the first one an id matches decides. */
	conditions: FlagCondition[];
	/** Empty for a boolean flag. */
	variants: FlagVariant[];
	/** JSON served with a value: keyed by variant, or by `true` for a boolean flag. */
	payloads: Record<string, unknown>;
}

export interface FlagContext {
	distinctId: string;
	personProperties?: Record<string, unknown>;
	/** Group type to group key, such as `{ company: 'acme' }`. */
	groups?: Record<string, string>;
	/** Group type to that group's properties. */
	groupProperties?: Record<string, Record<string, unknown>>;
	/** Ids of the cohorts the person is in. Leave out when unknown. */
	cohorts?: string[];
}

export interface EvaluateOptions {
	/**
	 * How a property the context doesn't hold is read. `empty` (the server, which has every
	 * stored property) reads it as an empty string; `inconclusive` (an SDK evaluating locally
	 * with only what it was given) gives up so the caller can ask the server.
	 */
	missing?: 'empty' | 'inconclusive';
}

export type FlagReason = 'inactive' | 'no_group' | 'no_match' | 'out_of_rollout' | 'match';

export interface FlagResult {
	key: string;
	/** `false` when off; `true` or the variant key when on. */
	value: boolean | string;
	payload: unknown;
	reason: FlagReason;
	/** Index of the condition that matched. */
	condition?: number;
}

/** Thrown when the context lacks something a flag needs; the server can still evaluate it. */
export class InconclusiveError extends Error {
	constructor(
		readonly flag: string,
		detail: string
	) {
		super(`Can't evaluate ${flag} locally: ${detail}`);
		this.name = 'InconclusiveError';
	}
}

const SCALE = 2 ** 52;

/**
 * Where an id falls for a flag, in [0, 1): the first 52 bits of SHA-1 of
 * `<flag key>.<id><salt>`. The same on every platform, which the shared vectors check.
 */
export function bucket(flagKey: string, id: string, salt = ''): number {
	return Number.parseInt(sha1(`${flagKey}.${id}${salt}`).slice(0, 13), 16) / SCALE;
}

/** A property value as text, the way ClickHouse reads it: strings as is, the rest as JSON. */
function text(value: unknown): string {
	if (typeof value === 'string') return value;
	if (value === null || value === undefined) return '';
	return JSON.stringify(value);
}

const NUMBER = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

function number(value: string): number | null {
	return NUMBER.test(value) ? Number(value) : null;
}

/** Whether `actual` passes `match`, with the same meaning as the insight and cohort filters. */
export function matches(actual: string, match: PropertyMatch): boolean {
	switch (match.operator) {
		case 'eq':
			return actual === match.value;
		case 'neq':
			return actual !== match.value;
		case 'contains':
			return actual.toLowerCase().includes(match.value.toLowerCase());
		case 'not_contains':
			return !actual.toLowerCase().includes(match.value.toLowerCase());
		case 'gt':
		case 'lt': {
			const a = number(actual);
			const b = number(match.value);
			if (a === null || b === null) return false;
			return match.operator === 'gt' ? a > b : a < b;
		}
		case 'is_set':
			return actual !== '';
		case 'is_not_set':
			return actual === '';
	}
}

function property(
	flag: string,
	properties: Record<string, unknown> | undefined,
	name: string,
	options: EvaluateOptions
): string {
	if (properties && Object.hasOwn(properties, name)) return text(properties[name]);
	if (options.missing === 'inconclusive') {
		throw new InconclusiveError(flag, `property ${name} not given`);
	}
	return '';
}

function passes(
	flag: FlagDefinition,
	filter: FlagFilter,
	context: FlagContext,
	options: EvaluateOptions
): boolean {
	switch (filter.type) {
		case 'person':
			return matches(
				property(flag.key, context.personProperties, filter.property, options),
				filter
			);
		case 'group':
			return matches(
				property(flag.key, context.groupProperties?.[filter.groupType], filter.property, options),
				filter
			);
		case 'cohort':
			if (!context.cohorts) {
				throw new InconclusiveError(flag.key, `cohort membership not known`);
			}
			return context.cohorts.includes(filter.cohort);
	}
}

function variantFor(flag: FlagDefinition, id: string): string | undefined {
	const at = bucket(flag.key, id, '.variant');
	let edge = 0;
	for (const variant of flag.variants) {
		edge += variant.rollout / 100;
		if (at < edge) return variant.key;
	}
	return flag.variants.at(-1)?.key;
}

function result(flag: FlagDefinition, value: boolean | string, reason: FlagReason): FlagResult {
	const payload = value === false ? null : (flag.payloads[String(value)] ?? null);
	return { key: flag.key, value, payload, reason };
}

/**
 * Evaluates one flag for one person (or group). Throws `InconclusiveError` when the context
 * lacks cohort membership a condition needs, or, with `missing: 'inconclusive'`, a property.
 */
export function evaluate(
	flag: FlagDefinition,
	context: FlagContext,
	options: EvaluateOptions = {}
): FlagResult {
	if (!flag.active) return result(flag, false, 'inactive');
	const id = flag.groupType ? context.groups?.[flag.groupType] : context.distinctId;
	if (!id) return result(flag, false, 'no_group');
	let reason: FlagReason = 'no_match';
	for (const [index, condition] of flag.conditions.entries()) {
		if (!condition.filters.every((filter) => passes(flag, filter, context, options))) continue;
		if (bucket(flag.key, id) >= condition.rollout / 100) {
			reason = 'out_of_rollout';
			continue;
		}
		const value = flag.variants.length
			? (flag.variants.find((v) => v.key === condition.variant)?.key ?? variantFor(flag, id))
			: true;
		return { ...result(flag, value ?? false, 'match'), condition: index };
	}
	return result(flag, false, reason);
}

/**
 * Evaluates every flag, skipping ones that can't be decided from the context; their keys come
 * back in `inconclusive` so a caller evaluating locally knows to ask the server.
 */
export function evaluateAll(
	flags: FlagDefinition[],
	context: FlagContext,
	options: EvaluateOptions = {}
): { results: Record<string, FlagResult>; inconclusive: string[] } {
	const results: Record<string, FlagResult> = {};
	const inconclusive: string[] = [];
	for (const flag of flags) {
		try {
			results[flag.key] = evaluate(flag, context, options);
		} catch (error) {
			if (!(error instanceof InconclusiveError)) throw error;
			inconclusive.push(flag.key);
		}
	}
	return { results, inconclusive };
}
