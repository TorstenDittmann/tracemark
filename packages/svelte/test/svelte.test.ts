import { createClient, type FootprintClient, type WireEvent } from '@footprint/browser';
import { createErrors } from '@footprint/browser/errors';
import { createFlags } from '@footprint/browser/flags';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	allFlags,
	boundaryError,
	featureFlag,
	featureFlagEnabled,
	featureFlagPayload
} from '../src/index';

const HOST = 'https://ingest.example.com';
const options = { apiKey: 'fp_pub_test', host: HOST, autocapturePageviews: false };

let answer: unknown;
let events: WireEvent[];
const clients: FootprintClient[] = [];

beforeEach(() => {
	answer = { flags: { pricing: 'cheaper', beta: true }, payloads: { pricing: { price: 9 } } };
	events = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			if (url === `${HOST}/flags`) return { ok: true, status: 200, json: async () => answer };
			events.push(...body.batch);
			return { ok: true, status: 202, json: async () => ({}) };
		})
	);
});

afterEach(() => {
	for (const client of clients.splice(0)) client.destroy();
	localStorage.clear();
});

function setup(bootstrap?: { flags: Record<string, string | boolean> }) {
	const client = createClient(options);
	clients.push(client);
	const flags = createFlags({ bootstrap });
	client.use(flags);
	return { client, flags };
}

describe('svelte stores', () => {
	it('follow the flags as they load and change', async () => {
		const { flags } = setup({ flags: { pricing: 'control' } });
		const values: unknown[] = [];
		const stop = featureFlag(flags, 'pricing').subscribe((value) => values.push(value));
		expect(values).toEqual(['control']);
		await flags.ready();
		answer = { flags: { pricing: 'other' } };
		await flags.reload();
		stop();
		expect(values).toEqual(['control', 'cheaper', 'other']);
	});

	it('derive enabled and payload', async () => {
		const { flags } = setup();
		await flags.ready();
		expect(get(featureFlagEnabled(flags, 'beta'))).toBe(true);
		expect(get(featureFlagEnabled(flags, 'missing'))).toBe(false);
		expect(get(featureFlagPayload<{ price: number }>(flags, 'pricing'))).toEqual({ price: 9 });
		expect(get(featureFlagPayload(flags, 'missing'))).toBeUndefined();
		expect(get(allFlags(flags))).toEqual({ pricing: 'cheaper', beta: true });
	});

	it('record exposures only while subscribed, once per value', async () => {
		const { client, flags } = setup();
		await flags.ready();
		const unused = allFlags(flags);
		get(unused);
		const stop = featureFlag(flags, 'pricing').subscribe(() => {});
		featureFlag(flags, 'pricing').subscribe(() => {})();
		await flags.ready();
		stop();
		await client.flush();
		expect(
			events
				.filter((e) => e.event === '$feature_flag_called')
				.map((e) => [e.properties?.$feature_flag, e.properties?.$feature_flag_response])
		).toEqual([['pricing', 'cheaper']]);
	});

	it('record nothing for the placeholder before flags load', async () => {
		const { client, flags } = setup();
		const stop = featureFlag(flags, 'pricing').subscribe(() => {});
		await flags.ready();
		await Promise.resolve();
		stop();
		await client.flush();
		expect(
			events
				.filter((e) => e.event === '$feature_flag_called')
				.map((e) => e.properties?.$feature_flag_response)
		).toEqual(['cheaper']);
	});
});

describe('boundary errors', () => {
	it('captures the error and passes it on', async () => {
		const c = createClient();
		c.init({ apiKey: 'fp_pub_test', host: HOST, autocapturePageviews: false });
		const errors = createErrors({ autocapture: false });
		c.use(errors);
		const then = vi.fn();
		const reset = () => {};
		boundaryError(errors, then)(new Error('render failed'), reset);
		await c.flush();
		const exception = events.find((e) => e.event === '$exception');
		const [entry] = (exception?.properties?.$exception_list ?? []) as { mechanism: unknown }[];
		expect(entry?.mechanism).toEqual({ type: 'svelte-boundary', handled: false });
		expect(then).toHaveBeenCalledWith(expect.any(Error), reset);
		c.destroy();
	});
});
