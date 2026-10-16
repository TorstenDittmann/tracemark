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
