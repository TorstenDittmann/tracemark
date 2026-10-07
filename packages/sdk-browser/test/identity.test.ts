import { describe, expect, it, vi } from 'vitest';
import { SESSION_IDLE_MS, SESSION_MAX_MS } from '../src/client';
import { API_KEY, make, mockFetch, sentEvents } from './helpers';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = `fp_${API_KEY}`;

describe('persistence', () => {
	it('localStorage: anonymous UUIDv7 id survives a reload', () => {
		const a = make();
		const id = a.getDistinctId();
		expect(id).toMatch(V7);
		expect(localStorage.getItem(KEY)).toContain(id);
		a.destroy();
		expect(make().getDistinctId()).toBe(id);
		expect(document.cookie).not.toContain(KEY);
	});

	it('cookie: stored in a first-party cookie, not localStorage', () => {
		const id = make({ persistence: 'cookie' }).getDistinctId();
		expect(document.cookie).toContain(`${KEY}=`);
		expect(localStorage.getItem(KEY)).toBeNull();
		expect(make({ persistence: 'cookie' }).getDistinctId()).toBe(id);
	});

	it('memory: nothing is stored and a reload gets a new id', () => {
		const id = make({ persistence: 'memory' }).getDistinctId();
		expect(localStorage.length).toBe(0);
		expect(document.cookie).toBe('');
		expect(make({ persistence: 'memory' }).getDistinctId()).not.toBe(id);
	});

	it('falls back to memory if localStorage throws', () => {
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('denied');
		});
		const c = make();
		expect(c.getDistinctId()).toMatch(V7);
	});

	it('ignores corrupt stored state', () => {
		localStorage.setItem(KEY, '{not json');
		expect(make().getDistinctId()).toMatch(V7);
	});
});

describe('session', () => {
	it('rotates after 30 minutes of inactivity', () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 7, 12) });
		mockFetch();
		const c = make();
		const s1 = c.getSessionId();
		expect(s1).toMatch(V7);
		vi.advanceTimersByTime(SESSION_IDLE_MS - 60_000);
		c.capture('tick');
		expect(c.getSessionId()).toBe(s1);
		vi.advanceTimersByTime(SESSION_IDLE_MS + 1);
		const s2 = c.getSessionId();
		expect(s2).not.toBe(s1);
		expect(s2).toMatch(V7);
	});

	it('getSessionId does not extend the session', () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 7, 12) });
		const c = make();
		const s1 = c.getSessionId();
		vi.advanceTimersByTime(SESSION_IDLE_MS - 1000);
		expect(c.getSessionId()).toBe(s1);
		vi.advanceTimersByTime(2000);
		expect(c.getSessionId()).not.toBe(s1);
	});

	it('rotates after 24 hours even when active', () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 7, 0) });
		mockFetch();
		const c = make({ flushIntervalMs: 10 * 3600_000 });
		const s1 = c.getSessionId();
		let elapsed = 0;
		while (elapsed + 20 * 60_000 < SESSION_MAX_MS) {
			vi.advanceTimersByTime(20 * 60_000);
			elapsed += 20 * 60_000;
			c.capture('tick');
			expect(c.getSessionId()).toBe(s1);
		}
		vi.advanceTimersByTime(SESSION_MAX_MS - elapsed + 1);
		c.capture('tick');
		expect(c.getSessionId()).not.toBe(s1);
	});

	it('is persisted with last activity across reloads', () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 9, 7, 12) });
		const a = make();
		const s1 = a.getSessionId();
		a.destroy();
		vi.advanceTimersByTime(10 * 60_000);
		const b = make();
		expect(b.getSessionId()).toBe(s1);
		b.destroy();
		vi.advanceTimersByTime(SESSION_IDLE_MS + 1);
		expect(make().getSessionId()).not.toBe(s1);
	});

	it('events carry the session id', async () => {
		const f = mockFetch();
		const c = make();
		c.capture('a');
		await c.flush();
		expect(sentEvents(f)[0]?.session_id).toBe(c.getSessionId());
	});
});

describe('identify / reset / groups', () => {
	it('emits $identify with $anon_distinct_id when leaving the anonymous id', async () => {
		const f = mockFetch();
		const c = make();
		const anon = c.getDistinctId();
		c.capture('before');
		c.identify('user_1', { set: { plan: 'pro' }, set_once: { first_seen_on: 'web' } });
		c.capture('after');
		await c.flush();
		const [before, ident, after] = sentEvents(f);
		expect(before?.distinct_id).toBe(anon);
		expect(ident?.event).toBe('$identify');
		expect(ident?.distinct_id).toBe('user_1');
		expect(ident?.properties?.$anon_distinct_id).toBe(anon);
		expect(ident?.person).toEqual({ set: { plan: 'pro' }, set_once: { first_seen_on: 'web' } });
		expect(after?.distinct_id).toBe('user_1');
		expect(c.getDistinctId()).toBe('user_1');
		expect(make().getDistinctId()).toBe('user_1');
	});

	it('identify with the same id only sends person properties', async () => {
		const f = mockFetch();
		const c = make();
		c.identify('user_1');
		c.identify('user_1');
		c.identify('user_1', { set: { a: 1 } });
		await c.flush();
		const evs = sentEvents(f);
		expect(evs.map((e) => e.event)).toEqual(['$identify', '$set']);
		expect(evs[1]?.person).toEqual({ set: { a: 1 } });
	});

	it('switching between identified ids does not send $anon_distinct_id', async () => {
		const f = mockFetch();
		const c = make();
		c.identify('a');
		c.identify('b');
		await c.flush();
		const last = sentEvents(f).at(-1);
		expect(last?.distinct_id).toBe('b');
		expect(last?.properties?.$anon_distinct_id).toBeUndefined();
	});

	it('setPersonProperties emits $set with person', async () => {
		const f = mockFetch();
		const c = make();
		c.setPersonProperties({ set_once: { ref: 'x' } });
		c.setPersonProperties({});
		await c.flush();
		const evs = sentEvents(f);
		expect(evs).toHaveLength(1);
		expect(evs[0]).toMatchObject({ event: '$set', person: { set_once: { ref: 'x' } } });
	});

	it('group attaches groups to subsequent events (max 5 types)', async () => {
		const f = mockFetch();
		const c = make();
		c.capture('none');
		c.group('company', 'acme', { name: 'Acme' });
		c.group('team', 'core');
		for (const t of ['a', 'b', 'c', 'd']) c.group(t, 'k');
		c.capture('with');
		await c.flush();
		const evs = sentEvents(f);
		expect(evs[0]?.groups).toBeUndefined();
		expect(evs[1]).toMatchObject({
			event: '$groupidentify',
			properties: { $group_type: 'company', $group_key: 'acme', $group_set: { name: 'Acme' } }
		});
		expect(evs.at(-1)?.groups).toEqual({ company: 'acme', team: 'core', a: 'k', b: 'k', c: 'k' });
	});

	it('reset: new anonymous id, new session, groups cleared', async () => {
		const f = mockFetch();
		const c = make();
		c.identify('user_1');
		c.group('company', 'acme');
		const sid = c.getSessionId();
		c.reset();
		const anon2 = c.getDistinctId();
		expect(anon2).not.toBe('user_1');
		expect(anon2).toMatch(V7);
		expect(c.getSessionId()).not.toBe(sid);
		c.capture('after_reset');
		c.identify('user_2');
		await c.flush();
		const evs = sentEvents(f);
		const after = evs.find((e) => e.event === 'after_reset');
		expect(after?.groups).toBeUndefined();
		expect(after?.distinct_id).toBe(anon2);
		expect(evs.at(-1)?.properties?.$anon_distinct_id).toBe(anon2);
		expect(make().getDistinctId()).toBe('user_2');
	});
});

describe('opt-out', () => {
	it('drops events while opted out, persists, and resumes on optIn', async () => {
		const f = mockFetch();
		const c = make();
		expect(c.hasOptedOut()).toBe(false);
		c.capture('queued_then_dropped');
		c.optOut();
		c.capture('dropped');
		c.identify('u');
		await c.flush();
		expect(f).not.toHaveBeenCalled();
		expect(c.hasOptedOut()).toBe(true);
		c.destroy();
		const d = make();
		expect(d.hasOptedOut()).toBe(true);
		d.optIn();
		d.capture('kept');
		await d.flush();
		expect(sentEvents(f).map((e) => e.event)).toEqual(['kept']);
		expect(make().hasOptedOut()).toBe(false);
	});

	it('reset keeps the opt-out choice', () => {
		const c = make();
		c.optOut();
		c.reset();
		expect(c.hasOptedOut()).toBe(true);
	});

	it('respectDnt treats doNotTrack=1 as opted out unless optIn is called', async () => {
		vi.spyOn(navigator, 'doNotTrack', 'get').mockReturnValue('1');
		const f = mockFetch();
		const c = make({ respectDnt: true });
		expect(c.hasOptedOut()).toBe(true);
		c.capture('x');
		await c.flush();
		expect(f).not.toHaveBeenCalled();
		c.optIn();
		expect(c.hasOptedOut()).toBe(false);
		expect(make({ respectDnt: false }).hasOptedOut()).toBe(false);
	});
});

describe('plugins and init', () => {
	it('use() calls setup with the client once per name', () => {
		const c = make();
		const setup = vi.fn();
		expect(c.use({ name: 'p', setup })).toBe(c);
		c.use({ name: 'p', setup });
		expect(setup).toHaveBeenCalledTimes(1);
		expect(setup).toHaveBeenCalledWith(c);
		expect(c.config?.apiKey).toBe(API_KEY);
	});

	it('is a no-op before init and warns without apiKey/host', async () => {
		const f = mockFetch();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { createClient } = await import('../src/client');
		const c = createClient();
		c.capture('x');
		await c.flush();
		expect(c.getDistinctId()).toBeUndefined();
		c.init({ apiKey: '', host: '' });
		expect(warn).toHaveBeenCalled();
		expect(f).not.toHaveBeenCalled();
	});
});
