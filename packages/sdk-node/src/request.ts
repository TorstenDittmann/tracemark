// Shared by the framework middleware: who a request is from and what to attach to its errors.
import type { Footprint, FootprintScope, Properties } from './index';

export interface RequestOptions<Request> {
	/**
	 * Who made the request, such as your signed-in user's id. Defaults to the id the browser SDK
	 * stored in its cookie (`persistence: 'cookie'`); undefined means nobody in particular.
	 */
	distinctId?: (request: Request) => string | undefined;
	/** Capture errors that reach the middleware as `$exception` events. Default `true`. */
	captureErrors?: boolean;
}

export interface RequestInfo {
	url: string;
	method: string;
	cookie: string | null | undefined;
}

export interface RequestScope {
	scope: FootprintScope;
	/** Captures an error that escaped the request's handlers. */
	fail(error: unknown): void;
}

export function requestScope<Request>(
	client: Footprint,
	request: Request,
	info: RequestInfo,
	options: RequestOptions<Request>,
	mechanism: string
): RequestScope {
	let distinctId: string | undefined;
	try {
		distinctId = options.distinctId
			? options.distinctId(request)
			: client.distinctIdFromCookie(info.cookie);
	} catch {}
	const properties: Properties = { $current_url: info.url, $request_method: info.method };
	return {
		scope: client.scope(distinctId, { properties }),
		fail(error) {
			if (options.captureErrors === false) return;
			client.captureException(error, { distinctId, properties, mechanism, handled: false });
		}
	};
}
