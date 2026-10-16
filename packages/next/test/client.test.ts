import { createClient, type FootprintClient, type WireEvent } from '@footprint/browser';
import { createErrors } from '@footprint/browser/errors';
import { useFeatureFlag } from '@footprint/react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FootprintNextProvider, useCaptureException } from '../src/index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST = 'https://footprint.example.com';
const options = { apiKey: 'fp_pub_test', host: HOST, autocapturePageviews: false };

let events: WireEvent[];
let answer: unknown;
let root: Root;
let container: HTMLElement;
const clients: FootprintClient[] = [];

beforeEach(() => {
	events = [];
	answer = { flags: { beta: 'b' }, payloads: {} };
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
	for (const cookie of document.cookie.split(';')) {
		// biome-ignore lint/suspicious/noDocumentCookie: clearing what the SDK set between tests
		document.cookie = `${cookie.split('=')[0]?.trim()}=; Max-Age=0; Path=/`;
	}
});

function client() {
	const c = createClient();
	clients.push(c);
	return c;
}

function Beta() {
	return createElement('p', null, String(useFeatureFlag('beta')));
}

describe('FootprintNextProvider', () => {
	it('keeps the visitor in a cookie, shows bootstrapped flags and identifies', async () => {
		const c = client();
		answer = new Promise(() => {});
		await act(async () =>
			root.render(
				createElement(
					FootprintNextProvider,
					{ client: c, options, bootstrap: { flags: { beta: 'a' } }, distinctId: 'user-7' },
					createElement(Beta)
				)
			)
		);
		expect(container.textContent).toBe('a');
		expect(c.config?.persistence).toBe('cookie');
		expect(c.getDistinctId()).toBe('user-7');
		expect(document.cookie).toContain('fp_fp_pub_test=');
	});

	it('captures what error pages show', async () => {
		const c = client();
		function ErrorPage({ error }: { error: Error & { digest?: string } }) {
			useCaptureException(error);
			return null;
		}
		const error = Object.assign(new Error('render failed'), { digest: 'abc' });
		await act(async () =>
			root.render(
				createElement(
					FootprintNextProvider,
					{ client: c, options, flags: false },
					createElement(ErrorPage, { error })
				)
			)
		);
		await act(() => c.flush());
		const captured = events.find((e) => e.event === '$exception');
		expect(captured?.properties).toMatchObject({ $next_digest: 'abc' });
	});

	it('takes the errors plugin directly in global-error pages', async () => {
		const c = client();
		c.init(options);
		const errors = createErrors({ autocapture: false });
		c.use(errors);
		function GlobalError({ error }: { error: Error }) {
			useCaptureException(error, errors);
			return null;
		}
		await act(async () => root.render(createElement(GlobalError, { error: new Error('layout') })));
		await act(() => c.flush());
		expect(events.some((e) => e.event === '$exception')).toBe(true);
	});
});
