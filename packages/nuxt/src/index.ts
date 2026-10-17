// Nuxt server helpers: a tracemark scope per request as `event.context.tracemark`, flags to
// bootstrap the browser with, and error capture through Nitro's `error` hook.
// In the browser, use `@tracemark/vue` (see docs/frameworks.md).
import type { Tracemark, TracemarkScope } from '@tracemark/node';

/** The parts of an h3 event used here, in h3 1 (Nuxt 3 and 4) and h3 2. */
export interface TracemarkEvent {
	context: Record<string, unknown>;
	/** h3 2. */
	url?: URL;
	req?: { method: string; headers: Headers };
	/** h3 1. */
	path?: string;
	method?: string;
	headers?: Headers;
}

export interface MiddlewareOptions<Event extends TracemarkEvent = TracemarkEvent> {
	/**
	 * Who made the request, such as your signed-in user's id. Defaults to the id the browser SDK
	 * stored in its cookie (`persistence: 'cookie'`).
	 */
	distinctId?: (event: Event) => string | undefined;
}

function headersOf(event: TracemarkEvent): Headers | undefined {
	return event.req?.headers ?? event.headers;
}

function urlOf(event: TracemarkEvent): string {
	if (event.url) return event.url.href;
	const headers = headersOf(event);
	const host = headers?.get('x-forwarded-host') ?? headers?.get('host');
	const path = event.path ?? '/';
	if (!host) return path;
	const protocol = headers?.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http';
	return `${protocol}://${host}${path}`;
}

const methodOf = (event: TracemarkEvent) => event.req?.method ?? event.method ?? 'GET';

function scopeFor(client: Tracemark, event: TracemarkEvent, options: MiddlewareOptions) {
	const existing = event.context.tracemark as TracemarkScope | undefined;
	if (existing) return existing;
	let distinctId: string | undefined;
	try {
		distinctId = options.distinctId
			? options.distinctId(event)
			: client.distinctIdFromCookie(headersOf(event)?.get('cookie'));
	} catch {}
	const scope = client.scope(distinctId, {
		properties: { $current_url: urlOf(event), $request_method: methodOf(event) }
	});
	event.context.tracemark = scope;
	return scope;
}

/**
 * Server middleware that sets `event.context.tracemark` to the request's scope:
 * `export default defineEventHandler(tracemarkMiddleware(tracemark))` in
 * `server/middleware/tracemark.ts`.
 */
export function tracemarkMiddleware<Event extends TracemarkEvent>(
	client: Tracemark,
	options: MiddlewareOptions<Event> = {}
) {
	return (event: Event): void => {
		scopeFor(client, event, options as MiddlewareOptions);
	};
}

/** Whether an error is a bug worth capturing: anything but a 4xx. */
function unexpected(error: unknown): boolean {
	const status = (error as { statusCode?: unknown; status?: unknown } | null) ?? {};
	const code = Number(status.statusCode ?? status.status);
	return !(code >= 400 && code < 500);
}

/**
 * A handler for Nitro's `error` hook that captures unexpected server errors (not 4xx), with the
 * request's URL and person: `nitroApp.hooks.hook('error', tracemarkErrorHook(tracemark))` in a
 * Nitro plugin.
 */
export function tracemarkErrorHook(client: Tracemark) {
	return (error: unknown, context: { event?: TracemarkEvent } = {}): void => {
		if (!unexpected(error)) return;
		// h3 wraps thrown errors; the original is its `cause`.
		const original = (error as { cause?: unknown } | null)?.cause ?? error;
		const { event } = context;
		const scope = event ? scopeFor(client, event, {}) : undefined;
		client.captureException(original, {
			distinctId: scope?.distinctId,
			properties: event ? { $current_url: urlOf(event), $request_method: methodOf(event) } : {},
			mechanism: 'nuxt',
			handled: false
		});
	};
}

/**
 * Every flag for the request's person, to hand to the browser's `createFlags({ bootstrap })`
 * through `useState`. Undefined for a request without a distinct id.
 */
export async function flagsBootstrap(event: TracemarkEvent | undefined) {
	const scope = event?.context.tracemark as TracemarkScope | undefined;
	if (!scope?.distinctId) return undefined;
	return scope.getAllFlagsAndPayloads();
}

export type { TracemarkScope };
