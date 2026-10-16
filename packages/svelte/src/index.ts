// Svelte stores for footprint feature flags. They work in Svelte 4 and 5 components with `$`,
// and in SvelteKit, where they keep their initial value during server rendering.
import type { Flags, FlagValue } from '@footprint/browser/flags';
import { derived, type Readable, readable } from 'svelte/store';

/** Every flag's value. Reading it records no exposures. */
export function allFlags(flags: Flags): Readable<Record<string, FlagValue>> {
	return readable(flags.getAll(), (set) => flags.onChange(() => set(flags.getAll())));
}

/**
 * A flag's value: its variant, `true` for an enabled boolean flag, or `false`. While subscribed,
 * each value it takes is recorded once as a `$feature_flag_called` exposure.
 */
export function featureFlag(flags: Flags, key: string): Readable<FlagValue> {
	return readable<FlagValue>(flags.getAll()[key] ?? false, (set) => {
		let active = true;
		set(flags.getFlag(key));
		// Flags added to the client after this subscribed only record once they loaded.
		void flags.ready().then(() => {
			if (active) set(flags.getFlag(key));
		});
		const stop = flags.onChange(() => set(flags.getFlag(key)));
		return () => {
			active = false;
			stop();
		};
	});
}

/** Whether a flag is on: `true`, or any variant. */
export function featureFlagEnabled(flags: Flags, key: string): Readable<boolean> {
	return derived(featureFlag(flags, key), (value) => value !== false);
}

/** The JSON payload served with a flag's current value, `undefined` when it has none. */
export function featureFlagPayload<T = unknown>(
	flags: Flags,
	key: string
): Readable<T | undefined> {
	return derived(featureFlag(flags, key), (value) =>
		value === false ? undefined : (flags.getPayload(key) as T | undefined)
	);
}

export type { Flags, FlagsOptions, FlagsSnapshot, FlagValue } from '@footprint/browser/flags';
