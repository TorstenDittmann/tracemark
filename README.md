# footprint

Lightweight, self-hosted product analytics: web and product analytics, error tracking, AI observability, feature flags, experiments, and people/group identification. Nothing else.

> Early development. Ingestion, storage, the browser SDK, sign-in and project management work today; analytics views come next.

## How it fits together

```
SDKs ──POST /e──▶ ingest (Rust) ──batched inserts──▶ ClickHouse (events)
                     │ project keys (cached)
                     ▼
                 app (SvelteKit on Bun) ──▶ libSQL (config) + ClickHouse (queries)
```

| Path | What |
| --- | --- |
| `ingest/` | Rust service that validates, batches and writes events to ClickHouse |
| `app/` | SvelteKit app on Bun: dashboard, flags and query APIs, migrations |
| `packages/sdk-browser/` | `@footprint/browser`, the browser SDK (~3 KB gzipped) |
| `packages/schema/fixtures/` | Request bodies every SDK and the ingest service test against |
| `clickhouse/migrations/` | ClickHouse schema |
| `docs/ingest-protocol.md` | The wire protocol between SDKs and ingest |
| `docs/privacy.md` | Data retention, personal data export and deletion |

## Self-hosting

```sh
cp .env.example .env            # set INTERNAL_TOKEN and AUTH_SECRET (openssl rand -hex 32 each)
docker compose up -d
```

Open `http://localhost:8080`. The first visit asks you to create the owner account and an organization; after that, create a project to get its public key. Invite teammates from **Team**: footprint doesn't send email, so you copy each invitation's link and send it yourself. Everything is served on one port (default `8080`): `/e` goes to the ingest service, everything else to the app. Set `FOOTPRINT_HOST=analytics.example.com` and `PUBLIC_URL=https://analytics.example.com` to get automatic HTTPS. Sign-in uses [better-auth](https://www.better-auth.com).

## Tracking events

```ts
import { footprint } from '@footprint/browser';

footprint.init({ apiKey: 'fp_pub_…', host: 'https://analytics.example.com' });
footprint.capture('signed_up', { plan: 'pro' });
footprint.identify('user_123', { set: { email: 'ada@example.com' } });
```

Page views, including SPA navigations, are captured automatically.

The ingest service adds `$browser`, `$browser_version`, `$os`, `$os_version` and `$device_type` from the request's user agent. Crawlers get `$device_type: "Bot"`. Location properties (`$geoip_country_code`, `$geoip_city_name` and others) need a city database: download [DB-IP City Lite](https://db-ip.com/db/download/ip-to-city-lite) (free, CC BY 4.0) or MaxMind GeoLite2 City in `.mmdb` format into `./geoip/`, set `GEOIP_DB=/geoip/<file>.mmdb` in `.env` and restart ingest. Client IPs are only used for the lookup and are never stored. Server-side SDKs can pass the visitor's `$ip` and `$user_agent` as event properties, or set `$geoip_disable: true`.

## Administration

```sh
docker compose exec app bun run reset-password --email ada@example.com   # set a new password, sign out everywhere
docker compose exec app bun run create-project --org "Acme" --name "Website"   # scripted project setup
```

## Development

Requirements: Bun ≥ 1.4, Rust stable, and a ClickHouse server on `localhost:8123`.

```sh
bun install
cd app && bun run migrate && bun run dev   # app on :5173
cd ingest && INTERNAL_TOKEN=dev APP_INTERNAL_URL=http://localhost:5173 cargo run
```

Checks: `bun run check`, `bun run typecheck`, `bun run test`, and `cargo fmt --check && cargo clippy && cargo test` in `ingest/`.

## License

MIT
