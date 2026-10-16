import type { AddressInfo } from 'node:net';
import express from 'express';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Footprint } from '../src';
import { footprint as expressFootprint, footprintErrorHandler } from '../src/express';
import { getFootprint, footprint as honoFootprint } from '../src/hono';

const HOST = 'https://footprint.example.com';
const COOKIE = `fp_fp_pub_test=${encodeURIComponent(JSON.stringify({ id: 'visitor-1', sid: 's' }))}`;

function setup() {
	const events: Record<string, unknown>[] = [];
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
	const client = new Footprint({
		apiKey: 'fp_pub_test',
		host: HOST,
		fetch: fetch as unknown as typeof globalThis.fetch,
		release: '1.0.0'
	});
	clients.push(client);
	return { client, events, flagRequests };
}

const clients: Footprint[] = [];
afterEach(async () => {
	await Promise.all(clients.splice(0).map((c) => c.shutdown()));
});

const exceptions = (events: Record<string, unknown>[]) =>
	events.filter((e) => e.event === '$exception') as {
		distinct_id: string;
		properties: Record<string, unknown> & {
			$exception_list: { value: string; mechanism: unknown }[];
		};
	}[];

describe('the browser cookie', () => {
	it('reads the distinct id the browser SDK stored', () => {
		const { client } = setup();
		expect(client.distinctIdFromCookie(`a=1; ${COOKIE}; b=2`)).toBe('visitor-1');
		expect(client.distinctIdFromCookie('fp_fp_pub_other=x')).toBeUndefined();
		expect(client.distinctIdFromCookie('fp_fp_pub_test=%7Bbroken')).toBeUndefined();
		expect(client.distinctIdFromCookie(undefined)).toBeUndefined();
	});
});

describe('scopes', () => {
	it('binds calls to one person and leaves flags off without one', async () => {
		const { client, events, flagRequests } = setup();
		const scope = client.scope('ada', { properties: { $current_url: '/x' } });
		expect(await scope.getFlag('beta')).toBe(true);
		scope.capture('clicked', { button: 'buy' });
		const nobody = client.scope(undefined);
		expect(await nobody.getAllFlags()).toEqual({});
		expect(await nobody.isEnabled('beta')).toBe(false);
		nobody.capture('ignored');
		await client.flush();
		expect(flagRequests.map((r) => r.distinct_id)).toEqual(['ada']);
		expect(events.map((e) => [e.event, e.distinct_id])).toEqual([
			['$feature_flag_called', 'ada'],
			['clicked', 'ada']
		]);
		expect(events[1]?.properties).toMatchObject({ $current_url: '/x', button: 'buy' });
	});
});

describe('hono', () => {
	it('gives handlers the visitor scope and captures thrown errors', async () => {
		const { client, events } = setup();
		const app = new Hono();
		app.use(honoFootprint(client));
		app.get('/flags', async (c) => c.json(await getFootprint(c).getAllFlags()));
		app.get('/boom', () => {
			throw new Error('kaput');
		});
		app.onError((_error, c) => c.text('sorry', 500));

		const ok = await app.request('/flags', { headers: { cookie: COOKIE } });
		expect(await ok.json()).toEqual({ beta: true });
		const failed = await app.request('/boom', { headers: { cookie: COOKIE } });
		expect(failed.status).toBe(500);
		await client.flush();

		const [error] = exceptions(events);
		expect(error?.distinct_id).toBe('visitor-1');
		expect(error?.properties).toMatchObject({
			$current_url: 'http://localhost/boom',
			$request_method: 'GET',
			$exception_level: 'fatal',
			$release: '1.0.0'
		});
		expect(error?.properties.$exception_list[0]).toMatchObject({
			value: 'kaput',
			mechanism: { type: 'hono', handled: false }
		});
	});

	it('takes the distinct id from a callback and can leave errors alone', async () => {
		const { client, events } = setup();
		const app = new Hono();
		app.use(
			honoFootprint(client, { distinctId: (c) => c.req.header('x-user'), captureErrors: false })
		);
		app.get('/me', (c) => c.text(getFootprint(c).distinctId ?? 'nobody'));
		app.get('/boom', () => {
			throw new Error('kaput');
		});
		expect(await (await app.request('/me', { headers: { 'x-user': 'ada' } })).text()).toBe('ada');
		expect(await (await app.request('/me')).text()).toBe('nobody');
		await app.request('/boom');
		await client.flush();
		expect(exceptions(events)).toEqual([]);
	});
});

describe('express', () => {
	async function serve(app: express.Express) {
		const server = app.listen(0);
		await new Promise<void>((resolve) => server.once('listening', () => resolve()));
		const { port } = server.address() as AddressInfo;
		return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
	}

	it('gives handlers the visitor scope and captures errors', async () => {
		const { client, events } = setup();
		const app = express();
		app.use(expressFootprint(client));
		app.get('/flags', async (req, res) => {
			res.json(await req.footprint?.getAllFlags());
		});
		app.get('/boom', () => {
			throw new Error('kaput');
		});
		app.use(footprintErrorHandler(client));
		app.use(
			(
				_error: unknown,
				_req: express.Request,
				res: express.Response,
				_next: express.NextFunction
			) => {
				res.status(500).send('sorry');
			}
		);
		const { url, close } = await serve(app);
		try {
			const ok = await fetch(`${url}/flags`, { headers: { cookie: COOKIE } });
			expect(await ok.json()).toEqual({ beta: true });
			const failed = await fetch(`${url}/boom?x=1`, { headers: { cookie: COOKIE } });
			expect(await failed.text()).toBe('sorry');
		} finally {
			close();
		}
		await client.flush();
		const [error] = exceptions(events);
		expect(error?.distinct_id).toBe('visitor-1');
		expect(error?.properties).toMatchObject({
			$current_url: `${url}/boom?x=1`,
			$request_method: 'GET'
		});
		expect(error?.properties.$exception_list[0]).toMatchObject({
			value: 'kaput',
			mechanism: { type: 'express', handled: false }
		});
	});
});
