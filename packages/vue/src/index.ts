// Vue 3 bindings for the footprint browser SDK: a plugin that sets up the client, its flags and
// error capture, and composables that update when flags change.
import { type Config, type FootprintClient, footprint } from '@footprint/browser';
import type { Errors } from '@footprint/browser/errors';
import type { Flags, FlagValue } from '@footprint/browser/flags';
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

interface FootprintContext {
	client: FootprintClient;
	flags?: Flags;
	errors?: Errors;
}

const KEY: InjectionKey<FootprintContext> = Symbol('footprint');

export interface FootprintPluginOptions {
	/** The client to use. Defaults to the SDK's default `footprint` client. */
	client?: FootprintClient;
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
 * `app.use(createFootprint({ options, flags, errors }))`. Setup only runs in the browser, so the
 * same plugin works with server rendering.
 */
export function createFootprint(setup: FootprintPluginOptions = {}) {
	const { client = footprint, options, flags, errors } = setup;
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

function context(): FootprintContext {
	return inject(KEY, { client: footprint });
}

/** The footprint client, for `capture`, `identify` and friends. */
export function useFootprint(): FootprintClient {
	return context().client;
}

/** The errors plugin passed to `createFootprint`, if any. */
export function useErrors(): Errors | undefined {
	return context().errors;
}

/** The flags plugin passed to `createFootprint`. */
export function useFlags(): Flags {
	const { flags } = context();
	if (!flags)
		throw new Error('[footprint] pass `flags` to createFootprint() to use flag composables');
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

export type { Config, FootprintClient } from '@footprint/browser';
export type { Errors, ErrorsOptions } from '@footprint/browser/errors';
export type { Flags, FlagsOptions, FlagsSnapshot, FlagValue } from '@footprint/browser/flags';
