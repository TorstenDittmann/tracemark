// Feature flags plugin: fetches every flag for the current person from `POST /flags` (see
// docs/flags-api.md), caches the answer for the next page load, and records exposures.
import type { FootprintClient, Plugin } from './client';
import type { Properties } from './properties';

export type FlagValue = boolean | string;

export interface FlagsSnapshot {
	flags: Record<string, FlagValue>;
	payloads?: Record<string, unknown>;
}

export interface FlagsOptions {
	/**
	 * Flags evaluated on your server for this page, so the first render needs no request.
	 * Used until the first fetch answers.
	 */
	bootstrap?: FlagsSnapshot;
	/** Where `POST /flags` is served. Defaults to the client's `host`. */
	host?: string;
	/** Person properties to evaluate with, on top of the ones stored for the person. */
	personProperties?: Properties;
	/** Capture `$feature_flag_called` the first time each flag is read. Default `true`. */
	sendExposures?: boolean;
}

export interface Flags extends Plugin {
	/** Whether a flag is on: `true`, or any variant. Unknown flags are off. */
	isEnabled(key: string): boolean;
	/** A multivariate flag's variant, `true` for an enabled boolean flag, or `false` when off. */
	getFlag(key: string): FlagValue;
	/** The JSON payload served with a flag's current value. */
	getPayload(key: string): unknown;
	/** Every flag's value, without recording exposures. */
	getAll(): Record<string, FlagValue>;
	/** Resolves once flags were fetched (or the fetch failed) for the current person. */
	ready(): Promise<void>;
	/** Fetches the flags again. */
	reload(): Promise<void>;
	/** Merges person properties into those sent for evaluation and fetches again. */
	setPersonProperties(properties: Properties): Promise<void>;
	/** Calls `listener` whenever the flags change. Returns a function that stops it. */
	onChange(listener: (flags: Record<string, FlagValue>) => void): () => void;
}

const isSnapshot = (value: unknown): value is FlagsSnapshot =>
	typeof value === 'object' &&
	value !== null &&
	typeof (value as FlagsSnapshot).flags === 'object' &&
	(value as FlagsSnapshot).flags !== null;

/** Creates the flags plugin; pass it to `footprint.use()`. */
export function createFlags(options: FlagsOptions = {}): Flags {
	let client: FootprintClient | undefined;
	let snapshot: FlagsSnapshot = options.bootstrap ?? { flags: {} };
	let properties: Properties = { ...options.personProperties };
	/** Distinct id the current snapshot is for; exposures are recorded once per id. */
	let owner: string | undefined;
	/** The snapshot is still the server's bootstrap, which was evaluated for this visitor. */
	let bootstrapped = options.bootstrap !== undefined;
	let exposed = new Set<string>();
	let request = 0;
	let markReady: () => void = () => {};
	/** Settles when the latest fetch does; the first one waits for `init`. */
	let loading = new Promise<void>((resolve) => {
		markReady = resolve;
	});
	const listeners = new Set<(flags: Record<string, FlagValue>) => void>();

	const cacheKey = () => (client?.config ? `fp_flags_${client.config.apiKey}` : '');
	const storage = () => {
		if (client?.config?.persistence !== 'localStorage') return undefined;
		try {
			return window.localStorage;
		} catch {
			return undefined;
		}
	};

	const set = (next: FlagsSnapshot, id: string | undefined) => {
		// A new person counts as a change even with the same flags, so their reads get recorded.
		const changed = JSON.stringify(next) !== JSON.stringify(snapshot) || id !== owner;
		snapshot = next;
		bootstrapped = false;
		if (id !== owner) exposed = new Set();
		owner = id;
		if (changed) {
			for (const listener of listeners) {
				try {
					listener({ ...snapshot.flags });
				} catch {}
			}
		}
	};

	const fetchFlags = async () => {
		const config = client?.config;
		const id = client?.getDistinctId();
		if (!client || !config || !id || client.hasOptedOut()) return;
		const mine = ++request;
		try {
			const res = await fetch(`${(options.host ?? config.host).replace(/\/+$/, '')}/flags`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					api_key: config.apiKey,
					distinct_id: id,
					person_properties: properties,
					groups: client.getGroups()
				})
			});
			const body: unknown = res.ok ? await res.json() : null;
			// A newer request (another identify) wins over this one.
			if (mine !== request || !isSnapshot(body)) return;
			const next = { flags: body.flags, payloads: body.payloads ?? {} };
			set(next, id);
			try {
				storage()?.setItem(cacheKey(), JSON.stringify({ id, ...next }));
			} catch {}
		} catch {
			// Keep what we have; the next identity change or reload tries again.
		}
	};

	const load = () => {
		loading = fetchFlags().then(markReady);
		return loading;
	};

	const read = (key: string): FlagValue => {
		const value = snapshot.flags[key] ?? false;
		const id = client?.getDistinctId();
		const seen = `${key}\u0000${String(value)}`;
		// Only values meant for this person are exposures. Before the first answer (or after an
		// identify, until the next one) every flag reads as a placeholder; recording those would
		// put people in an experiment as `false` before they saw anything.
		const current = id !== undefined && (owner === id || (owner === undefined && bootstrapped));
		if (client && options.sendExposures !== false && current && !exposed.has(seen)) {
			exposed.add(seen);
			client.capture('$feature_flag_called', {
				$feature_flag: key,
				$feature_flag_response: value
			});
		}
		return value;
	};

	const changed = (reason: 'init' | 'identity' | 'groups') => {
		if (reason === 'init' && !options.bootstrap) {
			// Last page load's answer for the same person, until the fetch returns.
			try {
				const cached: unknown = JSON.parse(storage()?.getItem(cacheKey()) ?? 'null');
				const id = client?.getDistinctId();
				if (isSnapshot(cached) && (cached as { id?: string }).id === id) {
					set({ flags: cached.flags, payloads: cached.payloads ?? {} }, id);
				}
			} catch {}
		}
		void load();
	};

	return {
		name: 'flags',

		setup(c) {
			client = c;
			if (c.config) changed('init');
		},

		changed,

		isEnabled: (key) => read(key) !== false,
		getFlag: read,
		getPayload(key) {
			const value = read(key);
			return value === false ? undefined : snapshot.payloads?.[key];
		},
		getAll: () => ({ ...snapshot.flags }),
		// Nothing to wait for on the server, where `init` never runs.
		ready: () => (typeof window === 'undefined' ? Promise.resolve() : loading),
		reload: load,
		setPersonProperties(next) {
			properties = { ...properties, ...next };
			return load();
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}
