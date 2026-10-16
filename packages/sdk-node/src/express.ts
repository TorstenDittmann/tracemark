// Express middleware: a per-request footprint scope as `req.footprint`, and an error handler.
import type { Footprint, FootprintScope } from './index';
import { type RequestOptions, type RequestScope, requestScope } from './request';

/** The parts of Express's request used here. */
export interface ExpressRequest {
	method: string;
	originalUrl?: string;
	url: string;
	protocol?: string;
	headers: Record<string, string | string[] | undefined>;
	footprint?: FootprintScope;
}

declare global {
	// Types `req.footprint` in apps that use @types/express.
	namespace Express {
		interface Request {
			footprint?: FootprintScope;
		}
	}
}

export type ExpressOptions = RequestOptions<ExpressRequest>;

const scopes = new WeakMap<object, RequestScope>();

function fullUrl(req: ExpressRequest): string {
	const host = req.headers.host;
	const path = req.originalUrl ?? req.url;
	return typeof host === 'string' ? `${req.protocol ?? 'http'}://${host}${path}` : path;
}

/**
 * `app.use(footprint(client))` before your routes. Handlers read the request's scope as
 * `req.footprint`. Add `footprintErrorHandler(client)` after your routes to capture errors.
 */
export function footprint(client: Footprint, options: ExpressOptions = {}) {
	return (req: ExpressRequest, _res: unknown, next: (error?: unknown) => void): void => {
		const cookie = req.headers.cookie;
		const scope = requestScope(
			client,
			req,
			{
				url: fullUrl(req),
				method: req.method,
				cookie: Array.isArray(cookie) ? cookie.join('; ') : cookie
			},
			options,
			'express'
		);
		scopes.set(req, scope);
		req.footprint = scope.scope;
		next();
	};
}

/**
 * Error middleware that captures the error and passes it on to your own error handling. Express
 * knows error middleware by its four parameters, so keep it as returned.
 */
export function footprintErrorHandler(client: Footprint) {
	return (
		error: unknown,
		req: ExpressRequest,
		_res: unknown,
		next: (error?: unknown) => void
	): void => {
		const scope = scopes.get(req);
		if (scope) scope.fail(error);
		else
			client.captureException(error, {
				properties: { $current_url: fullUrl(req), $request_method: req.method },
				mechanism: 'express',
				handled: false
			});
		next(error);
	};
}
