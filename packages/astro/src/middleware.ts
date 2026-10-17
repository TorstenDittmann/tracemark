// Astro middleware: a tracemark scope per request as `Astro.locals.tracemark`, and error capture.
import type { Tracemark, TracemarkScope } from '@tracemark/node';

/** The parts of Astro's `APIContext` used here. */
export interface TracemarkContext {
	request: Request;
	url: URL;
	locals: object;
}

export interface MiddlewareOptions<Context extends TracemarkContext = TracemarkContext> {
	/**
	 * Who made the request, such as your signed-in user's id. Defaults to the id the browser SDK
	 * stored in its cookie (`persistence: 'cookie'`).
	 */
	distinctId?: (context: Context) => string | undefined;
	/** Capture errors thrown while rendering as `$exception` events. Default `true`. */
	captureErrors?: boolean;
}

/**
 * `export const onRequest = tracemarkMiddleware(tracemark)` in `src/middleware.ts` (or inside
 * `sequence()`). Pages and endpoints read the request's scope as `Astro.locals.tracemark`.
 */
export function tracemarkMiddleware<Context extends TracemarkContext>(
	client: Tracemark,
	options: MiddlewareOptions<Context> = {}
) {
	return async (context: Context, next: () => Promise<Response>): Promise<Response> => {
		let distinctId: string | undefined;
		try {
			distinctId = options.distinctId
				? options.distinctId(context)
				: client.distinctIdFromCookie(context.request.headers.get('cookie'));
		} catch {}
		const properties = {
			$current_url: context.url.href,
			$request_method: context.request.method
		};
		(context.locals as { tracemark?: TracemarkScope }).tracemark = client.scope(distinctId, {
			properties
		});
		try {
			return await next();
		} catch (error) {
			if (options.captureErrors !== false) {
				client.captureException(error, {
					distinctId,
					properties,
					mechanism: 'astro',
					handled: false
				});
			}
			throw error;
		}
	};
}

/**
 * Every flag for the request's person, for a page that hands them to client code. Undefined for a
 * request without a distinct id.
 */
export async function flagsBootstrap(context: Pick<TracemarkContext, 'locals'>) {
	const scope = (context.locals as { tracemark?: TracemarkScope }).tracemark;
	if (!scope?.distinctId) return undefined;
	return scope.getAllFlagsAndPayloads();
}

export type { TracemarkScope };
