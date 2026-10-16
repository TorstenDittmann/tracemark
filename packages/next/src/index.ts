'use client';
// Next.js App Router client side: a provider that sets up the browser SDK with flags and error
// capture, and a hook for `error.tsx` pages.
import { type Config, type FootprintClient, footprint } from '@footprint/browser';
import { createErrors, type Errors, type ErrorsOptions } from '@footprint/browser/errors';
import { createFlags, type FlagsOptions, type FlagsSnapshot } from '@footprint/browser/flags';
import { FootprintProvider, useErrors } from '@footprint/react';
import { createElement, type ReactNode, useEffect, useState } from 'react';

export interface FootprintNextProviderProps {
	/**
	 * Browser SDK options. `persistence` defaults to `'cookie'` here, so server components and
	 * route handlers can read who the visitor is.
	 */
	options: Config;
	/** Flags evaluated on the server for this visitor, from `flagsBootstrap()`. */
	bootstrap?: FlagsSnapshot;
	/** Your signed-in user's id, to `identify` with. */
	distinctId?: string;
	/** Options for the flags plugin, or `false` to leave it out. */
	flags?: Omit<FlagsOptions, 'bootstrap'> | false;
	/** Options for the errors plugin, or `false` to leave it out. */
	errors?: ErrorsOptions | false;
	/** The client to use. Defaults to the SDK's default `footprint` client. */
	client?: FootprintClient;
	children?: ReactNode;
}

/** Put it in your root layout, around `children`. Page views follow client-side navigation. */
export function FootprintNextProvider({
	options,
	bootstrap,
	distinctId,
	flags: flagOptions,
	errors: errorOptions,
	client = footprint,
	children
}: FootprintNextProviderProps) {
	// Created once; later prop changes are ignored, like the options.
	const [plugins] = useState(() => ({
		flags: flagOptions === false ? undefined : createFlags({ ...flagOptions, bootstrap }),
		errors: errorOptions === false ? undefined : createErrors(errorOptions)
	}));
	const [config] = useState<Config>(() => ({ persistence: 'cookie', ...options }));
	// Runs after the provider below initialized the client.
	useEffect(() => {
		if (distinctId && client.config && client.getDistinctId() !== distinctId) {
			client.identify(distinctId);
		}
	}, [client, distinctId]);
	return createElement(
		FootprintProvider,
		{ client, options: config, flags: plugins.flags, errors: plugins.errors },
		children
	);
}

/**
 * Captures the error an `error.tsx` page shows. In `global-error.tsx`, which renders without your
 * layout and its provider, pass the errors plugin.
 */
export function useCaptureException(error: Error & { digest?: string }, errors?: Errors) {
	const fromContext = useErrors();
	const plugin = errors ?? fromContext;
	useEffect(() => {
		plugin?.captureException(error, error.digest ? { $next_digest: error.digest } : {}, {
			mechanism: 'nextjs-error-page',
			handled: false
		});
	}, [error, plugin]);
}

export type { Config, FlagsSnapshot };
