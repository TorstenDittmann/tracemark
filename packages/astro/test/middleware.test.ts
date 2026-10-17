import { Tracemark, type TracemarkScope } from '@tracemark/node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flagsBootstrap, tracemarkMiddleware } from '../src/middleware';

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
		if (url === `${HOST}/flags`) return Response.json({ flags: { beta: true }, payloads: {} });
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

const context = (path: string, cookie?: string) => ({
	url: new URL(`https://shop.test${path}`),
	request: new Request(`https://shop.test${path}`, { headers: cookie ? { cookie } : {} }),
	locals: {} as { tracemark?: TracemarkScope }
});

describe('astro middleware', () => {
	it('scopes requests and captures rendering errors', async () => {
		const { client, events } = server();
		const middleware = tracemarkMiddleware(client);
		const ok = context('/pricing', COOKIE);
		await middleware(ok, async () => new Response('ok'));
		expect(ok.locals.tracemark?.distinctId).toBe('visitor-1');
		expect(await flagsBootstrap(ok)).toEqual({ flags: { beta: true }, payloads: {} });
		const anonymous = context('/pricing');
		await middleware(anonymous, async () => new Response('ok'));
		expect(await flagsBootstrap(anonymous)).toBeUndefined();

		await expect(
			middleware(context('/boom', COOKIE), async () => {
				throw new Error('kaput');
			})
		).rejects.toThrow('kaput');
		await client.flush();
		const [error] = events.filter((e) => e.event === '$exception') as {
			distinct_id: string;
			properties: Record<string, unknown> & { $exception_list: { mechanism: unknown }[] };
		}[];
		expect(error?.distinct_id).toBe('visitor-1');
		expect(error?.properties.$current_url).toBe('https://shop.test/boom');
		expect(error?.properties.$exception_list[0]?.mechanism).toEqual({
			type: 'astro',
			handled: false
		});
	});
});
