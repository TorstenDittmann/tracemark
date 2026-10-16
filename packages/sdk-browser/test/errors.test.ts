import { describe, expect, it } from 'vitest';
import { createErrors } from '../src/errors';
import { make, mockFetch, sentEvents } from './helpers';

const exceptions = (f: ReturnType<typeof mockFetch>) =>
	sentEvents(f).filter((e) => e.event === '$exception');

describe('errors plugin', () => {
	it('captures errors you pass it, with extra properties and the release', async () => {
		const f = mockFetch();
		const errors = createErrors({ release: '1.2.3' });
		const client = make().use(errors);
		errors.captureException(new TypeError('bad input'), { form: 'signup' });
		await client.flush();
		const [event] = exceptions(f);
		expect(event?.properties).toMatchObject({
			form: 'signup',
			$release: '1.2.3',
			$exception_level: 'error',
			$exception_list: [
				{ type: 'TypeError', value: 'bad input', mechanism: { type: 'manual', handled: true } }
			]
		});
		expect(event?.properties?.$current_url).toBeDefined();
	});

	it('captures errors nothing caught', async () => {
		const f = mockFetch();
		const client = make().use(createErrors());
		window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom'), message: 'boom' }));
		const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
		Object.defineProperty(rejection, 'reason', { value: 'nope' });
		window.dispatchEvent(rejection);
		// Cross-origin script errors carry nothing useful.
		window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
		await client.flush();
		expect(
			exceptions(f).map((e) => {
				const [first] = (e.properties?.$exception_list ?? []) as {
					value: string;
					mechanism: unknown;
				}[];
				return [first?.value, first?.mechanism, e.properties?.$exception_level];
			})
		).toEqual([
			['boom', { type: 'onerror', handled: false }, 'fatal'],
			['nope', { type: 'onunhandledrejection', handled: false }, 'fatal']
		]);
	});

	it('can leave uncaught errors alone', async () => {
		const f = mockFetch();
		const client = make().use(createErrors({ autocapture: false }));
		window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom') }));
		await client.flush();
		expect(exceptions(f)).toEqual([]);
	});

	it('drops ignored errors and repeats of the same error', async () => {
		const f = mockFetch();
		const errors = createErrors({ ignore: ['ResizeObserver', /^AbortError/] });
		const client = make().use(errors);
		errors.captureException(new Error('ResizeObserver loop limit exceeded'));
		const abort = new Error('aborted');
		abort.name = 'AbortError';
		errors.captureException(abort);
		const loop = new Error('again');
		for (let i = 0; i < 20; i++) errors.captureException(loop);
		await client.flush();
		expect(exceptions(f)).toHaveLength(5);
	});

	it('drops every match of a global pattern', async () => {
		const f = mockFetch();
		const errors = createErrors({ ignore: [/AbortError/g] });
		const client = make().use(errors);
		for (const message of ['first', 'second', 'third']) {
			const abort = new Error(message);
			abort.name = 'AbortError';
			errors.captureException(abort);
		}
		await client.flush();
		expect(exceptions(f)).toEqual([]);
	});

	it('marks frames from the page origin as the app own code', () => {
		const f = mockFetch();
		const errors = createErrors();
		const client = make().use(errors);
		const error = new Error('x');
		error.stack = [
			'Error: x',
			`    at mine (${location.origin}/app.js:1:1)`,
			'    at theirs (https://cdn.example.com/lib.js:2:2)'
		].join('\n');
		errors.captureException(error);
		return client.flush().then(() => {
			const [entry] = (exceptions(f)[0]?.properties?.$exception_list ?? []) as {
				stacktrace: { frames: { in_app: boolean }[] };
			}[];
			expect(entry?.stacktrace.frames.map((frame) => frame.in_app)).toEqual([true, false]);
		});
	});
});
