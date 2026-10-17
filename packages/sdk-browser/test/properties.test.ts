import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version';
import { API_KEY, bodies, HOST, make, mockFetch, sentEvents, setURL } from './helpers';

describe('event envelope and default properties', () => {
	it('builds a protocol-compliant body', async () => {
		const f = mockFetch();
		const c = make();
		c.capture('signed_up', { plan: 'pro', $title: 'override' });
		await c.flush();
		expect(f).toHaveBeenCalledTimes(1);
		const [url, init] = f.mock.calls[0] ?? [];
		expect(url).toBe(`${HOST}/e`);
		expect(init).toMatchObject({ method: 'POST', keepalive: true });
		const [body] = bodies(f);
		expect(body?.api_key).toBe(API_KEY);
		expect(new Date(body?.sent_at ?? '').toISOString()).toBe(body?.sent_at);
		const ev = body?.batch[0];
		expect(ev).toMatchObject({
			event: 'signed_up',
			distinct_id: c.getDistinctId(),
			session_id: c.getSessionId()
		});
		expect(new Date(ev?.timestamp ?? '').toISOString()).toBe(ev?.timestamp);
		expect(ev?.properties).toMatchObject({ plan: 'pro', $title: 'override' });
	});

	it('strips trailing slashes from host', async () => {
		const f = mockFetch();
		const c = make({ host: `${HOST}//` });
		c.capture('x');
		await c.flush();
		expect(f.mock.calls[0]?.[0]).toBe(`${HOST}/e`);
	});

	it('includes all default properties and UTM parameters', async () => {
		setURL(
			'https://shop.example.com:8443/pricing?utm_source=news&utm_medium=email&utm_campaign=fall&utm_term=t&utm_content=c&x=1'
		);
		document.title = 'Pricing';
		Object.defineProperty(document, 'referrer', {
			value: 'https://www.google.com/search?q=x',
			configurable: true
		});
		const f = mockFetch();
		const c = make();
		c.capture('x');
		await c.flush();
		const p = sentEvents(f)[0]?.properties ?? {};
		expect(p).toMatchObject({
			$current_url:
				'https://shop.example.com:8443/pricing?utm_source=news&utm_medium=email&utm_campaign=fall&utm_term=t&utm_content=c&x=1',
			$pathname: '/pricing',
			$host: 'shop.example.com:8443',
			$referrer: 'https://www.google.com/search?q=x',
			$referring_domain: 'www.google.com',
			$title: 'Pricing',
			$lib: 'tracemark-browser',
			$lib_version: VERSION,
			utm_source: 'news',
			utm_medium: 'email',
			utm_campaign: 'fall',
			utm_term: 't',
			utm_content: 'c'
		});
		for (const k of ['$screen_width', '$screen_height', '$viewport_width', '$viewport_height']) {
			expect(typeof p[k]).toBe('number');
		}
		expect(typeof p.$browser_language).toBe('string');
		expect(typeof p.$timezone).toBe('string');
		expect(p.x).toBeUndefined();
	});

	it('uses $direct without a referrer and omits absent UTMs', async () => {
		Object.defineProperty(document, 'referrer', { value: '', configurable: true });
		setURL('https://app.example.com/?utm_source=');
		const f = mockFetch();
		const c = make();
		c.capture('x');
		await c.flush();
		const p = sentEvents(f)[0]?.properties ?? {};
		expect(p.$referrer).toBe('$direct');
		expect(p.$referring_domain).toBe('$direct');
		expect(Object.keys(p).filter((k) => k.startsWith('utm_'))).toEqual([]);
	});

	it('rejects invalid event names', async () => {
		const f = mockFetch();
		const c = make();
		c.capture('');
		c.capture('x'.repeat(201));
		await c.flush();
		expect(f).not.toHaveBeenCalled();
	});
});
