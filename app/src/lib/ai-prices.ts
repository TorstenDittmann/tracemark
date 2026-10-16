// Token prices ingest uses to compute `$ai_cost_usd`, in USD per million tokens. A model matches
// the entry with its exact name, else the longest entry its name starts with, so `gpt-4o` covers
// `gpt-4o-2024-08-06` while `gpt-4o-mini` keeps its own price. Projects override these in
// Settings; providers change prices, so check theirs before relying on the totals.

export interface ModelPrice {
	model: string;
	input: number;
	output: number;
	/** Cached input tokens read. Defaults to the input price. */
	cacheRead?: number;
	/** Input tokens written to the cache. Defaults to the input price. */
	cacheWrite?: number;
}

/** When the list below was last checked against the providers' price pages. */
export const PRICES_CHECKED = '2026-10';

const anthropic = (model: string, input: number, output: number): ModelPrice => ({
	model,
	input,
	output,
	cacheRead: input / 10,
	cacheWrite: input * 1.25
});

export const DEFAULT_PRICES: ModelPrice[] = [
	// Anthropic: cache reads cost a tenth of input, 5-minute cache writes a quarter more.
	anthropic('claude-opus-4-5', 5, 25),
	anthropic('claude-opus-4-1', 15, 75),
	anthropic('claude-opus-4', 15, 75),
	anthropic('claude-sonnet-4-5', 3, 15),
	anthropic('claude-sonnet-4', 3, 15),
	anthropic('claude-3-7-sonnet', 3, 15),
	anthropic('claude-haiku-4-5', 1, 5),
	anthropic('claude-3-5-haiku', 0.8, 4),
	anthropic('claude-3-haiku', 0.25, 1.25),
	// OpenAI: cached input is discounted; there is no separate write price.
	{ model: 'gpt-5', input: 1.25, output: 10, cacheRead: 0.125 },
	{ model: 'gpt-5-mini', input: 0.25, output: 2, cacheRead: 0.025 },
	{ model: 'gpt-5-nano', input: 0.05, output: 0.4, cacheRead: 0.005 },
	{ model: 'gpt-4.1', input: 2, output: 8, cacheRead: 0.5 },
	{ model: 'gpt-4.1-mini', input: 0.4, output: 1.6, cacheRead: 0.1 },
	{ model: 'gpt-4.1-nano', input: 0.1, output: 0.4, cacheRead: 0.025 },
	{ model: 'gpt-4o', input: 2.5, output: 10, cacheRead: 1.25 },
	{ model: 'gpt-4o-mini', input: 0.15, output: 0.6, cacheRead: 0.075 },
	{ model: 'o3', input: 2, output: 8, cacheRead: 0.5 },
	{ model: 'o3-mini', input: 1.1, output: 4.4, cacheRead: 0.55 },
	{ model: 'o4-mini', input: 1.1, output: 4.4, cacheRead: 0.275 },
	{ model: 'text-embedding-3-small', input: 0.02, output: 0 },
	{ model: 'text-embedding-3-large', input: 0.13, output: 0 },
	// Google: prices for prompts up to 200k tokens.
	{ model: 'gemini-2.5-pro', input: 1.25, output: 10, cacheRead: 0.31 },
	{ model: 'gemini-2.5-flash', input: 0.3, output: 2.5, cacheRead: 0.075 },
	{ model: 'gemini-2.5-flash-lite', input: 0.1, output: 0.4, cacheRead: 0.025 },
	{ model: 'gemini-2.0-flash', input: 0.1, output: 0.4, cacheRead: 0.025 }
];

/** A model name as prices are looked up: lowercase, without a `provider/` prefix. */
export function normalizeModel(model: string): string {
	const name = model.trim().toLowerCase();
	const slash = name.lastIndexOf('/');
	return slash === -1 ? name : name.slice(slash + 1);
}
