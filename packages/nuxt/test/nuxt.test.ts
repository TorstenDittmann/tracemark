import { Tracemark, type TracemarkScope } from '@tracemark/node';
import { H3, HTTPError } from 'h3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	flagsBootstrap,
	type TracemarkEvent,
	tracemarkErrorHook,
	tracemarkMiddleware
} from '../src';

const HOST = 'https://tracemark.example.com';
const COOKIE = `fp_fp_pub_test=${encodeURIComponent(JSON.stringify({ id: 'visitor-1', sid: 's' }))}`;

const clients: Tracemark[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((c) => c.shutdown()));
});

function server() {
	const events: Record<string, unknown>[] = [];
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

const exceptions = (events: Record<string, unknown>[]) =>
	events.filter((e) => e.event === '$exception') as {
		distinct_id: string;
		properties: Record<string, unknown> & {
			$exception_list: { value: string; mechanism: unknown }[];
		};
	}[];

describe('nuxt server helpers', () => {
	it('scope requests, bootstrap flags and capture errors with h3 2', async () => {
		const { client, events } = server();
		const hook = tracemarkErrorHook(client);
		const app = new H3({ onError: (error, event) => hook(error, { event }) });
		app.use(tracemarkMiddleware(client));
		app.get('/flags', async (event) => ({ bootstrap: (await flagsBootstrap(event)) ?? null }));
		app.get('/me', (event) => (event.context.tracemark as TracemarkScope).distinctId ?? 'nobody');
		app.get('/boom', () => {
			throw new Error('kaput');
		});
		app.get('/missing', () => {
			throw new HTTPError({ status: 404 });
		});
		const request = (path: string, headers: Record<string, string> = {}) =>
			app.fetch(new Request(`https://shop.test${path}`, { headers }));

		expect(await (await request('/flags', { cookie: COOKIE })).json()).toEqual({
			bootstrap: { flags: { beta: true }, payloads: { beta: { v: 1 } } }
		});
		expect(await (await request('/flags')).json()).toEqual({ bootstrap: null });
		expect(await (await request('/me')).text()).toBe('nobody');
		expect((await request('/missing')).status).toBe(404);
		expect((await request('/boom?x=1', { cookie: COOKIE })).status).toBe(500);
		await client.flush();

		const errors = exceptions(events);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.distinct_id).toBe('visitor-1');
		expect(errors[0]?.properties).toMatchObject({
			$current_url: 'https://shop.test/boom?x=1',
			$request_method: 'GET'
		});
		expect(errors[0]?.properties.$exception_list[0]).toMatchObject({
			value: 'kaput',
			mechanism: { type: 'nuxt', handled: false }
		});
	});

	it('read h3 1 events and a distinct id callback', async () => {
		const { client } = server();
		const event: TracemarkEvent = {
			context: {},
			path: '/pricing?plan=pro',
			method: 'POST',
			headers: new Headers({ host: 'shop.test', 'x-forwarded-proto': 'https', 'x-user': 'ada' })
		};
		tracemarkMiddleware(client, { distinctId: (e) => e.headers?.get('x-user') ?? undefined })(
			event
		);
		const scope = event.context.tracemark as TracemarkScope;
		expect(scope.distinctId).toBe('ada');
		expect(await flagsBootstrap(event)).toEqual({
			flags: { beta: true },
			payloads: { beta: { v: 1 } }
		});
		expect(await flagsBootstrap(undefined)).toBeUndefined();
	});
});
