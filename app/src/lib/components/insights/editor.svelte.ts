import { goto } from '$app/navigation';
import { page } from '$app/state';

export const selectClass =
	'h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs dark:bg-input/30';

/** Known names plus the current one, so a value missing from recent data still shows. */
export function withCurrent(names: string[], current: string | undefined): string[] {
	return current && !names.includes(current) ? [current, ...names] : names;
}

/** Loads the page for a changed query, kept in the URL's `q` parameter. */
export function showQuery<T>(query: T, change: (query: T) => void): void {
	const next = structuredClone($state.snapshot(query)) as T;
	change(next);
	const url = new URL(page.url.href);
	url.searchParams.set('q', JSON.stringify(next));
	goto(`${url.pathname}${url.search}`, { reset: false });
}
