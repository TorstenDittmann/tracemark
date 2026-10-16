// Fastify plugin: a per-request footprint scope as `request.footprint`, and error capture.
// Pulls Fastify's types into the program so the `request.footprint` augmentation below applies.
import type {} from 'fastify';
import type { Footprint, FootprintScope } from './index';
import { type RequestOptions, type RequestScope, requestScope } from './request';

/** The parts of Fastify's request used here. */
export interface FastifyRequest {
	method: string;
	url: string;
	protocol?: string;
	host?: string;
	headers: Record<string, string | string[] | undefined>;
	footprint?: FootprintScope;
}

/** The parts of a Fastify instance used here. */
export interface FastifyInstance {
	decorateRequest(name: 'footprint', value: null): unknown;
	addHook(
		name: 'onRequest',
		hook: (request: FastifyRequest, reply: unknown, done: () => void) => void
	): unknown;
	addHook(
		name: 'onError',
		hook: (request: FastifyRequest, reply: unknown, error: unknown, done: () => void) => void
	): unknown;
}

declare module 'fastify' {
	// Types `request.footprint` in apps that use Fastify.
	interface FastifyRequest {
		footprint: FootprintScope;
	}
}

export type FastifyOptions = RequestOptions<FastifyRequest>;

type Plugin = (instance: FastifyInstance, options: unknown, done: () => void) => void;

const scopes = new WeakMap<object, RequestScope>();

function fullUrl(request: FastifyRequest): string {
	const host = request.host ?? request.headers.host;
	return typeof host === 'string'
		? `${request.protocol ?? 'http'}://${host}${request.url}`
		: request.url;
}

/**
 * `app.register(footprint(client))` before your routes. Handlers read the request's scope as
 * `request.footprint`; errors they throw are captured with the request's URL and person.
 */
export function footprint(client: Footprint, options: FastifyOptions = {}): Plugin {
	const plugin: Plugin = (instance, _options, done) => {
		instance.decorateRequest('footprint', null);
		instance.addHook('onRequest', (request, _reply, next) => {
			const cookie = request.headers.cookie;
			const scope = requestScope(
				client,
				request,
				{
					url: fullUrl(request),
					method: request.method,
					cookie: Array.isArray(cookie) ? cookie.join('; ') : cookie
				},
				options,
				'fastify'
			);
			scopes.set(request, scope);
			request.footprint = scope.scope;
			next();
		});
		instance.addHook('onError', (request, _reply, error, next) => {
			scopes.get(request)?.fail(error);
			next();
		});
		done();
	};
	// Like fastify-plugin: the hooks apply to the whole app, not just this plugin's scope.
	return Object.assign(plugin, {
		[Symbol.for('skip-override')]: true,
		[Symbol.for('fastify.display-name')]: 'footprint'
	});
}
