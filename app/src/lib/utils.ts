import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges Tailwind classes; used by shadcn-svelte components. */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// biome-ignore lint/suspicious/noExplicitAny: matches shadcn-svelte's helper types
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// biome-ignore lint/suspicious/noExplicitAny: matches shadcn-svelte's helper types
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
