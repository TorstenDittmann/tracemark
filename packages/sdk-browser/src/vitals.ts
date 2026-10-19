// Web vitals from PerformanceObserver, without the web-vitals library. LCP, FCP and TTFB belong
// to the page load; CLS and INP are measured again for every SPA page. See docs/autocapture.md.
import type { Properties } from './properties';

export interface Vitals {
	/** Metrics measured since the last call, as `$web_vitals_<name>_value` properties. */
	take(): Properties;
	stop(): void;
}

type EventEntry = PerformanceEntry & { interactionId?: number; duration: number };
type ShiftEntry = PerformanceEntry & { value: number; hadRecentInput: boolean };

/** Starts observing, or returns `undefined` where PerformanceObserver is missing. */
export function observeVitals(): Vitals | undefined {
	if (typeof PerformanceObserver === 'undefined') return;
	const observers: PerformanceObserver[] = [];
	const observe = (type: string, cb: (entries: PerformanceEntry[]) => void, extra?: object) => {
		try {
			if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return false;
			const o = new PerformanceObserver((list) => cb(list.getEntries()));
			o.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
			observers.push(o);
			return true;
		} catch {
			return false;
		}
	};

	// Paint timings of a page loaded in a background tab say nothing about what people see.
	const paints = document.visibilityState !== 'hidden';
	let load = true;
	let fcp = 0;
	let lcp = 0;
	// CLS is the largest burst of shifts less than 1 s apart and at most 5 s long.
	let cls = 0;
	let burst = 0;
	let burstStart = 0;
	let burstEnd = 0;
	// The longest interaction per id. INP is the longest, ignoring one outlier per 50 interactions.
	let interactions = new Map<number, number>();

	observe('paint', (entries) => {
		for (const e of entries) if (e.name === 'first-contentful-paint') fcp = e.startTime;
	});
	observe('largest-contentful-paint', (entries) => {
		const last = entries[entries.length - 1];
		if (last && load) lcp = last.startTime;
	});
	const shifts = observe('layout-shift', (entries) => {
		for (const e of entries as ShiftEntry[]) {
			if (e.hadRecentInput) continue;
			if (burst && e.startTime - burstEnd < 1000 && e.startTime - burstStart < 5000) {
				burst += e.value;
			} else {
				burst = e.value;
				burstStart = e.startTime;
			}
			burstEnd = e.startTime;
			cls = Math.max(cls, burst);
		}
	});
	const onEvents = (entries: PerformanceEntry[]) => {
		for (const e of entries as EventEntry[]) {
			if (!e.interactionId) continue;
			interactions.set(
				e.interactionId,
				Math.max(interactions.get(e.interactionId) ?? 0, e.duration)
			);
		}
	};
	observe('event', onEvents, { durationThreshold: 40 });
	observe('first-input', onEvents);

	return {
		take() {
			const m: Record<string, number> = {};
			if (load) {
				if (paints && fcp) m.FCP = fcp;
				if (paints && lcp) m.LCP = lcp;
				const nav = performance.getEntriesByType?.('navigation')[0] as
					| PerformanceNavigationTiming
					| undefined;
				if (nav && nav.responseStart > 0) m.TTFB = nav.responseStart;
			}
			if (interactions.size) {
				const sorted = [...interactions.values()].sort((a, b) => b - a);
				m.INP = sorted[Math.min(Math.floor(interactions.size / 50), sorted.length - 1)] ?? 0;
			}
			const p: Properties = {};
			for (const [name, value] of Object.entries(m))
				p[`$web_vitals_${name}_value`] = Math.round(value);
			if (shifts) p.$web_vitals_CLS_value = Math.round(cls * 10_000) / 10_000;
			load = false;
			cls = burst = 0;
			interactions = new Map();
			return p;
		},
		stop() {
			for (const o of observers) o.disconnect();
		}
	};
}
