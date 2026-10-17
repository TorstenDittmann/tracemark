import { goto } from '$app/navigation';
import { page } from '$app/state';

export const selectClass =
	'select-chevron h-8 min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-background pr-8 pl-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow,background-color] hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50';

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
