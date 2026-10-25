# Usage

An organization's **Usage** tab (next to **Team**) shows how many events its projects store and
what takes up disk in ClickHouse, over the last 7, 30 or 90 days.

## Who sees what

| | Members | Owners and admins |
| --- | --- | --- |
| Events per day, by project and by category | Yes | Yes |
| ClickHouse storage per table | No | Yes |
| Estimated storage per project | No | Yes |

Members already see every project's events, so their volume tells them nothing new. Storage
covers the whole ClickHouse server, other organizations and databases included, so only owners
and admins see it.

## Events

Events count on the UTC day ClickHouse stored them (`inserted_at`), not the day they happened, so
a batch of old events sent today counts today. Every stored row counts: internal users are
included, and a retried event counts twice until ClickHouse merges the duplicates away.

| Category | Events |
| --- | --- |
| Page views | `$pageview`, `$pageleave` |
| Autocapture | `$autocapture`, `$web_vitals` |
| Exceptions | `$exception` |
| AI | `$ai_*` (generations, embeddings, spans, traces, scores) |
| People and groups | `$identify`, `$set`, `$groupidentify` |
| Other reserved | Any other `$` event, such as `$feature_flag_called` |
| Custom events | Events without a `$` prefix |

See [ingest-protocol.md](ingest-protocol.md#reserved-events) for the reserved events.

## Storage

The storage table lists every table with active parts in ClickHouse's `system.parts`: rows, parts,
compressed bytes (what's on disk) and uncompressed bytes. Tables in Tracemark's own database are
marked; others, such as ClickHouse's `system.query_log`, can grow large too.

A project's storage is an **estimate**: its share of all rows in the `events` table times that
table's compressed size. Projects' events differ in size, and deleted or duplicate rows stay on
disk until a merge, so treat it as a rough guide.

When Tracemark's ClickHouse user can't read `system.parts`, the storage card says so and the rest
of the page still works. To show it, grant the user `SELECT ON system.parts`.

## Using less disk

Set a retention period in each project's **Settings → Data retention**. Events older than it are
deleted every few hours, and leave the disk when ClickHouse next merges their parts. See
[privacy.md](privacy.md#retention).
