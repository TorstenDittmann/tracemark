# @tracemark/vue

Vue 3 plugin and composables for [tracemark](https://github.com/TorstenDittmann/tracemark): analytics, feature flags and component error capture. Supports Vue 3.3+.

```sh
npm install @tracemark/vue @tracemark/browser
```

Install the plugin with `app.use(createTracemark(options))`, then use `useTracemark`, `useFeatureFlag`, `useFeatureFlagEnabled` and `useFeatureFlagPayload` in your components.

Requires a running tracemark instance and its project key.

[Setup and examples](https://github.com/TorstenDittmann/tracemark/blob/main/docs/frameworks.md#vue-tracemarkvue)

MIT licensed.
