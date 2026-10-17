// Vue 3 bindings for the tracemark browser SDK: a plugin that sets up the client, its flags and
// error capture, and composables that update when flags change.
import { type Config, type TracemarkClient, tracemark } from '@tracemark/browser';
import type { Errors } from '@tracemark/browser/errors';
import type { Flags, FlagValue } from '@tracemark/browser/flags';
import {
	type App,
	type ComputedRef,
	computed,
	getCurrentInstance,
	type InjectionKey,
	inject,
	onMounted,
	onUnmounted,
	type Ref,
	readonly,
	shallowRef
} from 'vue';

interface TracemarkContext {
	client: TracemarkClient;
	flags?: Flags;
	errors?: Errors;
}

const KEY: InjectionKey<TracemarkContext> = Symbol('tracemark');

export interface TracemarkPluginOptions {
	/** The client to use. Defaults to the SDK's default `tracemark` client. */
	client?: TracemarkClient;
	/** Initializes the client in the browser if it isn't yet. */
	options?: Config;
	/** The flags plugin from `createFlags()`; added to the client. */
	flags?: Flags;
	/**
	 * The errors plugin from `createErrors()`; added to the client, and used to capture errors
	 * from components through `app.config.errorHandler`.
	 */
	errors?: Errors;
}

/**
 * `app.use(createTracemark({ options, flags, errors }))`. Setup only runs in the browser, so the
 * same plugin works with server rendering.
 */
export function createTracemark(setup: TracemarkPluginOptions = {}) {
	const { client = tracemark, options, flags, errors } = setup;
	return {
		install(app: App) {
			app.provide(KEY, { client, flags, errors });
			if (typeof window === 'undefined') return;
			if (options && !client.config) client.init(options);
			if (flags) client.use(flags);
			if (!errors) return;
			client.use(errors);
			const previous = app.config.errorHandler;
			app.config.errorHandler = (error, instance, info) => {
				errors.captureException(
					error,
					{ $vue_info: info, $vue_component: instance?.$options.name ?? undefined },
					{ mechanism: 'vue', handled: false }
				);
				// Vue only logs errors itself when no handler is set.
				if (previous) previous(error, instance, info);
				else console.error(error);
			};
		}
	};
}

function context(): TracemarkContext {
	return inject(KEY, { client: tracemark });
}

/** The tracemark client, for `capture`, `identify` and friends. */
export function useTracemark(): TracemarkClient {
	return context().client;
}

/** The errors plugin passed to `createTracemark`, if any. */
export function useErrors(): Errors | undefined {
	return context().errors;
}

/** The flags plugin passed to `createTracemark`. */
export function useFlags(): Flags {
	const { flags } = context();
	if (!flags)
		throw new Error('[tracemark] pass `flags` to createTracemark() to use flag composables');
	return flags;
}

/**
 * A flag's value: its variant, `true` for an enabled boolean flag, or `false`. While the
 * component is mounted, each value it takes is recorded once as a `$feature_flag_called`
 * exposure. During server rendering it holds the bootstrapped value.
 */
export function useFeatureFlag(key: string): Readonly<Ref<FlagValue>> {
	const flags = useFlags();
	const value = shallowRef<FlagValue>(flags.getAll()[key] ?? false);
	if (getCurrentInstance()) {
		let stop = () => {};
		let mounted = false;
		onMounted(() => {
			mounted = true;
			value.value = flags.getFlag(key);
			// Flags added to the client after mount only record once they loaded.
			void flags.ready().then(() => {
				if (mounted) value.value = flags.getFlag(key);
			});
			stop = flags.onChange(() => {
				value.value = flags.getFlag(key);
			});
		});
		onUnmounted(() => {
			mounted = false;
			stop();
		});
	}
	return readonly(value);
}

/** Whether a flag is on: `true`, or any variant. */
export function useFeatureFlagEnabled(key: string): ComputedRef<boolean> {
	const value = useFeatureFlag(key);
	return computed(() => value.value !== false);
}

/** The JSON payload served with a flag's current value, `undefined` when it has none. */
export function useFeatureFlagPayload<T = unknown>(key: string): ComputedRef<T | undefined> {
	const flags = useFlags();
	const value = useFeatureFlag(key);
	return computed(() =>
		value.value === false ? undefined : (flags.getPayload(key) as T | undefined)
	);
}

export type { Config, TracemarkClient } from '@tracemark/browser';
export type { Errors, ErrorsOptions } from '@tracemark/browser/errors';
export type { Flags, FlagsOptions, FlagsSnapshot, FlagValue } from '@tracemark/browser/flags';
