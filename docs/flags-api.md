# Flags API

The app serves feature flags on two endpoints. Both use the same evaluator, `packages/flags`, and the shared vectors in `packages/flags/vectors.json` pin down its behavior for every SDK.

## `POST /flags`: evaluate every flag for one person

Called by browsers and by server SDKs that don't evaluate locally. It is authenticated by the project's public key, like `POST /e`, and open to any origin (CORS). Send `content-type: application/json`. The app refuses cross-site form content types (`text/plain`, form encodings) with a 403. Browsers send one preflight per origin a day.

```json
{
  "api_key": "fp_pub_3b1f…",
  "distinct_id": "user_123",
  "person_properties": { "plan": "pro" },
  "groups": { "company": "acme" },
  "group_properties": { "company": { "seats": 40 } }
}
```

Only `api_key` and `distinct_id` are required. The server also uses what it has stored:

- The person's stored properties, from `$set` and `$set_once`. Properties in the request win over stored ones.
- Group properties from `$groupidentify`.
- Cohort membership.

A property nobody has set reads as empty.

```json
{
  "flags": { "new-checkout": true, "pricing": "test", "beta": false },
  "payloads": { "pricing": { "price": 9 } }
}
```

`flags` holds every flag in the project:

- `false` when the flag is off for this person.
- `true` when a boolean flag is on.
- The variant key when a multivariate flag is on.

`payloads` holds the JSON payload of each flag that is on and has one.

| Status | Body | When |
| --- | --- | --- |
| `200` | as above | |
| `400` | `{"error": "invalid_request", "message": "…"}` | Bad JSON or fields |
| `401` | `{"error": "invalid_api_key"}` | Missing or unknown key |
| `413` | `{"error": "payload_too_large"}` | Body over 64 KB |

If ClickHouse can't be reached, flags are evaluated from the request alone and nobody is in a cohort.

## `GET /flags/definitions`: definitions for local evaluation

Called by server SDKs to evaluate flags in-process. Needs the project's secret key, shown to organization owners and admins in the project settings:

```
Authorization: Bearer fp_sec_…
```

The response is `{"flags": [FlagDefinition, …]}`, with each definition in the shape `parseFlag` returns. A `401` with `{"error": "invalid_secret_key"}` means the key is missing or unknown.

A flag can't be decided locally when it filters on a cohort or on a property the SDK wasn't given. The evaluator reports such a flag as inconclusive, and the SDK asks `POST /flags` for it instead.

## Bucketing

An id's bucket is the first 13 hex digits of `sha1("<flag key>.<id>")`, divided by 2^52.

- The id is the `distinct_id`.
- For a flag with a group type, the id is that group's key, so everyone in a company gets the same answer.

A condition includes the id when its bucket is below `rollout / 100`. Variants use a second bucket, salted with `.variant`, which walks the cumulative variant percentages.

## Browser SDK

The flags plugin ships with `@footprint/browser` as a separate entry, so pages without flags don't load it:

```ts
import { footprint } from '@footprint/browser';
import { createFlags } from '@footprint/browser/flags';

const flags = createFlags();
footprint.init({ apiKey: 'fp_pub_…', host: 'https://footprint.example.com' }).use(flags);

await flags.ready();
if (flags.isEnabled('new-checkout')) showNewCheckout();
const price = flags.getFlag('pricing') === 'test' ? flags.getPayload('pricing') : undefined;
```

- The plugin fetches flags after `init`, and again after `identify`, `reset` and a new `group`.
- It keeps the last answer in localStorage and serves it on the next page load until the fresh one arrives. With `persistence: 'localStorage'` only.
- Pass `bootstrap` with flags evaluated on your server to skip the first request.
- The first read of each flag value per person captures `$feature_flag_called` with `$feature_flag` and `$feature_flag_response`. Experiments use these exposures. Turn them off with `sendExposures: false`.
- Someone who opted out gets no requests, so only bootstrapped flags apply.
- In cookieless mode every visitor shares one anonymous id until `identify`, so percentage rollouts only split identified people.
