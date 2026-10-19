# Alerts

Alerts post a message to a webhook when something happens in a project: a new error issue, a
regression, an event count crossing a threshold, or AI spend getting out of hand. Set them up
under **Alerts** in a project's sidebar. Everyone in the organization can see them; only owners
and admins can change them or send a test.

## Destinations

A destination is a URL alerts are posted to, in one of three formats:

- **Slack**: an [incoming webhook](https://api.slack.com/messaging/webhooks) URL. Messages are
  `{"text": "…"}` with the title in bold and a link back to Tracemark.
- **Discord**: a channel webhook URL (channel settings → Integrations → Webhooks). Messages are
  one embed, red while firing, green when resolved.
- **Generic JSON**: anything else. The body looks like this:

```json
{
  "type": "alert.firing",
  "title": "Checkout errors in Website",
  "text": "Now 31 checkout_failed events in the last hour\nRule: More than 25 checkout_failed events in the last hour",
  "url": "https://analytics.example.com/projects/…/alerts",
  "project": { "id": "…", "name": "Website" },
  "rule": { "id": "…", "name": "Checkout errors", "kind": "metric" },
  "value": 31,
  "threshold": 25,
  "issues": [],
  "timestamp": "2026-10-16T12:00:00.000Z"
}
```

`type` is `alert.firing`, `alert.resolved` or `alert.test`. Issue alerts list their issues as
`{ fingerprint, type, value, occurrences, url }`. `url` is null unless `PUBLIC_URL` is set.

**Send test** posts an `alert.test` message so you can check a destination works. Each destination
shows how its last delivery went, and the page lists the last 20 deliveries of the project (the
newest 50 are kept).

### Signatures

Give a destination a secret and every request carries
`X-Tracemark-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw request body with the secret.
Check it before trusting the body:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(body: string, header: string | null, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return header !== null && header.length === expected.length &&
    timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

Requests are a `POST` with `content-type: application/json` and `user-agent: Tracemark-Alerts`.
A destination has 10 seconds to answer with a 2xx status; redirects are not followed. Failed
deliveries are recorded but not retried.

## Rules

Each rule notifies one or more destinations.

- **Error issue**: a new issue appears (its first exception arrives), or a resolved issue happens
  again (a regression, see [errors.md](errors.md)). Every new issue and every regression is sent
  once; several found in the same minute go out as one message. Ignored issues never alert.
- **Event count**: the number of events, of one name or of all, in the last 15 minutes, hour,
  6 hours, day or 7 days goes above or below a threshold.
- **AI cost**: the cost of AI generations and embeddings ([ai.md](ai.md)) in a window goes above
  a threshold in USD.

Event count and AI cost rules fire once when the condition starts to hold and, if you tick
**Also notify when it clears**, once when it stops. The **cooldown** is the least time between
two firing messages of a rule, so a value that flaps around the threshold doesn't flood the
channel; a firing that the cooldown kept quiet doesn't send a resolved message either.

Saving or resuming a rule starts it over: a threshold that already holds fires on the next check,
and issue rules only look at exceptions that arrive from then on. Paused rules aren't checked.

## How checks run

The app checks every enabled rule once a minute, starting 15 seconds after it boots:

- Threshold rules count events by their timestamp over the window ending now.
- Issue rules look at exceptions by when ClickHouse stored them (`inserted_at`), from where the
  last check stopped to 30 seconds ago, so events that arrive late or out of order are noticed
  exactly once. After downtime they catch up on at most a day.

What a rule last saw (firing or not, the last value, where issue checks stopped, when it last
fired, and why the last check failed, if it did) is kept on its row in libSQL, so restarts don't
send anything twice.

The checks don't run during `vite build` or in tests. Set `ALERTS=off` to keep an app process
from checking rules at all.

### Several app replicas

Every replica runs the timer, but only one checks rules at a time. Before each check a replica
takes or renews a lease, a row named `alerts` in the `job_leases` table, valid for two minutes.
While the holder keeps renewing it every minute, the others skip; if it stops, another replica
takes over within about two minutes. A check that runs longer than the lease (many rules with
slow destinations) could overlap with another replica's, so in the worst case a message is sent
twice; nothing is lost. With libSQL over sqld or Turso this needs no other setup; with a `file:`
database there is one app process anyway.
