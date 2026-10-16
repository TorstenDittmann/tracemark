import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, parseFlag } from '@footprint/flags';
import vectors from '@footprint/flags/vectors.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Footprint, type FootprintOptions } from '../src';
import { VERSION } from '../src/version';

const HOST = 'https://footprint.example.com';

interface Server {
	definitions?: unknown[] | null;
	flags?: (body: Record<string, unknown>) => unknown;
	events?: number;
}

/** A fake footprint instance. Returns what it was sent. */
function server(config: Server = {}) {
	const sent = {
		batches: [] as { api_key: string; batch: Record<string, unknown>[] }[],
		flagRequests: [] as Record<string, unknown>[],
		definitionRequests: [] as (string | null)[]
	};
	const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
		const path = url.slice(HOST.length);
		const json = (status: number, body: unknown) =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		if (path === '/e') {
			const body = JSON.parse(String(init.body));
			const status = config.events ?? 202;
			if (status < 500) sent.batches.push(body);
			return json(status, {});
		}
		if (path === '/flags') {
			const body = JSON.parse(String(init.body));
			sent.flagRequests.push(body);
			return json(200, config.flags?.(body) ?? { flags: {}, payloads: {} });
		}
		if (path === '/flags/definitions') {
			sent.definitionRequests.push(new Headers(init.headers).get('authorization'));
			return config.definitions === null
				? json(401, { error: 'invalid_secret_key' })
				: json(200, { flags: config.definitions ?? [] });
		}
		return json(404, {});
	});
	return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
}

const clients: Footprint[] = [];
function make(fetch: typeof globalThis.fetch, options: Partial<FootprintOptions> = {}) {
	const client = new Footprint({ apiKey: 'fp_pub_test', host: `${HOST}/`, fetch, ...options });
	clients.push(client);
	return client;
}

afterEach(async () => {
	for (const client of clients.splice(0)) await client.shutdown();
});

const events = (sent: ReturnType<typeof server>['sent']) => sent.batches.flatMap((b) => b.batch);

describe('events', () => {
	it('sends what was captured in batches, in the ingest wire format', async () => {
		const { fetch, sent } = server();
		const client = make(fetch);
		client.capture({
			distinctId: 'ada',
			event: 'purchase',
			properties: { amount: 9 },
			groups: { company: 'acme' },
			timestamp: new Date('2026-10-16T12:00:00Z'),
			uuid: '01927d0b-8c4a-7cc2-9f43-3c1b2b0e9a11'
		});
		client.identify({ distinctId: 'ada', set: { plan: 'pro' }, setOnce: { first: 'node' } });
		client.alias({ distinctId: 'ada', alias: 'anon-1' });
		client.groupIdentify({ groupType: 'company', groupKey: 'acme', properties: { seats: 4 } });
		await client.flush();
		expect(sent.batches).toHaveLength(1);
		expect(sent.batches[0]?.api_key).toBe('fp_pub_test');
		const [purchase, set, alias, group] = events(sent);
		expect(purchase).toEqual({
			uuid: '01927d0b-8c4a-7cc2-9f43-3c1b2b0e9a11',
			event: 'purchase',
			distinct_id: 'ada',
			timestamp: '2026-10-16T12:00:00.000Z',
			properties: { $lib: 'footprint-node', $lib_version: VERSION, amount: 9 },
			groups: { company: 'acme' }
		});
		expect(set).toMatchObject({
			event: '$set',
			person: { set: { plan: 'pro' }, set_once: { first: 'node' } }
		});
		expect(alias).toMatchObject({
			event: '$identify',
			properties: { $anon_distinct_id: 'anon-1' }
		});
		expect(group).toMatchObject({
			event: '$groupidentify',
			distinct_id: '$company_acme',
			properties: { $group_type: 'company', $group_key: 'acme', $group_set: { seats: 4 } },
			groups: { company: 'acme' }
		});
		expect(String(group?.uuid)).toMatch(/^[0-9a-f-]{8}-[0-9a-f]{4}-7/);
	});

	it('sends on its own once enough are queued', async () => {
		const { fetch, sent } = server();
		const client = make(fetch, { flushAt: 2 });
		client.capture({ distinctId: 'a', event: 'one' });
		expect(sent.batches).toHaveLength(0);
		client.capture({ distinctId: 'a', event: 'two' });
		await vi.waitFor(() => expect(sent.batches).toHaveLength(1));
	});

	it('keeps events when the server fails and drops ones it rejects', async () => {
		const config: Server = { events: 503 };
		const { fetch, sent } = server(config);
		const errors: unknown[] = [];
		const client = make(fetch, { onError: (e) => errors.push(e) });
		client.capture({ distinctId: 'a', event: 'kept' });
		await client.flush();
		expect(sent.batches).toHaveLength(0);
		config.events = 202;
		await client.flush();
		expect(events(sent).map((e) => e.event)).toEqual(['kept']);

		config.events = 400;
		client.capture({ distinctId: 'a', event: 'bad' });
		await client.flush();
		config.events = 202;
		await client.flush();
		expect(events(sent).map((e) => e.event)).toEqual(['kept', 'bad']);
		expect(errors.map(String)).toEqual([
			expect.stringContaining('HTTP 503'),
			expect.stringContaining('HTTP 400')
		]);
	});

	it('skips invalid events and caps the queue', async () => {
		const { fetch, sent } = server();
		const errors: unknown[] = [];
		const client = make(fetch, { maxQueueSize: 2, flushAt: 100, onError: (e) => errors.push(e) });
		client.capture({ distinctId: '', event: 'x' });
		client.capture({ distinctId: 'a', event: '' });
		for (const event of ['1', '2', '3']) client.capture({ distinctId: 'a', event });
		await client.flush();
		expect(events(sent).map((e) => e.event)).toEqual(['2', '3']);
		expect(errors).toHaveLength(2);
	});

	it('sends what is left on shutdown and nothing after', async () => {
		const { fetch, sent } = server();
		const client = make(fetch);
		client.capture({ distinctId: 'a', event: 'last' });
		await client.shutdown();
		client.capture({ distinctId: 'a', event: 'too late' });
		await client.flush();
		expect(events(sent).map((e) => e.event)).toEqual(['last']);
	});
});

const flag = (key: string, extra: object = {}) => ({
	key,
	active: true,
	conditions: [{ filters: [], rollout: 100 }],
	variants: [],
	payloads: {},
	...extra
});

describe('flags', () => {
	it('asks the server without a secret key', async () => {
		const { fetch, sent } = server({
			flags: () => ({ flags: { beta: 'test', off: false }, payloads: { beta: { x: 1 } } })
		});
		const client = make(fetch);
		const options = { personProperties: { plan: 'pro' }, groups: { company: 'acme' } };
		expect(await client.getFlag('beta', 'ada', options)).toBe('test');
		expect(await client.isEnabled('off', 'ada')).toBe(false);
		expect(await client.getPayload('beta', 'ada')).toEqual({ x: 1 });
		expect(sent.flagRequests[0]).toEqual({
			api_key: 'fp_pub_test',
			distinct_id: 'ada',
			person_properties: { plan: 'pro' },
			groups: { company: 'acme' }
		});
		await client.flush();
		expect(events(sent).map((e) => [e.event, e.distinct_id, e.properties])).toEqual([
			[
				'$feature_flag_called',
				'ada',
				expect.objectContaining({ $feature_flag: 'beta', $feature_flag_response: 'test' })
			],
			[
				'$feature_flag_called',
				'ada',
				expect.objectContaining({ $feature_flag: 'off', $feature_flag_response: false })
			]
		]);
		expect(events(sent)[0]?.groups).toEqual({ company: 'acme' });
	});

	it('evaluates locally with a secret key, asking the server only when it must', async () => {
		const { fetch, sent } = server({
			definitions: [
				flag('everyone', { payloads: { true: 'hi' } }),
				flag('pros', {
					conditions: [
						{
							filters: [{ type: 'person', property: 'plan', operator: 'eq', value: 'pro' }],
							rollout: 100
						}
					]
				}),
				flag('vips', {
					conditions: [{ filters: [{ type: 'cohort', cohort: 'c1' }], rollout: 100 }]
				})
			],
			flags: () => ({ flags: { everyone: true, pros: false, vips: true }, payloads: {} })
		});
		const client = make(fetch, { secretKey: 'fp_sec_test' });
		expect(await client.isEnabled('everyone', 'ada')).toBe(true);
		expect(await client.getPayload('everyone', 'ada')).toBe('hi');
		expect(await client.isEnabled('pros', 'ada', { personProperties: { plan: 'pro' } })).toBe(true);
		expect(await client.isEnabled('missing', 'ada')).toBe(false);
		expect(sent.flagRequests).toHaveLength(0);
		expect(sent.definitionRequests).toEqual(['Bearer fp_sec_test']);

		// A property it wasn't given, and a cohort: the server decides.
		expect(await client.isEnabled('pros', 'ada')).toBe(false);
		expect(await client.isEnabled('vips', 'ada')).toBe(true);
		expect(sent.flagRequests).toHaveLength(2);
		expect(await client.isEnabled('vips', 'ada', { onlyLocal: true })).toBe(false);
		expect(sent.flagRequests).toHaveLength(2);

		expect(await client.getAllFlags('ada', { personProperties: { plan: 'free' } })).toEqual({
			everyone: true,
			pros: false,
			vips: true
		});
	});

	it('keeps the last definitions when a refresh fails', async () => {
		const config: Server = { definitions: [flag('a')] };
		const { fetch } = server(config);
		const errors: unknown[] = [];
		const client = make(fetch, { secretKey: 'fp_sec_test', onError: (e) => errors.push(e) });
		expect(await client.isEnabled('a', 'ada', { onlyLocal: true })).toBe(true);
		config.definitions = null;
		await client.reloadFlags();
		expect(await client.isEnabled('a', 'ada', { onlyLocal: true })).toBe(true);
		expect(String(errors[0])).toContain('HTTP 401');
	});

	it('records an exposure once per person and value', async () => {
		const { fetch, sent } = server({ definitions: [flag('a')] });
		const client = make(fetch, { secretKey: 'fp_sec_test' });
		await client.isEnabled('a', 'ada');
		await client.isEnabled('a', 'ada');
		await client.isEnabled('a', 'grace');
		await client.isEnabled('a', 'bob', { sendExposure: false });
		await client.getAllFlags('eve');
		await client.flush();
		expect(events(sent).map((e) => e.distinct_id)).toEqual(['ada', 'grace']);
	});

	it('passes the shared vectors when evaluating locally', async () => {
		for (const { flag: definition, cases } of vectors.flags) {
			const { fetch, sent } = server({ definitions: [definition] });
			const client = make(fetch, { secretKey: 'fp_sec_test' });
			for (const { context, expected } of cases as {
				context: {
					distinctId: string;
					personProperties?: Record<string, unknown>;
					groups?: Record<string, string>;
					groupProperties?: Record<string, Record<string, unknown>>;
					cohorts?: string[];
				};
				expected: { value: boolean | string } | string;
			}[]) {
				// Cases that need a property or cohort the context lacks are the server's to decide.
				try {
					evaluate(parseFlag(definition), context, { missing: 'inconclusive' });
				} catch {
					continue;
				}
				// The SDK never knows cohort membership, so those cases go to the server too.
				if (expected === 'inconclusive' || context.cohorts) continue;
				const value = await client.getFlag(definition.key, context.distinctId, {
					personProperties: context.personProperties,
					groups: context.groups,
					groupProperties: context.groupProperties,
					onlyLocal: true,
					sendExposure: false
				});
				expect(value, `${definition.key} for ${JSON.stringify(context)}`).toBe(
					(expected as { value: boolean | string }).value
				);
			}
			expect(sent.flagRequests).toHaveLength(0);
		}
	});
});

// node:path rather than URL, like the browser SDK's fixture check.
const fixtureDir = join(import.meta.dirname, '../../schema/fixtures/valid');
it.skipIf(!existsSync(fixtureDir))('only sends event fields the fixtures use', async () => {
	const keys = new Set<string>();
	for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith('.json'))) {
		const body = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
		for (const event of body.batch ?? []) for (const key of Object.keys(event)) keys.add(key);
	}
	const { fetch, sent } = server();
	const client = make(fetch);
	client.capture({ distinctId: 'a', event: 'e', groups: { g: 'k' }, set: { a: 1 } });
	await client.flush();
	for (const key of Object.keys(events(sent)[0] ?? {})) expect(keys).toContain(key);
});

describe('exceptions', () => {
	it('captures errors with the release and the person', async () => {
		const { fetch, sent } = server();
		const client = make(fetch, { release: '2.0.0' });
		client.captureException(new TypeError('bad input', { cause: new Error('root') }), {
			distinctId: 'ada',
			properties: { route: '/checkout' }
		});
		client.captureException('plain string');
		await client.flush();
		const [first, second] = events(sent);
		expect(first).toMatchObject({
			event: '$exception',
			distinct_id: 'ada',
			properties: {
				route: '/checkout',
				$release: '2.0.0',
				$exception_level: 'error',
				$exception_list: [
					{ type: 'TypeError', value: 'bad input', mechanism: { type: 'manual', handled: true } },
					{ type: 'Error', value: 'root' }
				]
			}
		});
		const list = (first?.properties as Record<string, unknown> | undefined)?.$exception_list as {
			stacktrace: { frames: { filename: string; in_app: boolean }[] };
		}[];
		const frames = list[0]?.stacktrace.frames;
		expect(frames?.[0]).toMatchObject({ in_app: true });
		expect(frames?.[0]?.filename).toContain('client.test.ts');
		expect(second).toMatchObject({ distinct_id: '$server' });
	});

	it('captures uncaught errors, sends them and exits', async () => {
		const { fetch, sent } = server();
		const client = make(fetch);
		const listeners = new Map<string, (error: unknown) => void>();
		const exit = vi.fn();
		vi.stubGlobal('process', {
			on: (event: string, listener: (error: unknown) => void) => listeners.set(event, listener),
			off: (event: string) => listeners.delete(event),
			exit
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const remove = client.captureUncaughtExceptions();
		await listeners.get('unhandledRejection')?.(new Error('lost'));
		vi.unstubAllGlobals();
		expect(exit).toHaveBeenCalledWith(1);
		expect(events(sent)).toMatchObject([
			{
				event: '$exception',
				properties: {
					$exception_level: 'fatal',
					$exception_list: [
						{ value: 'lost', mechanism: { type: 'unhandledRejection', handled: false } }
					]
				}
			}
		]);
		remove();
	});
});
