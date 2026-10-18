import { beforeEach, describe, expect, it, vi } from 'vitest';
import { make, mockFetch, sentEvents } from './helpers';

type Entry = Record<string, unknown> & { startTime: number };

/** A PerformanceObserver stand-in: `report(type, entries)` delivers entries to observers of `type`. */
const observers = new Map<string, ((entries: Entry[]) => void)[]>();

function report(type: string, entries: Entry[]) {
	for (const cb of observers.get(type) ?? []) cb(entries);
}

class FakeObserver {
	static supportedEntryTypes = [
		'paint',
		'largest-contentful-paint',
		'layout-shift',
		'event',
		'first-input'
	];
	cb: (list: { getEntries(): Entry[] }) => void;
	type = '';
	constructor(cb: (list: { getEntries(): Entry[] }) => void) {
		this.cb = cb;
	}
	observe({ type }: { type: string }) {
		this.type = type;
		const list = observers.get(type) ?? [];
		list.push(this.deliver);
		observers.set(type, list);
	}
	deliver = (entries: Entry[]) => this.cb({ getEntries: () => entries });
	disconnect() {
		observers.set(
			this.type,
			(observers.get(this.type) ?? []).filter((cb) => cb !== this.deliver)
		);
	}
}

const vitalsEvents = (f: ReturnType<typeof mockFetch>) =>
	sentEvents(f)
		.filter((e) => e.event === '$web_vitals')
		.map((e) => e.properties ?? {});

function hide() {
	Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
	document.dispatchEvent(new Event('visibilitychange'));
	Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
}

const interaction = (interactionId: number, duration: number): Entry => ({
	startTime: 0,
	interactionId,
	duration
});

beforeEach(() => {
	observers.clear();
	vi.stubGlobal('PerformanceObserver', FakeObserver);
	vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
		{ responseStart: 180.4 } as unknown as PerformanceEntry
	]);
	Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: true });
});

describe('web vitals', () => {
	it('sends one $web_vitals event for the page load when the page is hidden', async () => {
		const f = mockFetch();
		const c = make({ autocaptureWebVitals: true });
		report('paint', [{ name: 'first-contentful-paint', startTime: 812.6 }]);
		report('largest-contentful-paint', [{ startTime: 1200 }, { startTime: 2450.2 }]);
		// Two shifts close together make one burst; one after user input does not count.
		report('layout-shift', [
			{ startTime: 1000, value: 0.05, hadRecentInput: false },
			{ startTime: 1500, value: 0.04, hadRecentInput: false },
			{ startTime: 1600, value: 0.5, hadRecentInput: true },
			{ startTime: 9000, value: 0.07, hadRecentInput: false }
		]);
		report('event', [interaction(1, 80), interaction(1, 120), interaction(2, 300)]);
		report('event', [{ startTime: 0, duration: 900 }]);
		hide();
		hide();
		window.dispatchEvent(new Event('pagehide'));
		await c.flush();
		const events = vitalsEvents(f);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			$web_vitals_FCP_value: 813,
			$web_vitals_LCP_value: 2450,
			$web_vitals_TTFB_value: 180,
			$web_vitals_INP_value: 300,
			$web_vitals_CLS_value: 0.09,
			$pathname: '/'
		});
	});

	it('ignores one outlier per 50 interactions for INP', async () => {
		const f = mockFetch();
		const c = make({ autocaptureWebVitals: true });
		report('event', [
			interaction(1, 900),
			...Array.from({ length: 59 }, (_, i) => interaction(i + 2, 100 + i))
		]);
		hide();
		await c.flush();
		expect(vitalsEvents(f)[0]?.$web_vitals_INP_value).toBe(158);
	});

	it('reports each SPA page on navigation, with CLS and INP measured again', async () => {
		const f = mockFetch();
		const c = make({ autocaptureWebVitals: true, autocapturePageviews: true });
		report('largest-contentful-paint', [{ startTime: 1000 }]);
		report('layout-shift', [{ startTime: 100, value: 0.2, hadRecentInput: false }]);
		history.pushState({}, '', '/next');
		report('event', [interaction(7, 64)]);
		report('largest-contentful-paint', [{ startTime: 5000 }]);
		history.pushState({}, '', '/next');
		window.dispatchEvent(new Event('pagehide'));
		await c.flush();
		const events = sentEvents(f).filter((e) => e.event !== '$pageleave');
		expect(events.map((e) => [e.event, e.properties?.$pathname])).toEqual([
			['$pageview', '/'],
			['$web_vitals', '/'],
			['$pageview', '/next'],
			['$web_vitals', '/next']
		]);
		const [first, second] = vitalsEvents(f);
		expect(first).toMatchObject({ $web_vitals_LCP_value: 1000, $web_vitals_CLS_value: 0.2 });
		expect(second).toMatchObject({ $web_vitals_INP_value: 64, $web_vitals_CLS_value: 0 });
		expect(second).not.toHaveProperty('$web_vitals_LCP_value');
		expect(second).not.toHaveProperty('$web_vitals_TTFB_value');
	});

	it('does nothing when off or without PerformanceObserver', async () => {
		const f = mockFetch();
		const c = make();
		report('largest-contentful-paint', [{ startTime: 1000 }]);
		hide();
		vi.stubGlobal('PerformanceObserver', undefined);
		const d = make({ autocaptureWebVitals: true });
		hide();
		await c.flush();
		await d.flush();
		expect(vitalsEvents(f)).toEqual([]);
	});
});
