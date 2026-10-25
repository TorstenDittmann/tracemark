# tracemark

Lightweight, self-hosted product analytics: web and product analytics, error tracking, AI observability, feature flags, experiments, and people/group identification. Nothing else.

## What's in it

- **Product and web analytics**: trends, funnels, retention, paths and lifecycle insights, dashboards, a web analytics page with web vitals, and opt-in click and form autocapture.
- **Error tracking**: exceptions grouped into issues, source maps, and status (resolved, ignored, regressed).
- **AI observability**: LLM calls, traces and spans with cost, tokens and latency, plus scores and user feedback.
- **Feature flags and experiments**: rollouts, multivariate flags with payloads, local evaluation, and experiment results.
- **People and groups**: identified persons, groups (companies, teams), cohorts, and personal data export and deletion.
- **Alerts**: webhooks to Slack, Discord or your own endpoint for new issues, event counts and AI cost.

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
| `packages/sdk-browser/` | `@tracemark/browser`, the browser SDK (~5 KB gzipped) |
| `packages/sdk-node/` | `@tracemark/node`, the Node SDK ([docs](docs/sdk-node.md)) |
| `packages/sdk-python/` | `tracemark-sdk`, the Python server SDK ([docs](docs/sdk-python.md)) |
| `packages/sdk-go/` | The Go server SDK ([docs](docs/sdk-go.md)) |
| `packages/schema/fixtures/` | Request bodies every SDK and the ingest service test against |
| `clickhouse/migrations/` | ClickHouse schema |
| `docs/ingest-protocol.md` | The wire protocol between SDKs and ingest |
| `docs/privacy.md` | Data retention, personal data export and deletion |
| `docs/internal-users.md` | Filtering out your own team's traffic |
| `docs/usage.md` | The Usage page: event volume per project and ClickHouse disk use |
| `docs/kubernetes.md` | Running tracemark on Kubernetes with the Helm chart |
| `deploy/helm/tracemark/` | The Helm chart |
| `docs/frameworks.md` | React, Next.js, Svelte, SvelteKit, Vue, Nuxt, Astro and Node server integrations |
| `docs/autocapture.md` | Click, form and web vitals autocapture in the browser SDK |
| `docs/errors.md` | Error tracking, issue grouping and source maps |
| `docs/ai.md` | AI observability: SDK wrappers, OpenTelemetry, cost, scores |
| `docs/flags-api.md` | Feature flag evaluation API and bucketing |
| `docs/experiments.md` | Experiments and how results are counted |
| `docs/insights.md` | Insight kinds, with how paths and lifecycle count |
| `docs/query-api.md` | The read API: queries, saved insights, events and persons |
| `docs/alerts.md` | Alerts: webhooks to Slack, Discord or your own endpoint for issues, event counts and AI cost |
| `CHANGELOG.md` | Release notes |

## Self-hosting

```sh
cp .env.example .env            # set INTERNAL_TOKEN and AUTH_SECRET (openssl rand -hex 32 each)
docker compose up -d
```

Open `http://localhost:8080`. The first visit asks you to create the owner account and an organization; after that, create a project to get its public key. Invite teammates from **Team**: tracemark doesn't send email, so you copy each invitation's link and send it yourself. To let anyone create an account and their own organization at `/signup`, set `ALLOW_SIGNUP=on`. Everything is served on one port (default `8080`): `/e` goes to the ingest service, everything else to the app. Set `TRACEMARK_HOST=analytics.example.com` and `PUBLIC_URL=https://analytics.example.com` to get automatic HTTPS. Sign-in uses [better-auth](https://www.better-auth.com).

For a production server, `docker-compose.prod.yml` runs the published images from GitHub Container Registry instead of building from source, and serves HTTPS on ports 80 and 443. Copy it, `Caddyfile` and `.env.example` to the server, point your hostname's DNS at it, and in `.env` set `INTERNAL_TOKEN`, `AUTH_SECRET`, `CLICKHOUSE_PASSWORD`, `TRACEMARK_HOST` and `PUBLIC_URL`. Pin a release with `TRACEMARK_VERSION=0.1.0` (default `latest`). Then:

```sh
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d   # upgrade
```

On [Dokploy](https://dokploy.com), use `docker-compose.dokploy.yml`; see [docs/dokploy.md](docs/dokploy.md). On Kubernetes, use the Helm chart in `deploy/helm/tracemark`; see [docs/kubernetes.md](docs/kubernetes.md).

## Tracking events

```ts
import { tracemark } from '@tracemark/browser';

tracemark.init({ apiKey: 'fp_pub_…', host: 'https://analytics.example.com' });
tracemark.capture('signed_up', { plan: 'pro' });
tracemark.identify('user_123', { set: { email: 'ada@example.com' } });
```

Page views, including SPA navigations, are captured automatically. Clicks, form submits and web vitals (LCP, INP, CLS, FCP, TTFB) can be too, with `autocaptureClicks`, `autocaptureForms` and `autocaptureWebVitals`; the Web page then shows each vital's 75th percentile by path. See [docs/autocapture.md](docs/autocapture.md).

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

## Releasing npm packages

The 10 public JavaScript packages are released together. See [docs/releases.md](docs/releases.md) for first-time npm setup, local publishing and the `npm-v*` GitHub Actions workflow.

## License

MIT
