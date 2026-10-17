import { describe, expect, it, vi } from 'vitest';
import { parseCatalog, priceCatalog } from './models-dev';

const catalog = {
	openai: {
		id: 'openai',
		models: {
			'gpt-4o': { id: 'gpt-4o', cost: { input: 2.5, output: 10, cache_read: 1.25 } },
			'gpt-image': { id: 'gpt-image' },
			'text-embedding-3-small': { id: 'text-embedding-3-small', cost: { input: 0.02, output: 0 } }
		}
	},
	anthropic: {
		models: {
			'claude-sonnet-4-5': {
				id: 'claude-sonnet-4-5',
				cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75, tiers: [] }
			}
		}
	},
	gateway: {
		models: {
			'openai/gpt-4o': { id: 'openai/gpt-4o', cost: { input: 3, output: 12 } },
			'meta/llama-3.3-70b': { id: 'meta/llama-3.3-70b', cost: { input: 0.6, output: 0.6 } },
			'one-off': { id: 'one-off', cost: { input: 1, output: 1 } },
			'free-model': { id: 'free-model', cost: { input: 0, output: 0 } }
		}
	},
	cloud: {
		models: {
			'Llama-3.3-70B': { id: 'Llama-3.3-70B', cost: { input: 0.6, output: 0.6 } },
			'free-model': { id: 'free-model', cost: { input: 0, output: 0 } }
		}
	},
	reseller: {
		models: { 'llama-3.3-70b': { id: 'llama-3.3-70b', cost: { input: 0.9, output: 0.9 } } }
	}
};

describe('models.dev catalog', () => {
	it('prefers first-party prices and needs two other providers to agree', () => {
		expect(parseCatalog(catalog)).toEqual([
			{ model: 'claude-sonnet-4-5', input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
			{ model: 'gpt-4o', input: 2.5, output: 10, cacheRead: 1.25 },
			{ model: 'llama-3.3-70b', input: 0.6, output: 0.6 },
			{ model: 'text-embedding-3-small', input: 0.02, output: 0 }
		]);
	});

	it('reads nothing from something that is not a catalog', () => {
		expect(parseCatalog(null)).toEqual([]);
		expect(parseCatalog({ openai: { models: 'x' } })).toEqual([]);
		expect(parseCatalog([1, 2])).toEqual([]);
	});

	it('serves the snapshot until a fetch succeeds, then refreshes when due', async () => {
		let time = 0;
		const snapshot = [{ model: 'old', input: 1, output: 1 }];
		const fetch = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue(new Response(JSON.stringify(catalog)));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const prices = priceCatalog({
			url: 'https://example.com/api.json',
			snapshot,
			fetch,
			now: () => time,
			refreshMs: 1000,
			retryMs: 100
		});

		expect(prices.prices()).toBe(snapshot);
		await prices.settled();
		expect(warn).toHaveBeenCalledOnce();
		expect(prices.prices()).toBe(snapshot);
		expect(fetch).toHaveBeenCalledTimes(1);

		time = 100;
		prices.prices();
		await prices.settled();
		expect(prices.prices().map((p) => p.model)).toContain('gpt-4o');
		expect(fetch).toHaveBeenCalledTimes(2);

		time = 1099;
		prices.prices();
		expect(fetch).toHaveBeenCalledTimes(2);
		time = 1100;
		prices.prices();
		await prices.settled();
		expect(fetch).toHaveBeenCalledTimes(3);
		warn.mockRestore();
	});

	it('keeps the snapshot when the catalog is unusable or disabled', async () => {
		const snapshot = [{ model: 'old', input: 1, output: 1 }];
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fetch = vi.fn().mockResolvedValue(new Response('{}'));
		const bad = priceCatalog({ url: 'https://example.com/api.json', snapshot, fetch });
		bad.prices();
		await bad.settled();
		expect(bad.prices()).toBe(snapshot);

		const off = priceCatalog({ url: '', snapshot, fetch });
		expect(off.prices()).toBe(snapshot);
		expect(fetch).toHaveBeenCalledTimes(1);
		warn.mockRestore();
	});
});
