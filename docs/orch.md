# orch

[orch](https://orch.torsten.work) runs `deploy/orch/orch.pkl` on your own servers: the published
app and ingest images, a ClickHouse database that orch manages, and tracemark's own Caddy proxy.
orch's ingress terminates TLS for your domain and forwards everything to that proxy, which sends
`/e`, `/e/*` and `/v1/traces` to ingest and everything else to the app, exactly like the plain
compose setup.

## Deploy

1. Set up an orch cluster ([installation](https://orch.torsten.work/installation/)) and enable
   ingress on at least one worker.
2. Point the hostname's DNS (an A record, e.g. `analytics.example.com`) at your ingress nodes and
   allow TCP 80 and 443 to them.
3. Copy `deploy/orch/orch.pkl` and set `domain` at the top. Optionally pin `version` to a release,
   e.g. `"0.1.0"`, and set `allowSignup = true` to let anyone create an account at `/signup`.
4. Store the two secrets tracemark needs:

   ```sh
   openssl rand -hex 32 | tr -d '\n' | orch secret set tracemark internal-token --from-stdin --target production
   openssl rand -hex 32 | tr -d '\n' | orch secret set tracemark auth-secret --from-stdin --target production
   ```

   orch generates the ClickHouse password into `clickhouse-password` on the first deploy.

5. Deploy:

   ```sh
   orch validate
   orch deploy --wait --target production
   ```

6. Open `https://analytics.example.com`. The first visit asks you to create the owner account and
   an organization.

Keep `auth-secret` stable: changing it signs everyone out.

## What runs

| Service | What | State |
| --- | --- | --- |
| `proxy` | `caddy:2`, routing between app and ingest. Its Caddyfile is inline in `orch.pkl` | None |
| `app` | The dashboard and APIs. It creates the ClickHouse tables on start | Local volume `app-data` (libSQL file, source maps), backed up nightly |
| `ingest` | Event and OTLP ingestion | Local volume `ingest-spill` for batches ClickHouse couldn't take yet |
| `clickhouse` | An orch [ClickHouse database](https://orch.torsten.work/databases/), user `orch`, database `clickhouse` | Backed up nightly with `BACKUP DATABASE` |

Services with a local volume run one replica and stay on the worker that holds it. Only one
process may open the app's libSQL file, so the application deploys with `maxSurge = 0` and
`maxUnavailable = 1`: each service is stopped before its replacement starts, with a short gap
during every rollout.

Both app and ingest read the client address from `x-forwarded-for`, two hops from the right
(orch's ingress, then the proxy), for location lookups and sign-in rate limits.

## Upgrade

With `version = "latest"`, `deploy.autoUpdate` checks the registry every few minutes and rolls out
each new release, with the same health checks and automatic rollback as `orch deploy`. With a
pinned version, change it and run `orch deploy` again. `orch rollback tracemark REVISION` returns
to an earlier revision; see [deployments](https://orch.torsten.work/runtime/).

## Backups and restore

```sh
orch db backups tracemark clickhouse
orch db restore tracemark clickhouse
orch volume list
```

Add a [backup destination](https://orch.torsten.work/databases/) to copy them off the node.

## Commands

Run the admin scripts in the app container, for example:

```sh
orch exec tracemark app --target production -- bun run reset-password --email ada@example.com
orch logs tracemark ingest --tail 100 --target production
```

## Not covered

Location lookups need a city database file mounted into ingest, and orch has no way to ship a
file with the application. Build an ingest image that contains it and set `GEOIP_DB` in
`orch.pkl`, or leave location properties off.
