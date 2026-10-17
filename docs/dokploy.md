# Dokploy

`docker-compose.dokploy.yml` runs the published app and ingest images and ClickHouse behind
Dokploy's Traefik, which issues the TLS certificate. There is no Caddy in this setup.

## Deploy

1. Point the hostname's DNS (an A record, e.g. `analytics.example.com`) at the Dokploy server.
2. In Dokploy, create a project and add a **Compose** service (type Docker Compose).
3. Under **General**, pick this repository as the source (Git or GitHub provider, branch `main`)
   and set **Compose Path** to `./docker-compose.dokploy.yml`.
4. Under **Environment**, set:

   ```sh
   TRACEMARK_DOMAIN=analytics.example.com
   INTERNAL_TOKEN=      # openssl rand -hex 32
   AUTH_SECRET=         # openssl rand -hex 32
   CLICKHOUSE_PASSWORD= # openssl rand -hex 32
   TRACEMARK_VERSION=   # optional, e.g. 0.1.0; default latest
   GEOIP_DB=            # optional, see the README
   ```

5. Click **Deploy**, then open `https://analytics.example.com`. The first visit asks you to create
   the owner account and an organization.

Leave the service's **Domains** tab empty. The compose file labels the Traefik routes itself
because ingest needs exact paths: `/e`, `/e/*` and `/v1/traces` go to ingest, everything else to
the app, and plain HTTP redirects to HTTPS. A Domains entry with path `/e` would become a prefix
match and also catch app pages such as `/experiments`.

Keep `AUTH_SECRET` stable: changing it signs everyone out.

## Upgrade

The app and ingest images are pulled on every deploy, so with `TRACEMARK_VERSION` empty or
`latest`, redeploying the service picks up the newest release. To
pin a release, set `TRACEMARK_VERSION` to it and redeploy.

## Commands

Run the admin scripts from the app container's terminal in Dokploy (**Docker** tab, or the
service's terminal), for example `bun run reset-password --email ada@example.com`.
