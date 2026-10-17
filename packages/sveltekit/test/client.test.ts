import type { HandleClientError } from '@sveltejs/kit/hooks';
import { createClient, type WireEvent } from '@tracemark/browser';
import { createErrors } from '@tracemark/browser/errors';
import { describe, expect, it, vi } from 'vitest';
import { tracemarkClientHandleError } from '../src/index';

describe('client hook', () => {
	it('captures unexpected client errors', async () => {
		const sent: WireEvent[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: RequestInit) => {
				sent.push(...JSON.parse(String(init.body)).batch);
				return { ok: true, status: 202, json: async () => ({}) };
			})
		);
		const c = createClient();
		c.init({
			apiKey: 'fp_pub_test',
			host: 'https://tracemark.example.com',
			autocapturePageviews: false
		});
		const errors = createErrors({ autocapture: false });
		c.use(errors);
		const handleError: HandleClientError = tracemarkClientHandleError(errors);
		const navigation = { url: new URL('https://shop.example.com/') } as never;
		handleError({ kind: 'unknown', error: new Error('load failed'), event: navigation });
		handleError({
			kind: 'framework',
			error: { status: 404, message: 'Not Found' },
			event: navigation
		});
		await c.flush();
		const exceptions = sent.filter((e) => e.event === '$exception');
		expect(exceptions).toHaveLength(1);
		const [entry] = (exceptions[0]?.properties?.$exception_list ?? []) as { mechanism: unknown }[];
		expect(entry?.mechanism).toEqual({ type: 'sveltekit', handled: false });
		c.destroy();
	});
});
