# Ingest protocol (v1)

All SDKs send events to the ingest service. This document is the contract between SDKs, the Rust ingest service and the app.

## `POST /e`

Request body (JSON, optionally `Content-Encoding: gzip`):

```json
{
  "api_key": "fp_pub_3b1f…",
  "sent_at": "2026-10-07T21:00:00.000Z",
  "batch": [
    {
      "uuid": "01927d0b-8c4a-7cc2-9f43-3c1b2b0e9a11",
      "event": "$pageview",
      "distinct_id": "user_123",
      "timestamp": "2026-10-07T20:59:58.120Z",
      "session_id": "01927d0b-0000-7000-8000-000000000001",
      "properties": { "$current_url": "https://example.com/pricing" },
      "person": { "set": { "plan": "pro" }, "set_once": { "first_seen_on": "web" } },
      "groups": { "company": "acme" }
    }
  ]
}
```

The key is in the body (not a header) because `navigator.sendBeacon` cannot set headers. `?api_key=` in the query string is accepted as a fallback.

### Event fields

| Field | Type | Required | Rules |
| --- | --- | --- | --- |
| `uuid` | string | yes | UUID (v7 recommended); used for dedup |
| `event` | string | yes | 1–200 chars. Names starting with `$` are reserved for footprint |
| `distinct_id` | string | yes | 1–200 chars |
| `timestamp` | string | yes | RFC 3339 / ISO 8601 with timezone |
| `session_id` | string | no | ≤ 200 chars |
| `properties` | object | no | JSON object, any depth |
| `person` | object | no | `{ set?: object, set_once?: object }` |
| `groups` | object | no | map of group type → group key, both strings ≤ 200 chars, max 5 entries |

Unknown top-level fields are ignored. `sent_at` is optional; when present the server corrects client clock skew: `timestamp + (server_now - sent_at)`.

### Limits

- Max 1000 events per batch, max 5 MB decompressed body.
- A batch is validated as a whole: if any event is invalid the response is `400` and nothing is stored.

### Responses

| Status | Body | When |
| --- | --- | --- |
| `202` | `{"accepted": <n>}` | Batch accepted (stored asynchronously) |
| `400` | `{"error": "invalid_batch", "details": [{"index": 0, "field": "event", "message": "…"}]}` | Malformed JSON or invalid event |
| `401` | `{"error": "invalid_api_key"}` | Missing or unknown key |
| `413` | `{"error": "payload_too_large"}` | Over the limits |

## Reserved events

| Event | Meaning |
| --- | --- |
| `$pageview` | Page view (`$current_url`, `$pathname`, `$referrer`, `$title`) |
| `$pageleave` | Page left |
| `$set` | Only updates person properties via `person.set` / `person.set_once` |
| `$groupidentify` | Sets group properties: `$group_type`, `$group_key`, `$group_set` |
| `$identify` | `distinct_id` is the new id; `properties.$anon_distinct_id` is the previous anonymous id |
| `$exception` | Error (`$exception_type`, `$exception_message`, `$exception_stack`) |
| `$feature_flag_called` | Flag exposure (`$feature_flag`, `$feature_flag_response`) |

## Internal: project keys

The ingest service never reads the app database. It polls the app:

`GET {APP_INTERNAL_URL}/internal/projects` with header `x-internal-token: {INTERNAL_TOKEN}` →

```json
{ "projects": [{ "id": "5f0c…uuid", "public_key": "fp_pub_3b1f…" }] }
```
