// Fastify plugin: a per-request tracemark scope as `request.tracemark`, and error capture.
// Pulls Fastify's types into the program so the `request.tracemark` augmentation below applies.
import type {} from 'fastify';
import type { Tracemark, TracemarkScope } from './index';
import { type RequestOptions, type RequestScope, requestScope } from './request';

/** The parts of Fastify's request used here. */
export interface FastifyRequest {
	method: string;
	url: string;
	protocol?: string;
	host?: string;
	headers: Record<string, string | string[] | undefined>;
	tracemark?: TracemarkScope;
}

/** The parts of a Fastify instance used here. */
export interface FastifyInstance {
	decorateRequest(name: 'tracemark', value: null): unknown;
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
	// Types `request.tracemark` in apps that use Fastify.
	interface FastifyRequest {
		tracemark: TracemarkScope;
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
 * `app.register(tracemark(client))` before your routes. Handlers read the request's scope as
 * `request.tracemark`; errors they throw are captured with the request's URL and person.
 */
export function tracemark(client: Tracemark, options: FastifyOptions = {}): Plugin {
	const plugin: Plugin = (instance, _options, done) => {
		instance.decorateRequest('tracemark', null);
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
			request.tracemark = scope.scope;
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
		[Symbol.for('fastify.display-name')]: 'tracemark'
	});
}
