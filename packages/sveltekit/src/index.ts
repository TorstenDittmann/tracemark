// SvelteKit client hook: captures errors from loads and rendering in the browser.
import type { Errors } from '@footprint/browser/errors';

/** What the client `handleError` receives: `kind` in SvelteKit 3, `status` in SvelteKit 2. */
export interface ClientCaughtError {
	error: unknown;
	kind?: string;
	status?: number;
}

/**
 * A client `handleError` hook that captures unexpected errors (not 404s or errors thrown with
 * `error()`), then returns what `then` returns.
 */
export function footprintClientHandleError<Input extends ClientCaughtError, Result = void>(
	errors: Errors,
	then?: (input: Input) => Result
) {
	return (input: Input): Result => {
		const unexpected = input.kind === undefined ? input.status !== 404 : input.kind === 'unknown';
		if (unexpected) {
			errors.captureException(input.error, input.status ? { $http_status: input.status } : {}, {
				mechanism: 'sveltekit',
				handled: false
			});
		}
		return then?.(input) as Result;
	};
}
