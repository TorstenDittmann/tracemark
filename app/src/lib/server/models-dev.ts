// Built-in model prices from models.dev's catalog (https://models.dev/api.json). A snapshot ships
// with the app for offline instances; `priceCatalog` refetches the catalog in the background so new
// models and price changes arrive without a release.
import { type ModelPrice, normalizeModel } from '../ai-prices';

export const MODELS_DEV_URL = 'https://models.dev/api.json';

/**
 * Providers that sell their own models, in the order their prices win. Other providers (gateways,
 * clouds, resellers) only price models none of these list, and only where two of them agree, so a
 * markup or a promotion of one reseller doesn't become the price.
 */
const FIRST_PARTY = [
	'anthropic',
	'openai',
	'google',
	'mistral',
	'deepseek',
	'xai',
	'cohere',
	'moonshotai',
	'alibaba',
	'zai',
	'minimax',
	'perplexity',
	'meta',
	'nova'
];

interface Cost {
	input?: unknown;
	output?: unknown;
	cache_read?: unknown;
	cache_write?: unknown;
}

const amount = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

function price(model: string, cost: Cost | undefined): ModelPrice | undefined {
	const input = amount(cost?.input);
	const output = amount(cost?.output);
	if (input === undefined || output === undefined) return undefined;
	const result: ModelPrice = { model, input, output };
	const cacheRead = amount(cost?.cache_read);
	const cacheWrite = amount(cost?.cache_write);
	if (cacheRead !== undefined) result.cacheRead = cacheRead;
	if (cacheWrite !== undefined) result.cacheWrite = cacheWrite;
	return result;
}

/** Models of a provider in the catalog, as [name, cost] pairs. */
function models(catalog: Record<string, unknown>, provider: string): [string, Cost | undefined][] {
	const entry = catalog[provider] as { models?: Record<string, { id?: string; cost?: Cost }> };
	if (!entry || typeof entry.models !== 'object' || entry.models === null) return [];
	return Object.entries(entry.models).map(([id, model]) => [
		normalizeModel(typeof model?.id === 'string' ? model.id : id),
		model?.cost
	]);
}

/** Token prices from models.dev's api.json, sorted by model; empty when it isn't a catalog. */
export function parseCatalog(catalog: unknown): ModelPrice[] {
	if (typeof catalog !== 'object' || catalog === null) return [];
	const data = catalog as Record<string, unknown>;
	const prices = new Map<string, ModelPrice>();
	for (const provider of FIRST_PARTY) {
		for (const [model, cost] of models(data, provider)) {
			const found = price(model, cost);
			if (model && found && !prices.has(model)) prices.set(model, found);
		}
	}

	const votes = new Map<string, Map<string, { price: ModelPrice; count: number }>>();
	for (const provider of Object.keys(data)) {
		if (FIRST_PARTY.includes(provider)) continue;
		for (const [model, cost] of models(data, provider)) {
			const found = price(model, cost);
			// Gateways list some models for free; that's their offer, not the model's price.
			if (!model || !found || prices.has(model) || (found.input === 0 && found.output === 0)) {
				continue;
			}
			const key = JSON.stringify([found.input, found.output, found.cacheRead, found.cacheWrite]);
			const byPrice = votes.get(model) ?? new Map();
			const vote = byPrice.get(key) ?? { price: found, count: 0 };
			vote.count++;
			byPrice.set(key, vote);
			votes.set(model, byPrice);
		}
	}
	for (const [model, byPrice] of votes) {
		const best = [...byPrice.values()].sort((a, b) => b.count - a.count)[0];
		if (best && best.count >= 2) prices.set(model, best.price);
	}
	return [...prices.values()].sort((a, b) => a.model.localeCompare(b.model));
}

export interface CatalogOptions {
	/** Where to fetch the catalog; empty to keep the snapshot. */
	url: string;
	snapshot: ModelPrice[];
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	now?: () => number;
	/** How long fetched prices are kept before fetching again. */
	refreshMs?: number;
	/** How long to wait after a failed fetch. */
	retryMs?: number;
}

/**
 * The built-in prices: the snapshot until a fetch succeeds, then the latest catalog. Reading the
 * prices starts a fetch in the background when they are due, and a failed fetch keeps what is there.
 */
export function priceCatalog({
	url,
	snapshot,
	fetch: fetchFn = fetch,
	now = Date.now,
	refreshMs = 24 * 60 * 60 * 1000,
	retryMs = 60 * 60 * 1000
}: CatalogOptions) {
	let prices = snapshot;
	let dueAt = 0;
	let pending: Promise<void> | undefined;

	async function refresh() {
		try {
			const response = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const fetched = parseCatalog(await response.json());
			if (fetched.length === 0) throw new Error('no prices in the catalog');
			prices = fetched;
			dueAt = now() + refreshMs;
		} catch (error) {
			console.warn(`Could not fetch model prices from ${url}; keeping the current ones.`, error);
			dueAt = now() + retryMs;
		}
	}

	return {
		prices(): ModelPrice[] {
			if (url && !pending && now() >= dueAt) {
				pending = refresh().finally(() => {
					pending = undefined;
				});
			}
			return prices;
		},
		/** Resolves when the fetch in progress, if any, is done. */
		settled: () => pending ?? Promise.resolve()
	};
}
