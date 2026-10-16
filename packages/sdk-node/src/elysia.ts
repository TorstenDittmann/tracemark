// Elysia plugin: a per-request footprint scope as `footprint` in handlers, and error capture.
import { Elysia } from 'elysia';
import type { Footprint, FootprintScope } from './index';
import { type RequestOptions, type RequestScope, requestScope } from './request';

export type ElysiaOptions = RequestOptions<Request>;

/** Error codes for requests that went wrong in an expected way, not bugs. */
const EXPECTED = new Set(['NOT_FOUND', 'VALIDATION', 'PARSE', 'INVALID_COOKIE_SIGNATURE']);

/**
 * `app.use(footprint(client))` before your routes. Handlers read the request's scope as
 * `footprint` from their context; errors they throw are captured, apart from 404s, validation
 * and parse errors.
 */
export function footprint(client: Footprint, options: ElysiaOptions = {}) {
	const scopes = new WeakMap<Request, RequestScope>();
	const scopeFor = (request: Request): RequestScope => {
		let scope = scopes.get(request);
		if (!scope) {
			scope = requestScope(
				client,
				request,
				{ url: request.url, method: request.method, cookie: request.headers.get('cookie') },
				options,
				'elysia'
			);
			scopes.set(request, scope);
		}
		return scope;
	};
	return new Elysia({ name: 'footprint' })
		.derive({ as: 'global' }, ({ request }): { footprint: FootprintScope } => ({
			footprint: scopeFor(request).scope
		}))
		.onError({ as: 'global' }, ({ request, error, code }) => {
			if (typeof code === 'string' && EXPECTED.has(code)) return;
			scopeFor(request).fail(error);
		});
}
