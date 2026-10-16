# Data retention and personal data

## Retention

Each project keeps its events forever unless you set a retention period under
**Settings → Data retention** (30 days to 5 years). Owners and admins can change it.

Every few hours, the app deletes events older than the period. The first sweep runs a minute after
the app starts. Shortening the period deletes the older events in that sweep, and they cannot be
restored. People, their properties and group properties are kept, since they describe the present
rather than the past.

Deletes are ClickHouse lightweight deletes: rows disappear from every screen at once and from disk
when ClickHouse next merges the affected parts.

## Access requests

A person's page has an **Export JSON** button. The file holds their person key, every distinct id
linked to them, their person properties, and their events (up to 100,000, oldest first; `truncated`
is `true` when there were more). Any project member can export.

## Erasure requests

**Delete person** on a person's page removes, for every distinct id linked to the person:

- their events,
- their identity links (which anonymous ids became which person),
- their person properties,
- their membership in static cohorts.

Only owners and admins can delete a person. Events sent later with one of the same ids start a new
person, so stop tracking the person in your app first (for example with the browser SDK's `optOut()`).

Deleting a project removes all of its events, people, groups and cohort members the same way.
