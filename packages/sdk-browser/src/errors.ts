// Error tracking plugin: captures `$exception` events for errors nothing caught, and for errors
// passed to `captureException`. See docs/errors.md for the event's shape.
import { exceptionList } from '@footprint/errors';
import type { Plugin } from './client';
import type { Properties } from './properties';

export interface ErrorsOptions {
	/** Capture errors nothing caught (`error` and `unhandledrejection` on window). Default `true`. */
	autocapture?: boolean;
	/** Your app's version, matched against uploaded source maps. Sent as `$release`. */
	release?: string;
	/** Errors whose message contains one of these strings, or matches one of these patterns, are dropped. */
	ignore?: (string | RegExp)[];
	/** Which frames are your app's code. Defaults to scripts from the page's own origin. */
	inApp?: (filename: string) => boolean;
}

export interface CaptureOptions {
	/** What caught it, such as `react-error-boundary`. Default `manual`. */
	mechanism?: string;
	/** Whether your code handled it; unhandled errors are `fatal`. Default `true`. */
	handled?: boolean;
}

export interface Errors extends Plugin {
	/** Captures an error you caught, with optional extra properties. */
	captureException(error: unknown, properties?: Properties, options?: CaptureOptions): void;
}

/** Errors captured before the plugin is added to a client, kept until it is. */
const MAX_EARLY = 10;

/** The same error captured more often than this on one page is dropped, so a loop can't flood. */
const MAX_REPEATS = 5;

/** Creates the errors plugin; pass it to `footprint.use()`. */
export function createErrors(options: ErrorsOptions = {}): Errors {
	let capture: ((event: string, properties: Properties) => void) | undefined;
	// A component can throw before the effect that adds the plugin runs; keep those few errors.
	const early: Properties[] = [];
	const counts = new Map<string, number>();
	const inApp =
		options.inApp ??
		((filename: string) => typeof location !== 'undefined' && filename.startsWith(location.origin));

	const send = (error: unknown, mechanism: string, handled: boolean, extra?: Properties) => {
		const list = exceptionList(error, { mechanism, handled, inApp });
		const [first] = list;
		if (!first) return;
		const message = `${first.type}: ${first.value}`;
		if (
			options.ignore?.some((rule) =>
				// `search` ignores the g and y flags; `test` would carry lastIndex between errors.
				typeof rule === 'string' ? message.includes(rule) : message.search(rule) !== -1
			)
		) {
			return;
		}
		const top = first.stacktrace?.frames[0];
		const key = `${message}\u0000${top?.filename}:${top?.lineno}:${top?.colno}`;
		const count = (counts.get(key) ?? 0) + 1;
		counts.set(key, count);
		if (count > MAX_REPEATS) return;
		const properties = {
			...extra,
			$exception_list: list,
			$exception_level: handled ? 'error' : 'fatal',
			...(options.release ? { $release: options.release } : {})
		};
		if (capture) capture('$exception', properties);
		else if (early.length < MAX_EARLY) early.push(properties);
	};

	const onError = (event: ErrorEvent) => {
		// Errors from other origins arrive as a bare "Script error." with nothing to go on.
		if (!event.error && /^Script error\.?$/.test(event.message)) return;
		send(event.error ?? event.message, 'onerror', false);
	};
	const onRejection = (event: PromiseRejectionEvent) => {
		send(event.reason, 'onunhandledrejection', false);
	};

	return {
		name: 'errors',
		setup(client) {
			capture = (event, properties) => client.capture(event, properties);
			for (const properties of early.splice(0)) capture('$exception', properties);
			if (options.autocapture !== false && typeof window !== 'undefined') {
				window.addEventListener('error', onError);
				window.addEventListener('unhandledrejection', onRejection);
			}
		},
		captureException(error, properties, how = {}) {
			send(error, how.mechanism ?? 'manual', how.handled ?? true, properties);
		}
	};
}
