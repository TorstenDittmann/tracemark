import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WireEvent } from '../src/client';
import { createFlags } from '../src/flags';
import { API_KEY, HOST, make } from './helpers';

interface FlagsBody {
	api_key: string;
	distinct_id: string;
	person_properties: Record<string, unknown>;
	groups: Record<string, string>;
}

/** Serves `POST /flags` from `answer` and accepts `POST /e`, recording both. */
function server(answer: (body: FlagsBody) => unknown = () => ({ flags: {}, payloads: {} })) {
	const flagRequests: FlagsBody[] = [];
	const events: WireEvent[] = [];
	const fetch = vi.fn(async (url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		if (url === `${HOST}/flags`) {
			flagRequests.push(body);
			const json = answer(body);
			return { ok: json !== null, status: json === null ? 500 : 200, json: async () => json };
		}
		events.push(...body.batch);
		return { ok: true, status: 202, json: async () => ({}) };
	});
	vi.stubGlobal('fetch', fetch);
	return { flagRequests, events, fetch };
}

const ON = {
	flags: { 'new-checkout': true, pricing: 'test', off: false },
	payloads: { pricing: 9 }
};

afterEach(() => localStorage.clear());

describe('flags plugin', () => {
	it('fetches flags for the current person once the client starts', async () => {
		const { flagRequests } = server(() => ON);
		const flags = createFlags({ personProperties: { plan: 'pro' } });
		const client = make();
		client.group('company', 'acme');
		client.use(flags);
		await flags.ready();
		expect(flagRequests).toEqual([
			{
				api_key: API_KEY,
				distinct_id: client.getDistinctId(),
				person_properties: { plan: 'pro' },
				groups: { company: 'acme' }
			}
		]);
		expect(flags.isEnabled('new-checkout')).toBe(true);
		expect(flags.getFlag('pricing')).toBe('test');
		expect(flags.getPayload('pricing')).toBe(9);
		expect(flags.isEnabled('off')).toBe(false);
		expect(flags.isEnabled('unknown')).toBe(false);
		expect(flags.getPayload('off')).toBeUndefined();
	});

	it('records each flag value read once per person', async () => {
		const { events } = server(() => ON);
		const flags = createFlags();
		const client = make().use(flags);
		await flags.ready();
		flags.isEnabled('new-checkout');
		flags.isEnabled('new-checkout');
		flags.getFlag('pricing');
		flags.getAll();
		await client.flush();
		expect(
			events.map((e) => [
				e.event,
				e.properties?.$feature_flag,
				e.properties?.$feature_flag_response
			])
		).toEqual([
			['$feature_flag_called', 'new-checkout', true],
			['$feature_flag_called', 'pricing', 'test']
		]);

		client.identify('ada');
		await flags.ready();
		flags.isEnabled('new-checkout');
		await client.flush();
		expect(events.filter((e) => e.event === '$feature_flag_called')).toHaveLength(3);
		expect(events.at(-1)?.distinct_id).toBe('ada');
	});

	it('can leave exposures out', async () => {
		const { events } = server(() => ON);
		const flags = createFlags({ sendExposures: false });
		const client = make().use(flags);
		await flags.ready();
		flags.isEnabled('new-checkout');
		await client.flush();
		expect(events).toEqual([]);
	});

	it('fetches again when the person or their groups change', async () => {
		const { flagRequests } = server((body) => ({
			flags: { vip: body.distinct_id === 'ada' }
		}));
		const flags = createFlags();
		const changes: unknown[] = [];
		flags.onChange((all) => changes.push(all));
		const client = make().use(flags);
		await flags.ready();
		expect(flags.isEnabled('vip')).toBe(false);

		client.identify('ada');
		await flags.ready();
		expect(flags.isEnabled('vip')).toBe(true);

		client.group('company', 'acme');
		await flags.ready();
		client.group('company', 'acme');
		client.reset();
		await flags.ready();
		expect(flags.isEnabled('vip')).toBe(false);
		expect(flagRequests.map((r) => [r.distinct_id === 'ada', r.groups])).toEqual([
			[false, {}],
			[true, {}],
			[true, { company: 'acme' }],
			[false, {}]
		]);
		expect(changes).toEqual([{ vip: false }, { vip: true }, { vip: false }]);
	});

	it('serves the bootstrap until the fetch answers, and keeps flags when it fails', async () => {
		let fail = false;
		server(() => (fail ? null : { flags: { a: 'b' } }));
		const flags = createFlags({ bootstrap: { flags: { a: true }, payloads: { a: 1 } } });
		make().use(flags);
		expect(flags.getFlag('a')).toBe(true);
		expect(flags.getPayload('a')).toBe(1);
		await flags.ready();
		expect(flags.getFlag('a')).toBe('b');
		fail = true;
		await flags.reload();
		expect(flags.getFlag('a')).toBe('b');
	});

	it('remembers the last answer for the same person across page loads', async () => {
		server(() => ON);
		const first = createFlags();
		const a = make().use(first);
		await first.ready();
		a.destroy();

		server(() => new Promise(() => {}));
		const second = createFlags();
		make().use(second);
		expect(second.getFlag('pricing')).toBe('test');

		localStorage.setItem(
			`fp_flags_${API_KEY}`,
			JSON.stringify({ id: 'someone-else', flags: { pricing: 'control' } })
		);
		const third = createFlags();
		make().use(third);
		expect(third.getFlag('pricing')).toBe(false);
	});

	it('stores nothing without localStorage persistence', async () => {
		server(() => ON);
		const flags = createFlags();
		make({ persistence: 'memory' }).use(flags);
		await flags.ready();
		expect(localStorage.length).toBe(0);
	});

	it('ignores an answer for a person who is no longer current', async () => {
		const pending: ((value: unknown) => void)[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(
				() =>
					new Promise((resolve) =>
						pending.push((json) => resolve({ ok: true, status: 200, json: async () => json }))
					)
			)
		);
		const flags = createFlags();
		const client = make({ autocapturePageviews: false }).use(flags);
		client.identify('ada');
		// The answer to the identify arrives first, then the stale one for the anonymous id.
		pending[1]?.({ flags: { who: 'ada' } });
		await flags.ready();
		pending[0]?.({ flags: { who: 'anonymous' } });
		await new Promise((r) => setTimeout(r));
		expect(flags.getAll()).toEqual({ who: 'ada' });
	});

	it('does not fetch for someone who opted out', async () => {
		const { flagRequests } = server(() => ON);
		const client = make();
		client.optOut();
		const flags = createFlags();
		client.use(flags);
		await flags.ready();
		expect(flagRequests).toEqual([]);
	});

	it('merges person properties and fetches again', async () => {
		const { flagRequests } = server(() => ON);
		const flags = createFlags({ personProperties: { plan: 'free' } });
		make().use(flags);
		await flags.ready();
		await flags.setPersonProperties({ plan: 'pro', seats: 3 });
		expect(flagRequests.at(-1)?.person_properties).toEqual({ plan: 'pro', seats: 3 });
	});

	it('waits for init when added before it', async () => {
		const { flagRequests } = server(() => ON);
		const flags = createFlags();
		const { createClient } = await import('../src/client');
		const client = createClient().use(flags);
		let ready = false;
		void flags.ready().then(() => {
			ready = true;
		});
		await new Promise((r) => setTimeout(r));
		expect(ready).toBe(false);
		client.init({ apiKey: API_KEY, host: HOST, autocapturePageviews: false });
		await flags.ready();
		expect(flagRequests).toHaveLength(1);
		client.destroy();
	});
});
