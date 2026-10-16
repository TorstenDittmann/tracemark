# Query API

The app serves a read API under `/api/v1` for scripts, notebooks and internal tools. It runs the
same queries as the insight editors and returns JSON.

## Authentication

Every request needs the project's secret key as a bearer token. Organization owners and admins can
find it under **Settings → Secret key**:

```
Authorization: Bearer fp_sec_…
```

The key can read every event and person in the project, so keep it on servers. Rotating it in the
settings stops the old key at once. A missing or unknown key gets a `401` with
`{"error": "invalid_secret_key"}`.

Send `POST` bodies with `content-type: application/json`. The app refuses form content types
(`text/plain`, form encodings) with a `403`, which is what `curl -d` sends by default.

## `POST /api/v1/query`: run a query

```sh
curl https://footprint.example.com/api/v1/query \
  -H "authorization: Bearer $FOOTPRINT_SECRET_KEY" \
  -H "content-type: application/json" \
  -d '{"kind": "trends", "query": {"series": [{"event": "$pageview", "math": "unique_users"}], "range": "7d"}}'
```

The body has a `kind` (`trends`, `funnel` or `retention`) and a `query` of that kind. The query
is the same JSON the editors keep in their URL, so the quickest way to write one is to build it in
the app and copy the `q` parameter.

The query is read leniently, like the editors read it: unknown fields are ignored, and a field that
is missing or invalid falls back to its default. The response always carries the `query` that
actually ran, so compare it with what you sent.

```json
{
  "kind": "trends",
  "query": {
    "series": [{ "event": "$pageview", "math": "unique_users" }],
    "range": "7d",
    "filters": []
  },
  "result": {
    "bucket": "day",
    "buckets": ["2026-10-10T00:00:00Z", "…", "2026-10-16T00:00:00Z"],
    "lines": [
      {
        "series": 0,
        "label": "Page views · unique users",
        "data": [157, 116, 95, 89, 93, 110, 104],
        "total": 564
      }
    ]
  }
}
```

### Common fields

| Field | Values |
| --- | --- |
| `range` | `24h`, `7d`, `30d` or `90d` (retention: `7d`, `30d` or `90d`). Buckets are hours for `24h`, days otherwise, in UTC |
| `filters` | Up to 10 `{"property", "operator", "value"}`. Operators: `eq`, `neq`, `contains`, `not_contains`, `gt`, `lt`, `is_set`, `is_not_set` (the last two take no value). Values are strings |
| `cohort` | A cohort id; only people in that cohort count |

### Trends

| Field | Values |
| --- | --- |
| `series` | Up to 5 `{"event", "math", "property"}`. `math` is `total`, `unique_users`, `sum`, `avg`, `min` or `max`; the last four need a numeric `property` |
| `breakdown` | A property name; lines are split by its values, at most 8 lines in all |

`result.lines` has one line per series (or per series and breakdown value). `data` holds one value
per bucket and `total` the value over the whole range: for unique users and averages, that is not
the sum of `data`.

### Funnel

| Field | Values |
| --- | --- |
| `steps` | 2 to 10 event names, in order |
| `window` | Time from the first step in which the rest must happen: `1h`, `1d`, `7d`, `14d` or `30d` |
| `breakdown` | A property of the first step's event |

`result.total.counts` holds how many people reached each step. With a breakdown, `result.groups`
holds the same per value, for the 8 values with the most people.

```json
{ "steps": ["$pageview", "signed_up"], "total": { "counts": [614, 28] }, "groups": [] }
```

### Retention

| Field | Values |
| --- | --- |
| `start` | The event that puts a person in a cohort, by the period they first did it |
| `returning` | The event that counts as coming back |

Cohorts are daily for `7d` and `30d` and weekly (from Monday) for `90d`. Each cohort has its
`start`, its `size`, and `returned`: the people who came back one period later, two periods later,
and so on, for each period that has begun.

### Errors

| Status | Body | When |
| --- | --- | --- |
| `400` | `{"error": "invalid_request", "message": "…"}` | Bad JSON, or an unknown `kind` |
| `401` | `{"error": "invalid_secret_key"}` | Missing or unknown key |

## `GET /api/v1/insights`: saved insights

Every saved insight in the project, most recently changed first, without results:

```json
{
  "insights": [
    {
      "id": "779c1ab7-…",
      "name": "Signup to purchase",
      "kind": "funnel",
      "query": { "steps": ["$pageview", "signed_up", "purchase"], "window": "7d", "range": "30d", "filters": [] },
      "updatedAt": "2026-10-16T17:24:01.066Z"
    }
  ]
}
```

`GET /api/v1/insights/{id}` returns one insight with its `result`, computed when you ask, in the
same shape as `POST /api/v1/query`. An unknown id gets a `404` with `{"error": "not_found"}`.

## `GET /api/v1/events`: recent events

The newest events of the last 30 days, newest first.

| Parameter | Values |
| --- | --- |
| `event` | Only events with this name |
| `filters` | Property filters as a JSON array, as in queries (URL-encode it) |
| `limit` | 1 to 500; 50 by default |
| `before` | The `next` value of the previous page |

```json
{
  "events": [
    {
      "uuid": "c35e7bf7-…",
      "event": "$pageview",
      "timestamp": "2026-10-16T16:53:59.968Z",
      "distinctId": "anon-231",
      "person": "anon-231",
      "sessionId": "s-231",
      "properties": { "$pathname": "/docs/install", "$browser": "Chrome" }
    }
  ],
  "next": "2026-10-16T16:53:59.968Z_c35e7bf7-…"
}
```

`next` is `null` on the last page. `person` is the identified id when an anonymous id has been
linked to one.

## `GET /api/v1/persons/{distinctId}`: one person

The person a distinct id belongs to. URL-encode the id.

```json
{
  "person": "grace@example.com",
  "distinctIds": ["grace@example.com", "anon/slash"],
  "properties": { "email": "grace@example.com", "plan": "pro" },
  "events": 2,
  "firstSeen": "2026-10-16T17:38:45.000Z",
  "lastSeen": "2026-10-16T17:38:45.000Z"
}
```

A distinct id the project has never seen gets a `404` with `{"error": "not_found"}`. To export or
delete a person's data, see [privacy.md](privacy.md).

All responses are sent with `cache-control: no-store`.
