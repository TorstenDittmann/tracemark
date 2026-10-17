// A project's model prices: the built-in list with the project's own overrides on top.
import { and, eq } from 'drizzle-orm';
import { type ModelPrice, normalizeModel } from '../ai-prices';
import { builtInPrices } from './builtin-prices';
import type { Db } from './db/client';
import { aiModelPrices } from './db/schema';

export interface EffectivePrice extends ModelPrice {
	/** Set by the project rather than built in. */
	custom: boolean;
}

/** Every price the project's events are costed with, sorted by model. */
export async function modelPrices(db: Db, projectId: string): Promise<EffectivePrice[]> {
	const own = await db.select().from(aiModelPrices).where(eq(aiModelPrices.projectId, projectId));
	const prices = new Map<string, EffectivePrice>(
		builtInPrices().map((price) => [price.model, { ...price, custom: false }])
	);
	for (const row of own) {
		prices.set(row.model, {
			model: row.model,
			input: row.input,
			output: row.output,
			cacheRead: row.cacheRead ?? undefined,
			cacheWrite: row.cacheWrite ?? undefined,
			custom: true
		});
	}
	return [...prices.values()].sort((a, b) => a.model.localeCompare(b.model));
}

const MAX_PRICE = 10_000;

/** Reads a price from a form; a message says what is wrong. */
export function parsePriceForm(form: FormData): ModelPrice | string {
	const model = normalizeModel(String(form.get('model') ?? ''));
	if (!model || model.length > 100 || /\s/.test(model)) {
		return 'Enter a model name without spaces, such as gpt-4o.';
	}
	const read = (key: string, optional: boolean): number | undefined | null => {
		const text = String(form.get(key) ?? '').trim();
		if (!text) return optional ? undefined : null;
		const value = Number(text);
		return Number.isFinite(value) && value >= 0 && value <= MAX_PRICE ? value : null;
	};
	const input = read('input', false);
	const output = read('output', false);
	const cacheRead = read('cacheRead', true);
	const cacheWrite = read('cacheWrite', true);
	if ([input, output, cacheRead, cacheWrite].includes(null)) {
		return `Prices are USD per million tokens, from 0 to ${MAX_PRICE}.`;
	}
	return {
		model,
		input: input as number,
		output: output as number,
		cacheRead: cacheRead ?? undefined,
		cacheWrite: cacheWrite ?? undefined
	};
}

export async function setModelPrice(
	db: Db,
	projectId: string,
	price: ModelPrice,
	now = new Date()
) {
	const values = {
		input: price.input,
		output: price.output,
		cacheRead: price.cacheRead ?? null,
		cacheWrite: price.cacheWrite ?? null,
		updatedAt: now
	};
	await db
		.insert(aiModelPrices)
		.values({ projectId, model: normalizeModel(price.model), ...values })
		.onConflictDoUpdate({ target: [aiModelPrices.projectId, aiModelPrices.model], set: values });
}

/** Removes the project's own price, so the built-in one (if any) applies again. */
export async function deleteModelPrice(db: Db, projectId: string, model: string) {
	await db
		.delete(aiModelPrices)
		.where(
			and(eq(aiModelPrices.projectId, projectId), eq(aiModelPrices.model, normalizeModel(model)))
		);
}
