import { describe, expect, it } from 'vitest';
import { COOKIELESS_ID } from '../src/client';
import { make, mockFetch, sentEvents } from './helpers';

describe('cookieless', () => {
	it('stores nothing and sends the placeholder id without a session', async () => {
		const f = mockFetch();
		const c = make({ cookieless: true, persistence: 'localStorage' });
		c.capture('clicked');
		await c.flush();
		const [event] = sentEvents(f);
		expect(event?.distinct_id).toBe(COOKIELESS_ID);
		expect(event?.session_id).toBeUndefined();
		expect(c.getSessionId()).toBeUndefined();
		expect(localStorage.length).toBe(0);
		expect(document.cookie).toBe('');
	});

	it('links the visitor hash to the identified id', async () => {
		const f = mockFetch();
		const c = make({ cookieless: true });
		c.identify('user_1');
		c.capture('after');
		await c.flush();
		const [ident, after] = sentEvents(f);
		expect(ident?.distinct_id).toBe('user_1');
		expect(ident?.properties?.$anon_distinct_id).toBe(COOKIELESS_ID);
		expect(after?.distinct_id).toBe('user_1');
		expect(localStorage.length).toBe(0);
	});

	it('goes back to the placeholder on reset', () => {
		const c = make({ cookieless: true });
		c.identify('user_1');
		c.reset();
		expect(c.getDistinctId()).toBe(COOKIELESS_ID);
	});
});
