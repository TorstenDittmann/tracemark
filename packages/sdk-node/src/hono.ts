// Hono middleware: a per-request footprint scope as `getFootprint(c)`, and error capture.
import type { Footprint, FootprintScope } from './index';
import { type RequestOptions, requestScope } from './request';

/** The parts of Hono's `Context` used here. */
export interface HonoContext {
	req: { url: string; method: string; header(name: string): string | undefined };
	error?: unknown;
	set(key: string, value: unknown): void;
	get(key: string): unknown;
}

export type HonoOptions = RequestOptions<HonoContext>;

/**
 * `app.use(footprint(client))`. Handlers read the request's scope with `getFootprint(c)`;
 * errors a handler throws are captured with the request's URL and person.
 */
export function footprint(client: Footprint, options: HonoOptions = {}) {
	return async (c: HonoContext, next: () => Promise<void>): Promise<void> => {
		const { scope, fail } = requestScope(
			client,
			c,
			{ url: c.req.url, method: c.req.method, cookie: c.req.header('cookie') },
			options,
			'hono'
		);
		c.set('footprint', scope);
		try {
			await next();
		} catch (error) {
			fail(error);
			throw error;
		}
		// Hono catches handler errors itself and leaves them on `c.error`.
		if (c.error) fail(c.error);
	};
}

/** The scope `footprint()` attached to this request. */
export function getFootprint(c: Pick<HonoContext, 'get'>): FootprintScope {
	const scope = c.get('footprint') as FootprintScope | undefined;
	if (!scope) throw new Error('footprint middleware is not installed for this route');
	return scope;
}
