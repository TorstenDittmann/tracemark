# Changelog

## 0.1.0

The first release. The app and ingest images are published as `ghcr.io/torstendittmann/tracemark-app` and `ghcr.io/torstendittmann/tracemark-ingest`, and the JavaScript SDKs as `@tracemark/*` on npm.

### Analytics

- Trends, funnels, retention, paths and lifecycle insights, saved insights and dashboards.
- A web analytics page: visitors, sessions, bounce rate, pages, referrers, UTM campaigns, locations and devices, with web vitals (LCP, INP, CLS, FCP, TTFB) at the 75th percentile by path.
- Opt-in click and form autocapture in the browser SDK, with text capped and input values never read.
- Cookieless mode with a daily rotating salt.
- An event browser with event and property definitions.
- Filter out internal and test users per project.

### Error tracking

- Exceptions captured by the browser, Node, Python and Go SDKs and the framework helpers, grouped into issues at ingest.
- Issue status (open, resolved, ignored, regressed) and source map upload with the `@tracemark/cli`.

### AI observability

- LLM generations, embeddings, traces and spans from the Anthropic, OpenAI and Vercel AI SDK wrappers and from OpenTelemetry.
- Cost from built-in model prices (models.dev) or your own, by model and by person.
- Scores and user feedback on traces (`$ai_score`), charted by score name and model.

### Feature flags and experiments

- Boolean and multivariate flags with payloads, rollouts and targeting, evaluated by `POST /flags` or locally in the server SDKs.
- Experiments on flag variants with results per metric.

### People and groups

- Identified persons linked to their anonymous ids, groups such as companies, and cohorts.
- Personal data export and deletion, and data retention.

### Alerts

- Webhooks to Slack, Discord or any endpoint, signed with HMAC-SHA256.
- Rules for new and regressed issues, event counts above or below a threshold, and AI cost.

### Self-hosting

- Docker Compose for development and production, a Dokploy compose file and a Helm chart.
- Owner setup, organizations, teammate invitations, organization rename, and a step-by-step install guide with coding agent prompts for every framework.
- A mock data button to try every page before sending real events.
- A read API (`/api/v1`) for queries, saved insights, events and persons.

### SDKs

- `@tracemark/browser`, `@tracemark/node`, `@tracemark/react`, `@tracemark/next`, `@tracemark/svelte`, `@tracemark/sveltekit`, `@tracemark/vue`, `@tracemark/nuxt`, `@tracemark/astro` and `@tracemark/cli` on npm.
- `tracemark-sdk` for Python and the Go SDK (not yet published to PyPI or tagged as a Go module).
