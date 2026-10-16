// The one Node API the AI helpers use, declared here so the package builds without Node's types.
// Node, Bun and Deno all provide it.
declare module 'node:async_hooks' {
	export class AsyncLocalStorage<T> {
		getStore(): T | undefined;
		run<R>(store: T, callback: () => R): R;
	}
}
