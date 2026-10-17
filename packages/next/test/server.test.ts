// @vitest-environment node
import type { WireEvent } from '@tracemark/browser';
import { Tracemark } from '@tracemark/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOnRequestError, flagsBootstrap, tracemarkScope } from '../src/server';

const HOST = 'https://tracemark.example.com';
const STATE = JSON.stringify({ id: 'visitor-1', sid: 's' });
// What `cookies()` returns: names and decoded values.
const cookies = (entries: Record<string, string> = {}) => ({
	getAll: () => Object.entries(entries).map(([name, value]) => ({ name, value }))
});

const clients: Tracemark[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((c) => c.shutdown()));
});

function server() {
	const events: WireEvent[] = [];
	const flagRequests: Record<string, unknown>[] = [];
	const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
		const body = JSON.parse(String(init.body));
		if (url === `${HOST}/e`) events.push(...body.batch);
		if (url === `${HOST}/flags`) {
			flagRequests.push(body);
			return Response.json({ flags: { beta: true }, payloads: {} });
		}
		return Response.json({});
	});
	const client = new Tracemark({
		apiKey: 'fp_pub_test',
		host: HOST,
		fetch: fetch as unknown as typeof globalThis.fetch
	});
	clients.push(client);
	return { client, events, flagRequests };
}

describe('server helpers', () => {
	it('reads the visitor from cookies, or takes a signed-in id', () => {
		const { client } = server();
		expect(tracemarkScope(client, cookies({ fp_fp_pub_test: STATE, other: 'x' })).distinctId).toBe(
			'visitor-1'
		);
		expect(tracemarkScope(client, cookies(), 'user-7').distinctId).toBe('user-7');
		expect(tracemarkScope(client, cookies()).distinctId).toBeUndefined();
	});

	it('bootstraps flags for a known visitor only', async () => {
		const { client, flagRequests } = server();
		expect(await flagsBootstrap(client, cookies({ fp_fp_pub_test: STATE }))).toEqual({
			flags: { beta: true },
			payloads: {}
		});
		expect(await flagsBootstrap(client, cookies())).toBeUndefined();
		expect(flagRequests.map((r) => r.distinct_id)).toEqual(['visitor-1']);
	});

	it('captures request errors with the route and sends them right away', async () => {
		const { client, events } = server();
		const onRequestError = createOnRequestError(client);
		const error = Object.assign(new Error('db down'), { digest: '123' });
		await onRequestError(
			error,
			{
				path: '/cart?x=1',
				method: 'POST',
				headers: { cookie: `fp_fp_pub_test=${encodeURIComponent(STATE)}` }
			},
			{ routerKind: 'App Router', routePath: '/cart', routeType: 'action' }
		);
		const [captured] = events;
		expect(captured?.event).toBe('$exception');
		expect(captured?.distinct_id).toBe('visitor-1');
		expect(captured?.properties).toMatchObject({
			$request_path: '/cart?x=1',
			$request_method: 'POST',
			$next_route_path: '/cart',
			$next_route_type: 'action',
			$next_digest: '123'
		});
	});
});
