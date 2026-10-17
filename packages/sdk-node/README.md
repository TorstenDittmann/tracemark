# @tracemark/node

Server SDK for [tracemark](https://github.com/TorstenDittmann/tracemark): analytics, feature flags, error tracking and AI observability. Supports Node.js 20+, Bun, Deno and edge runtimes.

```sh
npm install @tracemark/node
```

```ts
import { Tracemark } from '@tracemark/node';

const tracemark = new Tracemark({
  apiKey: 'fp_pub_…',
  host: 'https://analytics.example.com'
});

tracemark.capture({ distinctId: 'user_123', event: 'invoice_paid' });
await tracemark.shutdown();
```

Requires a running tracemark instance and its project key. Includes helpers for Hono, Express, Fastify and Elysia, and AI helpers at `@tracemark/node/ai`.

[SDK documentation](https://github.com/TorstenDittmann/tracemark/blob/main/docs/sdk-node.md) · [AI observability](https://github.com/TorstenDittmann/tracemark/blob/main/docs/ai.md)

MIT licensed.
