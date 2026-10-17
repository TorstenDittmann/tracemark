import { createClient, type TracemarkClient, type WireEvent } from '@tracemark/browser';
import { createErrors } from '@tracemark/browser/errors';
import { createFlags } from '@tracemark/browser/flags';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	reactErrorHandler,
	TracemarkErrorBoundary,
	TracemarkProvider,
	useFeatureFlag,
	useFeatureFlagEnabled,
	useFeatureFlagPayload,
	useFlags,
	useTracemark
} from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = 'https://ingest.example.com';
const options = { apiKey: 'fp_pub_test', host: HOST, autocapturePageviews: false };

let answer: unknown;
let events: WireEvent[];
let root: Root;
let container: HTMLElement;
const clients: TracemarkClient[] = [];

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
			createElement(TracemarkProvider, { client: c, options, flags }, createElement(Pricing))
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
			createElement(TracemarkProvider, { client: c, options, flags }, createElement(Pricing))
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
			createElement(TracemarkProvider, { client: c, options, flags }, createElement(Pricing))
		);
		await act(() => flags.ready());
		await render(
			createElement(TracemarkProvider, { client: c, options, flags }, createElement(Pricing))
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
		let seen: TracemarkClient | undefined;
		function Probe() {
			seen = useTracemark();
			return null;
		}
		await render(createElement(TracemarkProvider, { client: c }, createElement(Probe)));
		expect(seen).toBe(c);
	});

	it('explains a missing flags plugin', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		function Probe() {
			useFlags();
			return null;
		}
		await expect(
			render(createElement(TracemarkProvider, { client: client() }, createElement(Probe)))
		).rejects.toThrow('pass `flags`');
	});
});

describe('error boundary', () => {
	function Broken(): never {
		throw new TypeError('cart is undefined');
	}

	const exceptions = () =>
		events
			.filter((e) => e.event === '$exception')
			.map(
				(e) =>
					e.properties as Record<string, unknown> & {
						$exception_list: { value: string; mechanism: unknown }[];
					}
			);

	it('captures render errors and shows the fallback', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const c = client();
		const errors = createErrors({ autocapture: false });
		let reset: (() => void) | undefined;
		await render(
			createElement(
				TracemarkProvider,
				{ client: c, options, errors },
				createElement(
					TracemarkErrorBoundary,
					{
						fallback: (props: { error: unknown; reset: () => void }) => {
							reset = props.reset;
							return createElement('p', null, `failed: ${(props.error as Error).message}`);
						}
					},
					createElement(Broken)
				)
			)
		);
		expect(container.textContent).toBe('failed: cart is undefined');
		await act(() => c.flush());
		const [captured] = exceptions();
		expect(captured?.$exception_list[0]).toMatchObject({
			value: 'cart is undefined',
			mechanism: { type: 'react-error-boundary', handled: false }
		});
		expect(captured?.$react_component_stack).toContain('Broken');
		expect(typeof reset).toBe('function');
	});

	it('warns when there is no errors plugin', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await render(
			createElement(
				TracemarkProvider,
				{ client: client(), options },
				createElement(TracemarkErrorBoundary, { fallback: 'oops' }, createElement(Broken))
			)
		);
		expect(container.textContent).toBe('oops');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('pass `errors`'));
	});

	it('captures root errors for createRoot options', async () => {
		const c = client();
		c.init(options);
		const errors = createErrors({ autocapture: false });
		c.use(errors);
		const then = vi.fn();
		reactErrorHandler(errors, then)(new Error('root'), { componentStack: '\n    at App' });
		await act(() => c.flush());
		expect(exceptions()[0]).toMatchObject({ $react_component_stack: '\n    at App' });
		expect(then).toHaveBeenCalled();
	});
});
