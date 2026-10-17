// @vitest-environment node

import type { RequestEvent } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import type { WireEvent } from '@tracemark/browser';
import { Tracemark } from '@tracemark/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flagsBootstrap, tracemarkHandle, tracemarkHandleError } from '../src/server';

const HOST = 'https://tracemark.example.com';
const COOKIE = `fp_fp_pub_test=${encodeURIComponent(JSON.stringify({ id: 'visitor-1', sid: 's' }))}`;

const clients: Tracemark[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((c) => c.shutdown()));
});

function server() {
	const events: WireEvent[] = [];
	const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
		const body = JSON.parse(String(init.body));
		if (url === `${HOST}/e`) events.push(...body.batch);
		if (url === `${HOST}/flags`)
			return Response.json({ flags: { beta: true }, payloads: { beta: { v: 1 } } });
		return Response.json({});
	});
	const client = new Tracemark({
		apiKey: 'fp_pub_test',
		host: HOST,
		fetch: fetch as unknown as typeof globalThis.fetch
	});
	clients.push(client);
	return { client, events };
}

const event = (path: string, cookie?: string) =>
	({
		url: new URL(`https://shop.example.com${path}`),
		request: new Request(`https://shop.example.com${path}`, {
			headers: cookie ? { cookie } : {}
		}),
		locals: {}
	}) as unknown as RequestEvent;

const scopeOf = (e: RequestEvent) =>
	(e.locals as { tracemark?: { distinctId?: string } }).tracemark;

describe('server hooks', () => {
	it('fit SvelteKit hook types', () => {
		const { client } = server();
		const handle: Handle = tracemarkHandle(client);
		const handleError: HandleServerError = tracemarkHandleError(client, () => ({
			message: 'Something broke'
		}));
		expect([typeof handle, typeof handleError]).toEqual(['function', 'function']);
	});

	it('gives each request its visitor scope and bootstraps their flags', async () => {
		const { client } = server();
		const handle = tracemarkHandle(client);
		const e = event('/pricing', COOKIE);
		await handle({ event: e, resolve: async () => new Response('ok') });
		expect(scopeOf(e)?.distinctId).toBe('visitor-1');
		expect(await flagsBootstrap(e)).toEqual({
			flags: { beta: true },
			payloads: { beta: { v: 1 } }
		});

		const anonymous = event('/');
		await handle({ event: anonymous, resolve: async () => new Response('ok') });
		expect(await flagsBootstrap(anonymous)).toBeUndefined();
	});

	it('takes the distinct id from a callback', async () => {
		const { client } = server();
		const e = event('/');
		await tracemarkHandle(client, { distinctId: () => 'user-7' })({
			event: e,
			resolve: async () => new Response('ok')
		});
		expect(scopeOf(e)?.distinctId).toBe('user-7');
	});

	it('captures unexpected errors only, in SvelteKit 3 and 2', async () => {
		const { client, events } = server();
		const handleError = tracemarkHandleError(client, () => ({ message: 'oh no' }));
		const cart = event('/cart', COOKIE);
		// SvelteKit 3
		expect(handleError({ kind: 'unknown', error: new Error('db down'), event: cart })).toEqual({
			message: 'oh no'
		});
		handleError({ kind: 'framework', error: { status: 404, message: 'Not Found' }, event: cart });
		handleError({ kind: 'app', error: { message: 'Not allowed' }, event: cart });
		// SvelteKit 2
		handleError({
			error: new Error('timeout'),
			event: cart,
			status: 500,
			message: 'Internal Error'
		});
		handleError({ error: new Error('missing'), event: cart, status: 404, message: 'Not Found' });
		await client.flush();

		const exceptions = events.filter((e) => e.event === '$exception');
		expect(exceptions.map((e) => [e.distinct_id, e.properties?.$http_status])).toEqual([
			['visitor-1', undefined],
			['visitor-1', 500]
		]);
		expect(exceptions[0]?.properties).toMatchObject({
			$current_url: 'https://shop.example.com/cart',
			$request_method: 'GET'
		});
	});
});
