'use client';
// React bindings for the footprint browser SDK: a provider for the client and the flags plugin,
// and hooks that re-render when flags change.
import { type Config, type FootprintClient, footprint } from '@footprint/browser';
import type { Errors } from '@footprint/browser/errors';
import type { Flags, FlagValue } from '@footprint/browser/flags';
import {
	Component,
	createContext,
	createElement,
	type ErrorInfo,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useSyncExternalStore
} from 'react';

interface FootprintContext {
	client: FootprintClient;
	flags?: Flags;
	errors?: Errors;
}

const Context = createContext<FootprintContext>({ client: footprint });

export interface FootprintProviderProps {
	/** The client to use. Defaults to the SDK's default `footprint` client. */
	client?: FootprintClient;
	/** Initializes the client in the browser if it isn't yet. */
	options?: Config;
	/** The flags plugin from `createFlags()`; added to the client. */
	flags?: Flags;
	/** The errors plugin from `createErrors()`; added to the client, and used by error boundaries. */
	errors?: Errors;
	children?: ReactNode;
}

/** Makes a client, and optionally its flags, available to the hooks below. */
export function FootprintProvider({
	client = footprint,
	options,
	flags,
	errors,
	children
}: FootprintProviderProps) {
	// Initialization happens once per client; later changes to `options` are ignored.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		if (options && !client.config) client.init(options);
		if (flags) client.use(flags);
		if (errors) client.use(errors);
	}, [client, flags, errors]);
	return createElement(Context.Provider, { value: { client, flags, errors } }, children);
}

/** The footprint client, for `capture`, `identify` and friends. */
export function useFootprint(): FootprintClient {
	return useContext(Context).client;
}

/** The errors plugin passed to `FootprintProvider`, if any. */
export function useErrors(): Errors | undefined {
	return useContext(Context).errors;
}

/** The flags plugin passed to `FootprintProvider`. */
export function useFlags(): Flags {
	const { flags } = useContext(Context);
	if (!flags) throw new Error('[footprint] pass `flags` to <FootprintProvider> to use flag hooks');
	return flags;
}

/** A flag's value without recording an exposure, re-rendering when it changes. */
function useValue(flags: Flags, key: string): FlagValue {
	const subscribe = useCallback((onChange: () => void) => flags.onChange(onChange), [flags]);
	const read = () => flags.getAll()[key] ?? false;
	return useSyncExternalStore(subscribe, read, read);
}

/** Records an exposure for each value a component was shown. */
function useExposure(flags: Flags, key: string, value: FlagValue) {
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-runs for each new value on purpose
	useEffect(() => {
		let mounted = true;
		// The plugin records only values known for the current person, so read again once they
		// load and whenever they change (an identify can keep the value but change the person).
		flags.getFlag(key);
		void flags.ready().then(() => {
			if (mounted) flags.getFlag(key);
		});
		const stop = flags.onChange(() => flags.getFlag(key));
		return () => {
			mounted = false;
			stop();
		};
	}, [flags, key, value]);
}

/**
 * A flag's current value: its variant, `true` for an enabled boolean flag, or `false`. Records
 * a `$feature_flag_called` exposure once per person and value.
 */
export function useFeatureFlag(key: string): FlagValue {
	const flags = useFlags();
	const value = useValue(flags, key);
	useExposure(flags, key, value);
	return value;
}

/** Whether a flag is on: `true`, or any variant. */
export function useFeatureFlagEnabled(key: string): boolean {
	return useFeatureFlag(key) !== false;
}

/** The JSON payload served with a flag's current value, `undefined` when it has none. */
export function useFeatureFlagPayload<T = unknown>(key: string): T | undefined {
	const flags = useFlags();
	const value = useValue(flags, key);
	useExposure(flags, key, value);
	return (value === false ? undefined : flags.getPayload(key)) as T | undefined;
}

export interface FootprintErrorBoundaryProps {
	/** Shown instead of the children after they threw. Without one, nothing is shown. */
	fallback?: ReactNode | ((props: { error: unknown; reset: () => void }) => ReactNode);
	/** Called after the error was captured. */
	onError?: (error: unknown, info: ErrorInfo) => void;
	/** The errors plugin, if not the one passed to `FootprintProvider`. */
	errors?: Errors;
	children?: ReactNode;
}

interface BoundaryState {
	failed: boolean;
	error: unknown;
}

/** Captures errors thrown while rendering its children, and shows `fallback` instead. */
export class FootprintErrorBoundary extends Component<FootprintErrorBoundaryProps, BoundaryState> {
	static override contextType = Context;
	declare context: FootprintContext;
	override state: BoundaryState = { failed: false, error: undefined };

	static getDerivedStateFromError(error: unknown): BoundaryState {
		return { failed: true, error };
	}

	override componentDidCatch(error: unknown, info: ErrorInfo) {
		const errors = this.props.errors ?? this.context.errors;
		if (errors) {
			errors.captureException(
				error,
				{ $react_component_stack: info.componentStack ?? undefined },
				{ mechanism: 'react-error-boundary', handled: false }
			);
		} else {
			console.warn('[footprint] pass `errors` to <FootprintProvider> to capture render errors');
		}
		this.props.onError?.(error, info);
	}

	reset = () => this.setState({ failed: false, error: undefined });

	override render() {
		if (!this.state.failed) return this.props.children;
		const { fallback } = this.props;
		return typeof fallback === 'function'
			? fallback({ error: this.state.error, reset: this.reset })
			: (fallback ?? null);
	}
}

/**
 * For React 19's root error options, which see errors that no boundary caught:
 * `createRoot(el, { onUncaughtError: reactErrorHandler(errors) })`.
 */
export function reactErrorHandler(
	errors: Errors,
	then?: (error: unknown, info: { componentStack?: string }) => void
) {
	return (error: unknown, info: { componentStack?: string }) => {
		errors.captureException(
			error,
			{ $react_component_stack: info.componentStack },
			{ mechanism: 'react-root', handled: false }
		);
		then?.(error, info);
	};
}

export type { Config, FootprintClient } from '@footprint/browser';
export type { Errors, ErrorsOptions } from '@footprint/browser/errors';
export type { Flags, FlagsOptions, FlagValue } from '@footprint/browser/flags';
