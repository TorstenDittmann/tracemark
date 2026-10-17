# @tracemark/svelte

Svelte stores for [tracemark](https://github.com/TorstenDittmann/tracemark) feature flags, plus a render-error boundary helper. Supports Svelte 4 and 5.

```sh
npm install @tracemark/svelte @tracemark/browser
```

Create stores with `featureFlag`, `featureFlagEnabled`, `featureFlagPayload` and `allFlags`. Pass the flags plugin from `@tracemark/browser/flags` to each store.

Requires a running tracemark instance and its project key.

[Setup and examples](https://github.com/TorstenDittmann/tracemark/blob/main/docs/frameworks.md#svelte-and-sveltekit-tracemarksvelte)

MIT licensed.
