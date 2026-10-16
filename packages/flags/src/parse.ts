import {
	type FlagCondition,
	type FlagDefinition,
	type FlagFilter,
	type FlagVariant,
	OPERATORS,
	type Operator
} from './flags';

export const KEY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export const MAX_CONDITIONS = 20;
export const MAX_FILTERS = 20;
export const MAX_VARIANTS = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isName = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 200;

const isPercent = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;

function filter(raw: unknown, at: string): FlagFilter {
	if (!isRecord(raw)) throw new Error(`${at} is not an object`);
	if (raw.type === 'cohort') {
		if (!isName(raw.cohort)) throw new Error(`${at} needs a cohort`);
		return { type: 'cohort', cohort: raw.cohort };
	}
	if (raw.type !== 'person' && raw.type !== 'group') throw new Error(`${at} has an unknown type`);
	if (!isName(raw.property)) throw new Error(`${at} needs a property`);
	if (!OPERATORS.includes(raw.operator as Operator))
		throw new Error(`${at} has an unknown operator`);
	const operator = raw.operator as Operator;
	let match: FlagFilter;
	if (operator === 'is_set' || operator === 'is_not_set') {
		match = { type: 'person', property: raw.property, operator };
	} else {
		if (typeof raw.value !== 'string' || raw.value.length > 1000) {
			throw new Error(`${at} needs a value`);
		}
		match = { type: 'person', property: raw.property, operator, value: raw.value };
	}
	if (raw.type === 'person') return match;
	if (!isName(raw.groupType)) throw new Error(`${at} needs a group type`);
	return { ...match, type: 'group', groupType: raw.groupType };
}

/**
 * Checks a flag definition from an untrusted source (a form, an API response) and returns it
 * in canonical shape. Throws with a readable message when it isn't valid.
 */
export function parseFlag(input: unknown): FlagDefinition {
	if (!isRecord(input)) throw new Error('A flag must be an object');
	if (typeof input.key !== 'string' || !KEY.test(input.key)) {
		throw new Error('A flag key is letters, digits, dots, dashes and underscores');
	}
	const key = input.key;
	if (input.groupType !== undefined && !isName(input.groupType)) {
		throw new Error(`${key}: the group type must be a name`);
	}

	const rawVariants = Array.isArray(input.variants) ? input.variants : [];
	if (rawVariants.length > MAX_VARIANTS)
		throw new Error(`${key}: at most ${MAX_VARIANTS} variants`);
	const variants: FlagVariant[] = rawVariants.map((raw, i) => {
		if (!isRecord(raw) || typeof raw.key !== 'string' || !KEY.test(raw.key)) {
			throw new Error(`${key}: variant ${i + 1} needs a key`);
		}
		if (!isPercent(raw.rollout)) throw new Error(`${key}: variant ${raw.key} needs a percent`);
		return { key: raw.key, rollout: raw.rollout };
	});
	if (new Set(variants.map((v) => v.key)).size !== variants.length) {
		throw new Error(`${key}: variant keys must be unique`);
	}
	if (variants.length) {
		const total = variants.reduce((sum, v) => sum + v.rollout, 0);
		if (Math.abs(total - 100) > 0.001) throw new Error(`${key}: variants must add up to 100%`);
	}

	const rawConditions = Array.isArray(input.conditions) ? input.conditions : [];
	if (rawConditions.length > MAX_CONDITIONS) {
		throw new Error(`${key}: at most ${MAX_CONDITIONS} conditions`);
	}
	const conditions: FlagCondition[] = rawConditions.map((raw, i) => {
		const at = `${key}: condition ${i + 1}`;
		if (!isRecord(raw)) throw new Error(`${at} is not an object`);
		if (!isPercent(raw.rollout)) throw new Error(`${at} needs a rollout percent`);
		const filters = Array.isArray(raw.filters) ? raw.filters : [];
		if (filters.length > MAX_FILTERS) throw new Error(`${at} has more than ${MAX_FILTERS} filters`);
		const condition: FlagCondition = {
			filters: filters.map((f, j) => filter(f, `${at}, filter ${j + 1}`)),
			rollout: raw.rollout
		};
		if (raw.variant !== undefined && raw.variant !== null && raw.variant !== '') {
			if (!variants.some((v) => v.key === raw.variant)) {
				throw new Error(`${at} serves a variant the flag doesn't have`);
			}
			condition.variant = raw.variant as string;
		}
		return condition;
	});

	const payloads: Record<string, unknown> = {};
	const allowed = variants.length ? variants.map((v) => v.key) : ['true'];
	for (const [name, value] of Object.entries(isRecord(input.payloads) ? input.payloads : {})) {
		if (!allowed.includes(name))
			throw new Error(`${key}: a payload for ${name} has no value to go with`);
		if (value !== undefined) payloads[name] = value;
	}

	const flag: FlagDefinition = {
		key,
		active: input.active === true,
		conditions,
		variants,
		payloads
	};
	if (input.groupType !== undefined) flag.groupType = input.groupType as string;
	return flag;
}
