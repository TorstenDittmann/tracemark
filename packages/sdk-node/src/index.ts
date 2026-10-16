import { exceptionList } from '@footprint/errors';
import {
	evaluate,
	type FlagContext,
	type FlagDefinition,
	type FlagResult,
	InconclusiveError,
	parseFlag
} from '@footprint/flags';
import { uuidv7 } from './uuid';
import { VERSION } from './version';

export { VERSION };
export type FlagValue = boolean | string;
export type Properties = Record<string, unknown>;

export interface FootprintOptions {
	/** Public project key (`fp_pub_…`), used to send events and to ask the server for flags. */
	apiKey: string;
	/** Base URL of your footprint instance. Events go to `${host}/e`, flags to `${host}/flags`. */
	host: string;
	/**
	 * Secret project key (`fp_sec_…`). With it, flag definitions are fetched every
	 * `flagsPollIntervalMs` and flags are evaluated in-process, without a request per check.
	 */
	secretKey?: string;
	/** Send once this many events are queued. Default `20`. */
	flushAt?: number;
	/** Send queued events at least this often. Default `10000`. */
	flushIntervalMs?: number;
	/** How often to refresh flag definitions for local evaluation. Default `30000`. */
	flagsPollIntervalMs?: number;
	/** Most events kept while the server can't be reached; older ones are dropped. Default `10000`. */
	maxQueueSize?: number;
	/** Timeout for each request. Default `10000`. */
	requestTimeoutMs?: number;
	/** A `fetch` to use instead of the global one. */
	fetch?: typeof fetch;
	/** Called with errors that would otherwise be swallowed, such as a failed send. */
	onError?: (error: unknown) => void;
	/** Your app's version, sent as `$release` with exceptions. */
	release?: string;
}

/** The parts of Node's `process` used here; also present in Bun and Deno's Node mode. */
interface Runtime {
	on(event: string, listener: (error: unknown) => void): void;
	off(event: string, listener: (error: unknown) => void): void;
	exit(code: number): void;
}

const runtime = () => (globalThis as { process?: Runtime }).process;

export interface ExceptionOptions {
	/** Who ran into it. Defaults to `$server`, so errors outside a request count as one person. */
	distinctId?: string;
	properties?: Properties;
	groups?: Record<string, string>;
}

export interface CaptureMessage {
	distinctId: string;
	event: string;
	properties?: Properties;
	/** Group type to key, such as `{ company: 'acme' }`. */
	groups?: Record<string, string>;
	/** Person properties to set with this event. */
	set?: Properties;
	setOnce?: Properties;
	timestamp?: Date;
	/** Dedup id; one is generated when left out. */
	uuid?: string;
}

export interface FlagOptions {
	personProperties?: Properties;
	groups?: Record<string, string>;
	groupProperties?: Record<string, Properties>;
	/** Capture `$feature_flag_called` the first time this person gets this value. Default `true`. */
	sendExposure?: boolean;
	/** Never ask the server: flags that can't be decided locally come back off. Default `false`. */
	onlyLocal?: boolean;
}

interface WireEvent {
	uuid: string;
	event: string;
	distinct_id: string;
	timestamp: string;
	properties: Properties;
	person?: { set?: Properties; set_once?: Properties };
	groups?: Record<string, string>;
}

const MAX_EXPOSURES = 50_000;
const BATCH = 1000;

/** A footprint client for servers. Create one per process and call `shutdown()` before exit. */
export class Footprint {
	readonly #options: Required<
		Omit<FootprintOptions, 'secretKey' | 'fetch' | 'onError' | 'release'>
	> &
		Pick<FootprintOptions, 'secretKey' | 'onError' | 'release'>;
	readonly #fetch: typeof fetch;
	#queue: WireEvent[] = [];
	#sending: Promise<void> = Promise.resolve();
	#flushTimer: ReturnType<typeof setInterval> | undefined;
	#pollTimer: ReturnType<typeof setInterval> | undefined;
	#definitions: FlagDefinition[] | undefined;
	#loadingDefinitions: Promise<void> | undefined;
	#exposed = new Set<string>();
	#closed = false;

	constructor(options: FootprintOptions) {
		if (!options?.apiKey || !options.host) throw new Error('footprint needs apiKey and host');
		this.#options = {
			flushAt: 20,
			flushIntervalMs: 10_000,
			flagsPollIntervalMs: 30_000,
			maxQueueSize: 10_000,
			requestTimeoutMs: 10_000,
			...options,
			host: options.host.replace(/\/+$/, '')
		};
		this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
		this.#flushTimer = setInterval(() => void this.flush(), this.#options.flushIntervalMs);
		unref(this.#flushTimer);
		if (options.secretKey) {
			void this.reloadFlags();
			this.#pollTimer = setInterval(
				() => void this.reloadFlags(),
				this.#options.flagsPollIntervalMs
			);
			unref(this.#pollTimer);
		}
	}

	#error(error: unknown) {
		try {
			this.#options.onError?.(error);
		} catch {}
	}

	async #request(path: string, init: RequestInit): Promise<Response> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.#options.requestTimeoutMs);
		try {
			return await this.#fetch(`${this.#options.host}${path}`, {
				...init,
				signal: controller.signal
			});
		} finally {
			clearTimeout(timer);
		}
	}

	/** Queues an event. Events are sent in batches; `flush()` sends what's queued now. */
	capture(message: CaptureMessage): void {
		if (this.#closed) return;
		const { distinctId, event } = message;
		if (typeof distinctId !== 'string' || !distinctId || distinctId.length > 200) {
			this.#error(new Error(`invalid distinctId for ${event}`));
			return;
		}
		if (typeof event !== 'string' || !event || event.length > 200) {
			this.#error(new Error(`invalid event name ${String(event)}`));
			return;
		}
		const timestamp = message.timestamp ?? new Date();
		const wire: WireEvent = {
			uuid: message.uuid ?? uuidv7(timestamp.getTime()),
			event,
			distinct_id: distinctId,
			timestamp: timestamp.toISOString(),
			properties: { $lib: 'footprint-node', $lib_version: VERSION, ...message.properties }
		};
		if (message.set || message.setOnce) {
			wire.person = {};
			if (message.set) wire.person.set = message.set;
			if (message.setOnce) wire.person.set_once = message.setOnce;
		}
		if (message.groups && Object.keys(message.groups).length) wire.groups = message.groups;
		this.#queue.push(wire);
		if (this.#queue.length > this.#options.maxQueueSize) {
			this.#queue.splice(0, this.#queue.length - this.#options.maxQueueSize);
		}
		if (this.#queue.length >= this.#options.flushAt) void this.flush();
	}

	/** Sets person properties. */
	identify(message: { distinctId: string; set?: Properties; setOnce?: Properties }): void {
		this.capture({ ...message, event: '$set' });
	}

	/** Merges an earlier id (such as an anonymous browser id) into `distinctId`'s person. */
	alias(message: { distinctId: string; alias: string }): void {
		this.capture({
			distinctId: message.distinctId,
			event: '$identify',
			properties: { $anon_distinct_id: message.alias }
		});
	}

	/** Sets a group's properties. */
	groupIdentify(message: {
		groupType: string;
		groupKey: string;
		properties: Properties;
		/** Who to attribute the event to. Default `$<type>_<key>`. */
		distinctId?: string;
	}): void {
		this.capture({
			distinctId: message.distinctId ?? `$${message.groupType}_${message.groupKey}`,
			event: '$groupidentify',
			properties: {
				$group_type: message.groupType,
				$group_key: message.groupKey,
				$group_set: message.properties
			},
			groups: { [message.groupType]: message.groupKey }
		});
	}

	/** Sends everything queued. Failed batches stay queued for the next flush. */
	flush(): Promise<void> {
		this.#sending = this.#sending.then(() => this.#drain());
		return this.#sending;
	}

	async #drain(): Promise<void> {
		while (this.#queue.length) {
			const batch = this.#queue.slice(0, BATCH);
			let res: Response;
			try {
				res = await this.#request('/e', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						api_key: this.#options.apiKey,
						sent_at: new Date().toISOString(),
						batch
					})
				});
			} catch (error) {
				this.#error(error);
				return;
			}
			if (res.status >= 500 || res.status === 429) {
				this.#error(new Error(`sending events failed with HTTP ${res.status}`));
				return;
			}
			// Sent, or rejected for good (4xx): either way these leave the queue.
			this.#queue.splice(0, batch.length);
			if (res.status >= 400) {
				this.#error(new Error(`events rejected with HTTP ${res.status}: ${await res.text()}`));
			}
		}
	}

	/** Fetches flag definitions for local evaluation now. Needs `secretKey`. */
	reloadFlags(): Promise<void> {
		if (!this.#options.secretKey) return Promise.resolve();
		this.#loadingDefinitions = (async () => {
			try {
				const res = await this.#request('/flags/definitions', {
					headers: { authorization: `Bearer ${this.#options.secretKey}` }
				});
				if (!res.ok) throw new Error(`loading flag definitions failed with HTTP ${res.status}`);
				const body = (await res.json()) as { flags?: unknown[] };
				const flags: FlagDefinition[] = [];
				for (const raw of body.flags ?? []) {
					try {
						flags.push(parseFlag(raw));
					} catch (error) {
						this.#error(error);
					}
				}
				this.#definitions = flags;
			} catch (error) {
				// Keep the last definitions we had.
				this.#error(error);
			}
		})();
		return this.#loadingDefinitions;
	}

	async #remote(distinctId: string, options: FlagOptions) {
		const res = await this.#request('/flags', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				api_key: this.#options.apiKey,
				distinct_id: distinctId,
				person_properties: options.personProperties,
				groups: options.groups,
				group_properties: options.groupProperties
			})
		});
		if (!res.ok) throw new Error(`evaluating flags failed with HTTP ${res.status}`);
		return (await res.json()) as {
			flags: Record<string, FlagValue>;
			payloads: Record<string, unknown>;
		};
	}

	/**
	 * Every flag's value and payload for a person. Flags are decided locally when possible;
	 * the rest are asked of the server in one request.
	 */
	getAllFlagsAndPayloads(
		distinctId: string,
		options: FlagOptions = {}
	): Promise<{ flags: Record<string, FlagValue>; payloads: Record<string, unknown> }> {
		return this.#decide(distinctId, options);
	}

	/** Evaluates every flag, or only `only`, locally where possible and remotely otherwise. */
	async #decide(distinctId: string, options: FlagOptions, only?: string) {
		if (this.#options.secretKey && !this.#definitions) await this.#loadingDefinitions;
		const flags: Record<string, FlagValue> = {};
		const payloads: Record<string, unknown> = {};
		let needServer = !this.#definitions;
		if (this.#definitions) {
			const context: FlagContext = {
				distinctId,
				personProperties: options.personProperties ?? {},
				groups: options.groups ?? {},
				groupProperties: options.groupProperties ?? {}
			};
			for (const flag of this.#definitions) {
				if (only !== undefined && flag.key !== only) continue;
				let result: FlagResult;
				try {
					result = evaluate(flag, context, { missing: 'inconclusive' });
				} catch (error) {
					if (!(error instanceof InconclusiveError)) throw error;
					needServer = true;
					continue;
				}
				flags[flag.key] = result.value;
				if (result.payload !== null) payloads[flag.key] = result.payload;
			}
		}
		if (needServer && !options.onlyLocal) {
			try {
				const remote = await this.#remote(distinctId, options);
				// Locally decided values agree with the server's; the server fills in the rest.
				for (const [key, value] of Object.entries(remote.flags)) {
					if (!(key in flags)) flags[key] = value;
				}
				for (const [key, payload] of Object.entries(remote.payloads ?? {})) {
					if (!(key in payloads) && flags[key] === remote.flags[key]) payloads[key] = payload;
				}
			} catch (error) {
				this.#error(error);
			}
		}
		return { flags, payloads };
	}

	/** Every flag's value for a person, without recording exposures. */
	async getAllFlags(distinctId: string, options: FlagOptions = {}) {
		return (await this.getAllFlagsAndPayloads(distinctId, options)).flags;
	}

	/** A flag's value for a person: `false` when off, `true` or the variant when on. */
	async getFlag(key: string, distinctId: string, options: FlagOptions = {}): Promise<FlagValue> {
		const { flags } = await this.#decide(distinctId, options, key);
		const value = flags[key] ?? false;
		if (options.sendExposure !== false) this.#expose(key, value, distinctId, options.groups);
		return value;
	}

	/** Whether a flag is on for a person. */
	async isEnabled(key: string, distinctId: string, options: FlagOptions = {}): Promise<boolean> {
		return (await this.getFlag(key, distinctId, options)) !== false;
	}

	/** The JSON payload served with a flag's current value for a person. */
	async getPayload(key: string, distinctId: string, options: FlagOptions = {}): Promise<unknown> {
		const { flags, payloads } = await this.#decide(distinctId, options, key);
		const value = flags[key] ?? false;
		if (options.sendExposure !== false) this.#expose(key, value, distinctId, options.groups);
		return value === false ? undefined : payloads[key];
	}

	#expose(key: string, value: FlagValue, distinctId: string, groups?: Record<string, string>) {
		const seen = `${distinctId}\u0000${key}\u0000${String(value)}`;
		if (this.#exposed.has(seen)) return;
		if (this.#exposed.size >= MAX_EXPOSURES) this.#exposed.clear();
		this.#exposed.add(seen);
		this.capture({
			distinctId,
			event: '$feature_flag_called',
			properties: { $feature_flag: key, $feature_flag_response: value },
			groups
		});
	}

	/** Stops the timers and sends what's queued. Call it before the process exits. */
	/** Captures an error as a `$exception` event. */
	captureException(error: unknown, options: ExceptionOptions = {}): void {
		this.#exception(error, options, 'manual', true);
	}

	#exception(error: unknown, options: ExceptionOptions, mechanism: string, handled: boolean) {
		this.capture({
			distinctId: options.distinctId ?? '$server',
			event: '$exception',
			groups: options.groups,
			properties: {
				...options.properties,
				$exception_list: exceptionList(error, { mechanism, handled }),
				$exception_level: handled ? 'error' : 'fatal',
				...(this.#options.release ? { $release: this.#options.release } : {})
			}
		});
	}

	/**
	 * Captures errors nothing caught (`uncaughtException` and `unhandledRejection`), sends what's
	 * queued, then exits with code 1 as Node would. Returns a function that removes the handlers.
	 */
	captureUncaughtExceptions(): () => void {
		const crash = (mechanism: string) => async (error: unknown) => {
			this.#exception(error, {}, mechanism, false);
			try {
				await this.shutdown();
			} finally {
				console.error(error);
				runtime()?.exit(1);
			}
		};
		const proc = runtime();
		if (!proc) return () => {};
		const onException = crash('uncaughtException');
		const onRejection = crash('unhandledRejection');
		proc.on('uncaughtException', onException);
		proc.on('unhandledRejection', onRejection);
		return () => {
			proc.off('uncaughtException', onException);
			proc.off('unhandledRejection', onRejection);
		};
	}

	async shutdown(): Promise<void> {
		this.#closed = true;
		clearInterval(this.#flushTimer);
		clearInterval(this.#pollTimer);
		await this.flush();
	}
}

/** Lets the process exit while timers are pending (Node and Bun; a no-op elsewhere). */
function unref(timer: unknown) {
	(timer as { unref?: () => void } | undefined)?.unref?.();
}
