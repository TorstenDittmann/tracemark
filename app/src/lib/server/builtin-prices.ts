// The instance's built-in model prices, see models-dev.ts.
import { MODEL_PRICES_URL } from '$app/env/private';
import type { ModelPrice } from '../ai-prices';
import snapshot from './model-prices.json';
import { priceCatalog } from './models-dev';

const catalog = priceCatalog({
	url: MODEL_PRICES_URL === 'off' ? '' : MODEL_PRICES_URL,
	snapshot: snapshot.prices
});

/** Prices every project starts from, before its own overrides. */
export const builtInPrices = (): ModelPrice[] => catalog.prices();
