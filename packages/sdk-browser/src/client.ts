import { listen } from './autocapture';
import { defaultProperties, liteProperties, type Properties } from './properties';
import { createStore, type Persistence, type Store } from './storage';
import { uuidv7 } from './uuid';
import { observeVitals, type Vitals } from './vitals';

export interface Config {
	/** Public project key (`fp_pub_…`). */
	apiKey: string;
	/** Ingest base URL, e.g. `https://ingest.example.com`. Events are POSTed to `${host}/e`. */
	host: string;
	/** Capture `$pageview` on load and on SPA navigations, and `$pageleave` on pagehide. Default `true`. */
	autocapturePageviews?: boolean;
	/**
	 * Capture clicks on buttons, links and elements marked `data-tm-capture` as `$autocapture`
	 * events. Skips anything inside `data-tm-no-capture` and never reads input values. Default `false`.
	 */
	autocaptureClicks?: boolean;
	/** Capture form submits as `$autocapture` events, with the same rules as clicks. Default `false`. */
	autocaptureForms?: boolean;
	/**
	 * Record where clicks on anything else land, as lightweight `$heatmap_click` events with only
	 * the position, path and a selector, for click heatmaps. Default `false`.
	 */
	heatmaps?: boolean;
	/** Capture LCP, INP, CLS, FCP and TTFB as one `$web_vitals` event per page view. Default `false`. */
	autocaptureWebVitals?: boolean;
	/** Where ids are kept. `'memory'` keeps nothing across reloads. Default `'localStorage'`. */
	persistence?: Persistence;
	/**
	 * Store nothing on the device. Anonymous visitors are counted by a hash of IP address, user
	 * agent and a salt that rotates daily, computed by ingest; sessions are derived from 30-minute
	 * gaps. Identified users keep their id until the page unloads. Implies `persistence: 'memory'`.
	 * Default `false`.
	 */
	cookieless?: boolean;
	/** Default `2000`. */
	flushIntervalMs?: number;
	/** Default `50`. */
	maxBatchSize?: number;
	/** Log to the console. Default `false`. */
	debug?: boolean;
	/** Treat `navigator.doNotTrack === '1'` as opted out unless `optIn()` was called. Default `false`. */
	respectDnt?: boolean;
}

export interface PersonProperties {
	set?: Properties;
	set_once?: Properties;
}

/** One event as sent on the wire (see docs/ingest-protocol.md). */
export interface WireEvent {
	uuid: string;
	event: string;
	distinct_id: string;
	timestamp: string;
	session_id?: string;
	properties?: Properties;
	person?: PersonProperties;
	groups?: Record<string, string>;
}

export interface Plugin {
	name: string;
	setup(client: TracemarkClient): void;
	/** Called after `init`, and when the distinct id or groups change. */
	changed?(reason: 'init' | 'identity' | 'groups'): void;
}

/** A score or piece of feedback on an AI trace, see docs/ai.md. */
export interface AiScore {
	traceId: string;
	/** A step of the trace, such as one generation's span id. */
	spanId?: string;
	/** What is scored, such as `thumbs` or `helpful`. */
	name: string;
	/** Thumbs up and down are 1 and 0. */
	value: number;
	comment?: string;
}

export interface TracemarkClient {
	init(config: Config): TracemarkClient;
	capture(event: string, properties?: Properties): void;
	/** Records a `$ai_score` event for an AI trace, as the current person. */
	aiScore(score: AiScore): void;
	identify(distinctId: string, person?: PersonProperties): void;
	group(type: string, key: string, properties?: Properties): void;
	setPersonProperties(person: PersonProperties): void;
	reset(): void;
	optOut(): void;
	optIn(): void;
	hasOptedOut(): boolean;
	flush(): Promise<void>;
	getDistinctId(): string | undefined;
	getSessionId(): string | undefined;
	/** Group type to key, as set by `group()`. */
	getGroups(): Record<string, string>;
	use(plugin: Plugin): TracemarkClient;
	/** Remove listeners, restore history methods and stop timers. Queued events are discarded. */
	destroy(): void;
	/** The resolved config, or `undefined` before `init`. For plugins. */
	readonly config: Readonly<Required<Config>> | undefined;
}

interface State {
	/** distinct_id */
	id: string;
	/** true while `id` is an anonymous, SDK-generated id */
	anon: boolean;
	sid: string;
	/** session start (ms) */
	ss: number;
	/** last activity (ms) */
	la: number;
	groups: Record<string, string>;
	/** explicit opt-out (true) / opt-in (false) */
	out?: boolean;
}

/** Placeholder distinct_id that ingest replaces with the daily visitor hash. */
export const COOKIELESS_ID = '$cookieless';
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
export const MAX_QUEUE = 1000;
export const MAX_RETRIES = 3;
export const RETRY_BASE_MS = 1000;
const MAX_GROUPS = 5;
/** `window.name` of the frame the dashboard's heatmap view loads a page in. */
export const HEATMAP_FRAME = 'tracemark-heatmap';

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class RetryableError extends Error {}

export function createClient(config?: Config): TracemarkClient {
	let cfg: Required<Config> | undefined;
	let store: Store;
	let key = '';
	let state: State;
	let queue: WireEvent[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	let flushing: Promise<void> = Promise.resolve();
	let lastPageUrl: string | undefined;
	let vitals: Vitals | undefined;
	/** The page web vitals are being measured for, and whether they were sent already. */
	let vitalsPage: Properties | undefined;
	let vitalsSent = false;
	const plugins: Plugin[] = [];
	const cleanups: (() => void)[] = [];

	const notify = (reason: 'init' | 'identity' | 'groups') => {
		for (const plugin of plugins) {
			try {
				plugin.changed?.(reason);
			} catch (e) {
				console.warn(`[tracemark] plugin ${plugin.name} failed`, e);
			}
		}
	};

	const log = (...args: unknown[]) => {
		if (cfg?.debug) console.log('[tracemark]', ...args);
	};

	const save = () => store.set(key, JSON.stringify(state));

	const newSession = (now: number) => {
		state.sid = uuidv7(now);
		state.ss = now;
		state.la = now;
	};

	/** Rotate the session if idle > 30 min or older than 24 h. */
	const checkSession = (now: number, touch: boolean) => {
		if (!state.sid || now - state.la > SESSION_IDLE_MS || now - state.ss > SESSION_MAX_MS) {
			newSession(now);
		} else if (touch) {
			state.la = now;
		}
		save();
	};

	// The dashboard's heatmap view shows the site in a frame with this name: nothing is tracked there.
	const ready = () => !!cfg && isBrowser() && window.name !== HEATMAP_FRAME;

	const optedOut = (): boolean => {
		if (!cfg) return false;
		if (state.out !== undefined) return state.out;
		if (cfg.respectDnt) {
			const n = navigator as Navigator & { msDoNotTrack?: string };
			const w = window as Window & { doNotTrack?: string };
			const dnt = n.doNotTrack ?? n.msDoNotTrack ?? w.doNotTrack;
			return dnt === '1' || dnt === 'yes';
		}
		return false;
	};

	const scheduleFlush = () => {
		if (timer === undefined && cfg) {
			timer = setTimeout(() => {
				timer = undefined;
				void client.flush();
			}, cfg.flushIntervalMs);
		}
	};

	const enqueue = (events: WireEvent[], front = false) => {
		queue = front ? events.concat(queue) : queue.concat(events);
		if (queue.length > MAX_QUEUE) {
			log(`queue full, dropping ${queue.length - MAX_QUEUE} oldest events`);
			queue = queue.slice(queue.length - MAX_QUEUE);
		}
	};

	const body = (batch: WireEvent[]) =>
		JSON.stringify({ api_key: cfg?.apiKey, sent_at: new Date().toISOString(), batch });

	const post = async (batch: WireEvent[]) => {
		let res: Response;
		try {
			res = await fetch(`${cfg?.host}/e`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: body(batch),
				keepalive: true
			});
		} catch (e) {
			throw new RetryableError(String(e));
		}
		if (res.status >= 500) throw new RetryableError(`HTTP ${res.status}`);
		if (res.status >= 400)
			log(`batch rejected with HTTP ${res.status}, dropping ${batch.length} events`);
	};

	/** Send one batch; network errors and 5xx retry with exponential backoff (1s, 2s, 4s). */
	const sendWithRetry = async (batch: WireEvent[]): Promise<boolean> => {
		for (let attempt = 0; ; attempt++) {
			try {
				await post(batch);
				return true;
			} catch (e) {
				if (!(e instanceof RetryableError) || attempt >= MAX_RETRIES) {
					log('send failed, will retry later', e);
					return false;
				}
				await sleep(RETRY_BASE_MS * 2 ** attempt);
			}
		}
	};

	const drain = async () => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		while (queue.length && cfg) {
			const batch = queue.splice(0, cfg.maxBatchSize);
			if (!(await sendWithRetry(batch))) {
				// Keep the events (still capped) and try again on the next interval.
				enqueue(batch, true);
				scheduleFlush();
				return;
			}
		}
	};

	/**
	 * Flush synchronously on page unload. sendBeacon cannot set headers, so the body
	 * is sent as a `text/plain` Blob: that is a CORS "simple request" and skips the
	 * preflight (which would not complete during unload). The API key is in the body.
	 */
	const beaconFlush = () => {
		if (!cfg || !queue.length) return;
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
		const url = `${cfg.host}/e`;
		while (queue.length) {
			const batch = queue.splice(0, cfg.maxBatchSize);
			const data = body(batch);
			let ok = false;
			try {
				ok = navigator.sendBeacon?.(url, new Blob([data], { type: 'text/plain' })) ?? false;
			} catch {}
			if (!ok) {
				try {
					void fetch(url, {
						method: 'POST',
						headers: { 'Content-Type': 'text/plain' },
						body: data,
						keepalive: true
					}).catch(() => {});
				} catch {}
			}
		}
	};

	const emit = (
		event: string,
		properties?: Properties,
		extra?: { person?: PersonProperties; distinctId?: string; lite?: boolean }
	) => {
		if (!ready() || optedOut()) return;
		if (typeof event !== 'string' || !event || event.length > 200) {
			log('invalid event name', event);
			return;
		}
		const now = Date.now();
		checkSession(now, true);
		const ev: WireEvent = {
			uuid: uuidv7(now),
			event,
			distinct_id: extra?.distinctId ?? state.id,
			timestamp: new Date(now).toISOString(),
			properties: { ...(extra?.lite ? liteProperties() : defaultProperties()), ...properties }
		};
		// Cookieless sessions are derived server-side, a per-page-load id would split them.
		if (!cfg?.cookieless) ev.session_id = state.sid;
		const person = extra?.person;
		if (person && (person.set || person.set_once)) {
			ev.person = {};
			if (person.set) ev.person.set = person.set;
			if (person.set_once) ev.person.set_once = person.set_once;
		}
		if (Object.keys(state.groups).length) ev.groups = { ...state.groups };
		log('capture', ev);
		enqueue([ev]);
		if (queue.length >= (cfg?.maxBatchSize ?? 50)) void client.flush();
		else scheduleFlush();
	};

	/** Sends the current page's web vitals, once per page view. */
	const sendVitals = () => {
		if (!vitals || !vitalsPage) return;
		const metrics = vitals.take();
		if (!vitalsSent && Object.keys(metrics).length) {
			emit('$web_vitals', { ...metrics, ...vitalsPage });
		}
		vitalsSent = true;
	};

	const navigated = () => {
		const loc = window.location;
		if (loc.href === lastPageUrl) return;
		lastPageUrl = loc.href;
		if (vitals) {
			sendVitals();
			// The URL a page was measured on, as location has moved on by the time it is sent.
			vitalsPage = { $current_url: loc.href, $pathname: loc.pathname };
			vitalsSent = false;
		}
		if (cfg?.autocapturePageviews) emit('$pageview');
	};

	const installAutocapture = () => {
		const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void) => {
			window.addEventListener(t, fn);
			cleanups.push(() => window.removeEventListener(t, fn));
		};
		on('pagehide', () => {
			sendVitals();
			if (cfg?.autocapturePageviews) emit('$pageleave');
			beaconFlush();
		});
		const onVis = () => {
			if (document.visibilityState !== 'hidden') return;
			sendVitals();
			beaconFlush();
		};
		document.addEventListener('visibilitychange', onVis);
		cleanups.push(() => document.removeEventListener('visibilitychange', onVis));

		if (cfg?.autocaptureClicks || cfg?.autocaptureForms || cfg?.heatmaps) {
			cleanups.push(
				listen(cfg.autocaptureClicks, cfg.autocaptureForms, cfg.heatmaps, (event, p, lite) =>
					emit(event, p, { lite })
				)
			);
		}
		if (cfg?.autocaptureWebVitals) {
			vitals = observeVitals();
			cleanups.push(() => {
				vitals?.stop();
				vitals = vitalsPage = undefined;
			});
		}

		if (!cfg?.autocapturePageviews && !vitals) return;
		// Patch history so SPA navigations produce page views. The original method runs first
		// so location reflects the new URL; same-URL calls are deduped in navigated.
		const h = window.history;
		for (const m of ['pushState', 'replaceState'] as const) {
			const orig = h[m];
			const patched = function (this: History, ...args: Parameters<History['pushState']>) {
				const r = orig.apply(this, args);
				navigated();
				return r;
			};
			h[m] = patched;
			cleanups.push(() => {
				if (h[m] === patched) h[m] = orig;
			});
		}
		on('popstate', navigated);
		navigated();
	};

	const freshState = (out?: boolean): State => {
		const now = Date.now();
		const id = cfg?.cookieless ? COOKIELESS_ID : uuidv7(now);
		return { id, anon: true, sid: uuidv7(now), ss: now, la: now, groups: {}, out };
	};

	const client: TracemarkClient = {
		get config() {
			return cfg;
		},

		init(c) {
			if (!isBrowser()) return client;
			if (cfg) {
				log('already initialised');
				return client;
			}
			if (!c?.apiKey || !c.host) {
				console.warn('[tracemark] init requires apiKey and host');
				return client;
			}
			cfg = {
				autocapturePageviews: true,
				autocaptureClicks: false,
				autocaptureForms: false,
				autocaptureWebVitals: false,
				heatmaps: false,
				persistence: 'localStorage',
				flushIntervalMs: 2000,
				maxBatchSize: 50,
				debug: false,
				respectDnt: false,
				cookieless: false,
				...c,
				host: c.host.replace(/\/+$/, '')
			};
			if (cfg.cookieless) cfg.persistence = 'memory';
			store = createStore(cfg.persistence);
			key = `fp_${cfg.apiKey}`;
			let loaded: Partial<State> | null = null;
			try {
				loaded = JSON.parse(store.get(key) ?? 'null');
			} catch {}
			state =
				loaded?.id && loaded.sid
					? { ...freshState(), ...loaded, groups: loaded.groups ?? {} }
					: freshState();
			checkSession(Date.now(), false);
			installAutocapture();
			log('initialised', cfg);
			notify('init');
			return client;
		},

		capture(event, properties) {
			emit(event, properties);
		},

		aiScore(s) {
			emit('$ai_score', {
				$ai_trace_id: s.traceId,
				$ai_span_id: s.spanId,
				$ai_score_name: s.name,
				$ai_score_value: s.value,
				$ai_score_comment: s.comment
			});
		},

		identify(distinctId, person) {
			if (!ready() || optedOut()) return;
			if (typeof distinctId !== 'string' || !distinctId || distinctId.length > 200) {
				log('invalid distinct id', distinctId);
				return;
			}
			if (distinctId === state.id) {
				if (person?.set || person?.set_once) emit('$set', undefined, { person });
				return;
			}
			const prev = state.id;
			const wasAnon = state.anon;
			state.id = distinctId;
			state.anon = false;
			save();
			emit('$identify', wasAnon ? { $anon_distinct_id: prev } : undefined, { person });
			notify('identity');
		},

		group(type, groupKey, properties) {
			if (!ready() || optedOut()) return;
			if (!type || !groupKey || type.length > 200 || groupKey.length > 200) {
				log('invalid group', type, groupKey);
				return;
			}
			if (!(type in state.groups) && Object.keys(state.groups).length >= MAX_GROUPS) {
				log(`max ${MAX_GROUPS} group types, ignoring`, type);
				return;
			}
			const changed = state.groups[type] !== String(groupKey);
			state.groups[type] = String(groupKey);
			save();
			if (properties && Object.keys(properties).length) {
				emit('$groupidentify', { $group_type: type, $group_key: groupKey, $group_set: properties });
			}
			if (changed) notify('groups');
		},

		setPersonProperties(person) {
			if (person?.set || person?.set_once) emit('$set', undefined, { person });
		},

		reset() {
			if (!ready()) return;
			state = freshState(state.out);
			lastPageUrl = undefined;
			save();
			notify('identity');
		},

		optOut() {
			if (!ready()) return;
			state.out = true;
			queue = [];
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			save();
		},

		optIn() {
			if (!ready()) return;
			state.out = false;
			save();
		},

		hasOptedOut() {
			return ready() ? optedOut() : false;
		},

		flush() {
			if (!ready()) return Promise.resolve();
			flushing = flushing.then(drain, drain);
			return flushing;
		},

		getDistinctId() {
			return ready() ? state.id : undefined;
		},

		getGroups() {
			return ready() ? { ...state.groups } : {};
		},

		getSessionId() {
			if (!ready() || cfg?.cookieless) return undefined;
			checkSession(Date.now(), false);
			return state.sid;
		},

		destroy() {
			for (const fn of cleanups.splice(0)) fn();
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			queue = [];
			cfg = undefined;
		},

		use(plugin) {
			if (plugins.some((p) => p.name === plugin.name)) return client;
			plugins.push(plugin);
			try {
				plugin.setup(client);
			} catch (e) {
				console.warn(`[tracemark] plugin ${plugin.name} failed`, e);
			}
			return client;
		}
	};

	if (config) client.init(config);
	return client;
}
