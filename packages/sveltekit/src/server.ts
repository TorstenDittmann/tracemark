// SvelteKit server hooks: a tracemark scope per request as `event.locals.tracemark`, flags to
// bootstrap the browser with, and error capture.
import type { Tracemark, TracemarkScope } from '@tracemark/node';

/** The parts of SvelteKit's `RequestEvent` used here. */
export interface TracemarkEvent {
	url: URL;
	request: Request;
	locals: object;
}

export interface HandleOptions<Event extends TracemarkEvent = TracemarkEvent> {
	/**
	 * Who made the request, such as your signed-in user's id. Defaults to the id the browser SDK
	 * stored in its cookie (`persistence: 'cookie'`).
	 */
	distinctId?: (event: Event) => string | undefined;
}

const scopes = new WeakMap<object, TracemarkScope>();

function scopeFor(client: Tracemark, event: TracemarkEvent, options: HandleOptions) {
	let scope = scopes.get(event.locals);
	if (!scope) {
		let distinctId: string | undefined;
		try {
			distinctId = options.distinctId
				? options.distinctId(event)
				: client.distinctIdFromCookie(event.request.headers.get('cookie'));
		} catch {}
		scope = client.scope(distinctId, {
			properties: { $current_url: event.url.href, $request_method: event.request.method }
		});
		scopes.set(event.locals, scope);
	}
	return scope;
}

/**
 * A `handle` hook that sets `event.locals.tracemark` to the request's scope. Combine it with your
 * own hooks using `sequence()`.
 */
export function tracemarkHandle<Event extends TracemarkEvent>(
	client: Tracemark,
	options: HandleOptions<Event> = {}
) {
	return ({
		event,
		resolve
	}: {
		event: Event;
		resolve: (event: Event) => Response | Promise<Response>;
	}) => {
		(event.locals as { tracemark?: TracemarkScope }).tracemark = scopeFor(
			client,
			event,
			options as HandleOptions
		);
		return resolve(event);
	};
}

/**
 * What `handleError` receives: `kind` in SvelteKit 3, `status` and `message` in SvelteKit 2.
 */
export interface CaughtError {
	error: unknown;
	kind?: string;
	status?: number;
	message?: string;
}

/**
 * Whether an error is a bug worth capturing: SvelteKit 3's `unknown` kind, or anything but a 404
 * in SvelteKit 2. Errors thrown with `error()`, 404s and invalid input are expected.
 */
export const unexpected = (input: CaughtError) =>
	input.kind === undefined ? input.status !== 404 : input.kind === 'unknown';

/**
 * A `handleError` hook that captures unexpected server errors, then returns what `then` returns,
 * so you can still shape the error page.
 */
export function tracemarkHandleError<
	Input extends CaughtError & { event: TracemarkEvent },
	Result = void
>(client: Tracemark, then?: (input: Input) => Result) {
	return (input: Input): Result => {
		if (unexpected(input)) {
			const scope = scopeFor(client, input.event, {});
			client.captureException(input.error, {
				distinctId: scope.distinctId,
				properties: {
					$current_url: input.event.url.href,
					$request_method: input.event.request.method,
					...(input.status ? { $http_status: input.status } : {})
				},
				mechanism: 'sveltekit',
				handled: false
			});
		}
		return then?.(input) as Result;
	};
}

/**
 * Every flag for the request's person, for a root `+layout.server.ts` to pass to the browser's
 * `createFlags({ bootstrap })`. Undefined for a request without a distinct id.
 */
export async function flagsBootstrap(event: TracemarkEvent) {
	const scope = (event.locals as { tracemark?: TracemarkScope }).tracemark;
	if (!scope?.distinctId) return undefined;
	return scope.getAllFlagsAndPayloads();
}

export type { TracemarkScope };
