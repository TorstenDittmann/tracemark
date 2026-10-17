# @tracemark/sveltekit

SvelteKit hooks for [tracemark](https://github.com/TorstenDittmann/tracemark): per-request feature flags, server flag bootstrap and error capture. Supports SvelteKit 2 and 3.

```sh
npm install @tracemark/sveltekit @tracemark/browser @tracemark/node
```

Import server hooks and bootstrap helpers from `@tracemark/sveltekit/server`, and the client error handler from `@tracemark/sveltekit`. For reactive flag stores, add `@tracemark/svelte`.

Requires a running tracemark instance and its project key.

[Setup and examples](https://github.com/TorstenDittmann/tracemark/blob/main/docs/frameworks.md#sveltekit-tracemarksveltekit)

MIT licensed.
