# Node SDK

`@footprint/node` sends events from servers and evaluates feature flags. It runs on Node 20+, Bun, Deno and edge runtimes, and has no dependencies.

```ts
import { Footprint } from '@footprint/node';

const footprint = new Footprint({
  apiKey: 'fp_pub_…',
  host: 'https://footprint.example.com',
  // Optional: evaluate flags in-process instead of asking the server each time.
  secretKey: process.env.FOOTPRINT_SECRET_KEY
});

footprint.capture({ distinctId: 'user_123', event: 'invoice_paid', properties: { amount: 49 } });
footprint.identify({ distinctId: 'user_123', set: { plan: 'pro' } });
footprint.alias({ distinctId: 'user_123', alias: anonymousIdFromTheBrowser });
footprint.groupIdentify({ groupType: 'company', groupKey: 'acme', properties: { seats: 40 } });

if (await footprint.isEnabled('new-checkout', 'user_123', { personProperties: { plan: 'pro' } })) {
  // …
}

// Before the process exits:
await footprint.shutdown();
```

## Events

- Events are queued and sent in batches of up to 1000.
- A batch is sent once `flushAt` events (20) are queued, and at least every `flushIntervalMs` (10 s). `flush()` sends now.
- A batch the server can't take (network error, 5xx, 429) stays queued for the next flush.
- A batch the server rejects (4xx) is dropped and reported to `onError`.
- The queue keeps at most `maxQueueSize` events (10,000), dropping the oldest.
- Every event carries `$lib: "footprint-node"` and `$lib_version`.

## Flags

**Without `secretKey`**, every check is one `POST /flags` request (see [flags-api.md](flags-api.md)).

**With `secretKey`**:

- Definitions come from `GET /flags/definitions`, refreshed every `flagsPollIntervalMs` (30 s). If a refresh fails, the last definitions are kept.
- Flags are evaluated in-process with the shared evaluator in `packages/flags`, so a person gets the same answer as from the server.
- Local evaluation only uses the properties you pass in `personProperties` and `groupProperties`. When a flag filters on a property you didn't pass, or on a cohort, the SDK asks the server for it, and the server uses stored properties too.
- `onlyLocal: true` skips the server; such flags come back off.

**Exposures:** `isEnabled`, `getFlag` and `getPayload` capture `$feature_flag_called` the first time a person gets each value. Turn this off per call with `sendExposure: false`. `getAllFlags` never captures one.
