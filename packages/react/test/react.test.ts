import { createClient, type FootprintClient, type WireEvent } from '@footprint/browser';
import { createFlags } from '@footprint/browser/flags';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	FootprintProvider,
	useFeatureFlag,
	useFeatureFlagEnabled,
	useFeatureFlagPayload,
	useFlags,
	useFootprint
} from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = 'https://ingest.example.com';
const options = { apiKey: 'fp_pub_test', host: HOST, autocapturePageviews: false };

let answer: unknown;
let events: WireEvent[];
let root: Root;
let container: HTMLElement;
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
	container = document.createElement('div');
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
	for (const client of clients.splice(0)) client.destroy();
	localStorage.clear();
});

function client() {
	const c = createClient();
	clients.push(c);
	return c;
}

async function render(node: ReactNode) {
	await act(async () => root.render(node));
}

function Pricing() {
	const variant = useFeatureFlag('pricing');
	const payload = useFeatureFlagPayload<{ price: number }>('pricing');
	const beta = useFeatureFlagEnabled('beta');
	const missing = useFeatureFlagEnabled('missing');
	return createElement(
		'p',
		null,
		`${variant} ${payload?.price ?? '-'} ${beta ? 'beta' : 'stable'} ${missing}`
	);
}

describe('react bindings', () => {
	it('initializes the client, adds the flags and renders their values', async () => {
		const c = client();
		const flags = createFlags();
		await render(
			createElement(FootprintProvider, { client: c, options, flags }, createElement(Pricing))
		);
		expect(c.config?.apiKey).toBe('fp_pub_test');
		await act(() => flags.ready());
		expect(container.textContent).toBe('cheaper 9 beta false');
	});

	it('shows the bootstrap first and re-renders when flags change', async () => {
		const c = client();
		const flags = createFlags({ bootstrap: { flags: { pricing: 'control' } } });
		answer = new Promise(() => {});
		await render(
			createElement(FootprintProvider, { client: c, options, flags }, createElement(Pricing))
		);
		expect(container.textContent).toBe('control - stable false');

		answer = { flags: { pricing: 'cheaper' }, payloads: { pricing: { price: 5 } } };
		await act(() => flags.reload());
		expect(container.textContent).toBe('cheaper 5 stable false');
	});

	it('records one exposure per value shown', async () => {
		const c = client();
		const flags = createFlags();
		await render(
			createElement(FootprintProvider, { client: c, options, flags }, createElement(Pricing))
		);
		await act(() => flags.ready());
		await render(
			createElement(FootprintProvider, { client: c, options, flags }, createElement(Pricing))
		);
		await act(() => c.flush());
		const exposures = events
			.filter((e) => e.event === '$feature_flag_called')
			.map((e) => [e.properties?.$feature_flag, e.properties?.$feature_flag_response]);
		// Nothing is recorded for the placeholder `false` shown before the answer arrived.
		expect(exposures.sort()).toEqual(
			[
				['beta', true],
				['missing', false],
				['pricing', 'cheaper']
			].sort()
		);
	});

	it('gives components the client', async () => {
		const c = client();
		let seen: FootprintClient | undefined;
		function Probe() {
			seen = useFootprint();
			return null;
		}
		await render(createElement(FootprintProvider, { client: c }, createElement(Probe)));
		expect(seen).toBe(c);
	});

	it('explains a missing flags plugin', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		function Probe() {
			useFlags();
			return null;
		}
		await expect(
			render(createElement(FootprintProvider, { client: client() }, createElement(Probe)))
		).rejects.toThrow('pass `flags`');
	});
});
