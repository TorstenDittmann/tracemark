# @tracemark/browser

Lightweight browser SDK for [tracemark](https://github.com/TorstenDittmann/tracemark), self-hosted product analytics.

```sh
npm install @tracemark/browser
```

```ts
import { tracemark } from '@tracemark/browser';

tracemark.init({ apiKey: 'fp_pub_…', host: 'https://analytics.example.com' });
tracemark.capture('signed_up', { plan: 'pro' });
tracemark.identify('user_123', { set: { email: 'ada@example.com' } });
```

Page views, including SPA navigations, are captured automatically. Feature flags and error tracking are opt-in plugins from `@tracemark/browser/flags` and `@tracemark/browser/errors`.

Requires a running tracemark instance and its project key. ESM and script-tag builds are included.

[Feature flags](https://github.com/TorstenDittmann/tracemark/blob/main/docs/flags-api.md) · [Error tracking](https://github.com/TorstenDittmann/tracemark/blob/main/docs/errors.md) · [Framework integrations](https://github.com/TorstenDittmann/tracemark/blob/main/docs/frameworks.md)

MIT licensed.
