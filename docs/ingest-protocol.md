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
| `timestamp` | string | yes | RFC 3339 / ISO 8601 with timezone, between 1900 and 2299 after skew correction |
| `session_id` | string | no | ≤ 200 chars |
| `properties` | object | no | JSON object, any depth |
| `person` | object | no | `{ set?: object, set_once?: object }` |
| `groups` | object | no | map of group type → group key, both strings ≤ 200 chars, max 5 entries |

Unknown top-level fields are ignored, and `null` optional fields count as absent. Lengths are counted in characters. `sent_at` is optional; when present the server corrects client clock skew: `timestamp + (server_now - sent_at)`.

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
| `503` | `{"error": "not_ready"}` or `{"error": "overloaded"}` | Project keys not loaded yet, or the write queue is full. SDKs retry with backoff |

## `POST /v1/traces`

OpenTelemetry trace export (OTLP/HTTP, protobuf or JSON) for LLM instrumentation. Spans become
`$ai_*` events and then go through the same validation and enrichment as `POST /e` batches, except
that location is not looked up. The key comes as `Authorization: Bearer fp_pub_…`, an
`x-footprint-api-key` header or an `api_key` query parameter. Success is `200` with an empty
`ExportTraceServiceResponse`; errors use the responses above. See [ai.md](ai.md#opentelemetry).

## Enrichment

Before storing an event, ingest adds properties derived from the request. Properties the event already has are never overwritten.

| Property | Source |
| --- | --- |
| `$browser`, `$browser_version`, `$os`, `$os_version`, `$device_type` | `User-Agent` header. `$device_type` is `Desktop`, `Mobile`, `Tablet`, `Console` or `Bot` (with `$bot_name`) |
| `$geoip_continent_code`, `$geoip_country_code`, `$geoip_country_name`, `$geoip_subdivision_1_name`, `$geoip_city_name`, `$geoip_time_zone` | Client IP, when a city database is configured (`GEOIP_DB`) |

The client IP is the peer address, or the address `XFF_DEPTH` entries from the right of `ADDRESS_HEADER` when ingest runs behind a proxy. It is used for the lookup only and never stored.

Event properties that change enrichment, removed before storage unless noted:

| Property | Effect |
| --- | --- |
| `$ip` | Look up this IP instead of the request's (server SDKs sending for a visitor) |
| `$user_agent` | Parse this user agent instead of the request's |
| `$geoip_disable` | `true` skips the location lookup (kept on the event) |

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

## People and identity

A person is one identified `distinct_id` plus every anonymous id linked to it.

- A `$identify` event with `properties.$anon_distinct_id` links that anonymous id to the event's `distinct_id`. Events sent under the anonymous id before and after the link count toward the same person.
- An anonymous id belongs to the first id it was identified as. A later `$identify` naming the same anonymous id is ignored for linking.
- Identified ids are never merged with each other. Switching from one identified id to another (without a reset to a new anonymous id) starts a different person, so SDKs send `$anon_distinct_id` only when the previous id was anonymous.
- `person.set` keeps the newest value per key by event `timestamp`, across all of a person's ids. `person.set_once` keeps the oldest and is used only for keys `set` never wrote.

## Cookieless visitors

An SDK that stores nothing on the device sends `"distinct_id": "$cookieless"` for anonymous visitors and leaves out `session_id`. Ingest replaces the placeholder with `cookieless_` followed by 32 hex characters: a SHA-256 hash of the current UTC day's salt, the project id, the client IP and the user agent (the `$ip` and `$user_agent` overrides apply). A `$identify` event whose `properties.$anon_distinct_id` is `$cookieless` gets the same replacement, so the visitor is linked to the identified id.

The app creates a random salt per UTC day and deletes it once the day is over, so a hash cannot be recomputed later, and the same visitor gets a new id each day. A batch with the placeholder is answered `503 not_ready` while ingest has no salt for the current day; SDKs retry.

Analytics split events without a `session_id` into sessions per person wherever 30 minutes pass without an event.

## Internal: project keys, salts and prices

The ingest service never reads the app database. It polls the app:

`GET {APP_INTERNAL_URL}/internal/projects` with header `x-internal-token: {INTERNAL_TOKEN}` →

```json
{
  "projects": [{ "id": "5f0c…uuid", "public_key": "fp_pub_3b1f…" }],
  "salts": { "2026-10-16": "9c1e…", "2026-10-17": "04ab…" },
  "model_prices": {
    "defaults": [{ "model": "gpt-4o", "input": 2.5, "output": 10, "cache_read": 1.25, "cache_write": null }],
    "projects": { "5f0c…uuid": [{ "model": "gpt-4o", "input": 2, "output": 8, "cache_read": null, "cache_write": null }] }
  }
}
```

`salts` holds the cookieless salts for today and tomorrow (UTC), so ingest has the next day's salt before midnight. `model_prices` are the token prices ingest computes `$ai_cost_usd` with, see [ai.md](ai.md#cost).
