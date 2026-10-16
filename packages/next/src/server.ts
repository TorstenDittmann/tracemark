// Next.js App Router server side: the visitor's scope from cookies, flags to bootstrap the
// browser with, and `onRequestError` for instrumentation.ts.
import type { Footprint, FootprintScope } from '@footprint/node';

/** What `cookies()` from `next/headers` returns, or a request's `cookies`. */
export interface CookieStore {
	getAll(): { name: string; value: string }[];
}

const header = (cookies: CookieStore) =>
	cookies
		.getAll()
		.map((cookie) => `${cookie.name}=${encodeURIComponent(cookie.value)}`)
		.join('; ');

/**
 * The visitor's scope, from the cookie the browser SDK keeps, or `distinctId` when you know who
 * is signed in: `footprintScope(client, await cookies())`.
 */
export function footprintScope(
	client: Footprint,
	cookies: CookieStore,
	distinctId?: string
): FootprintScope {
	return client.scope(distinctId ?? client.distinctIdFromCookie(header(cookies)));
}

/**
 * Every flag for the visitor, for `<FootprintNextProvider bootstrap={…}>` in your root layout, so
 * the first render already shows the right variant. Undefined for a first-time visitor.
 */
export async function flagsBootstrap(client: Footprint, cookies: CookieStore, distinctId?: string) {
	const scope = footprintScope(client, cookies, distinctId);
	if (!scope.distinctId) return undefined;
	return scope.getAllFlagsAndPayloads();
}

/** The request and context Next.js passes to `onRequestError`. */
export interface RequestErrorInfo {
	path: string;
	method: string;
	headers: Record<string, string | string[] | undefined>;
}

export interface RequestErrorContext {
	routerKind?: string;
	routePath?: string;
	routeType?: string;
	renderSource?: string;
}

/**
 * `export const onRequestError = createOnRequestError(client)` in `instrumentation.ts` captures
 * errors from server components, route handlers, server actions and middleware.
 */
export function createOnRequestError(client: Footprint) {
	return async (error: unknown, request: RequestErrorInfo, context: RequestErrorContext = {}) => {
		const cookie = request.headers.cookie;
		client.captureException(error, {
			distinctId: client.distinctIdFromCookie(Array.isArray(cookie) ? cookie.join('; ') : cookie),
			properties: {
				$request_path: request.path,
				$request_method: request.method,
				$next_router_kind: context.routerKind,
				$next_route_path: context.routePath,
				$next_route_type: context.routeType,
				$next_render_source: context.renderSource,
				$next_digest: (error as { digest?: unknown } | null)?.digest
			},
			mechanism: 'nextjs',
			handled: false
		});
		// Serverless functions can stop right after the response; send it now.
		await client.flush();
	};
}
