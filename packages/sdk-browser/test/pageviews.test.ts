import { describe, expect, it, vi } from 'vitest';
import { make, mockFetch, sentEvents, setURL } from './helpers';

describe('automatic page views', () => {
	it('captures the initial page view and SPA navigations, deduping the same URL', async () => {
		setURL('https://app.example.com/home');
		const f = mockFetch();
		const c = make({ autocapturePageviews: true });
		history.pushState({}, '', '/a');
		history.pushState({}, '', '/a');
		history.replaceState({}, '', '/a');
		history.replaceState({}, '', '/b?tab=1');
		setURL('https://app.example.com/a');
		window.dispatchEvent(new PopStateEvent('popstate'));
		window.dispatchEvent(new PopStateEvent('popstate'));
		await c.flush();
		const pv = sentEvents(f).filter((e) => e.event === '$pageview');
		expect(pv.map((e) => e.properties?.$pathname)).toEqual(['/home', '/a', '/b', '/a']);
		expect(pv[2]?.properties?.$current_url).toBe('https://app.example.com/b?tab=1');
	});

	it('history methods still work and are restored on destroy', () => {
		const orig = history.pushState;
		const c = make({ autocapturePageviews: true });
		expect(history.pushState).not.toBe(orig);
		history.pushState({ n: 1 }, '', '/x');
		expect(location.pathname).toBe('/x');
		expect(history.state).toEqual({ n: 1 });
		c.destroy();
		expect(history.pushState).toBe(orig);
	});

	it('does nothing when disabled', async () => {
		const f = mockFetch();
		const c = make({ autocapturePageviews: false });
		history.pushState({}, '', '/a');
		window.dispatchEvent(new Event('pagehide'));
		await c.flush();
		expect(f).not.toHaveBeenCalled();
	});

	it('sends $pageleave via sendBeacon on pagehide', async () => {
		const beacon = vi.fn((_url: string, _data: Blob) => true);
		Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
		const f = mockFetch();
		make({ autocapturePageviews: true });
		window.dispatchEvent(new Event('pagehide'));
		expect(beacon).toHaveBeenCalledTimes(1);
		const blob = beacon.mock.calls[0]?.[1] as Blob;
		const body = JSON.parse(await blob.text());
		expect(body.batch.map((e: { event: string }) => e.event)).toEqual(['$pageview', '$pageleave']);
		expect(f).not.toHaveBeenCalled();
	});
});
