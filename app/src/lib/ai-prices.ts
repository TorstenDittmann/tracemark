// Token prices ingest uses to compute `$ai_cost_usd`, in USD per million tokens. A model matches
// the entry with its exact name, else the longest entry its name starts with, so `gpt-4o` covers
// `gpt-4o-2024-08-06` while `gpt-4o-mini` keeps its own price. The built-in prices come from
// models.dev (see server/models-dev.ts); projects override them in Settings.

export interface ModelPrice {
	model: string;
	input: number;
	output: number;
	/** Cached input tokens read. Defaults to the input price. */
	cacheRead?: number;
	/** Input tokens written to the cache. Defaults to the input price. */
	cacheWrite?: number;
}

/** A model name as prices are looked up: lowercase, without a `provider/` prefix. */
export function normalizeModel(model: string): string {
	const name = model.trim().toLowerCase();
	const slash = name.lastIndexOf('/');
	return slash === -1 ? name : name.slice(slash + 1);
}
