# @tracemark/nuxt

Nuxt server helpers for [tracemark](https://github.com/TorstenDittmann/tracemark): per-request feature flags, flag bootstrap and error capture.

```sh
npm install @tracemark/nuxt @tracemark/node
```

Use `tracemarkMiddleware`, `tracemarkErrorHook` and `flagsBootstrap` on the server. For browser analytics and reactive flag composables, add `@tracemark/vue` and `@tracemark/browser`.

Requires a running tracemark instance and its project key.

[Setup and examples](https://github.com/TorstenDittmann/tracemark/blob/main/docs/frameworks.md#nuxt-tracemarknuxt)

MIT licensed.
