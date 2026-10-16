# Kubernetes

The Helm chart in `deploy/helm/footprint` runs the same three services as `docker compose`: the app,
the ingest service and a single-node ClickHouse, behind one Ingress.

## Install

```sh
helm install footprint ./deploy/helm/footprint \
  --namespace footprint --create-namespace \
  --set publicUrl=https://analytics.example.com \
  --set ingress.host=analytics.example.com \
  --set ingress.className=nginx
```

Then open the public URL; the first visit asks you to create the owner account and an organization.

On install the chart generates `INTERNAL_TOKEN`, `AUTH_SECRET` and the ClickHouse password and
keeps them in a Secret named after the release, so upgrades reuse them. To manage them yourself,
create a Secret with the keys `INTERNAL_TOKEN`, `AUTH_SECRET` and `CLICKHOUSE_PASSWORD` and set
`existingSecret` and `clickhouse.existingSecret` to its name.

The chart pulls `ghcr.io/torstendittmann/footprint-app` and `footprint-ingest` at the chart's
`appVersion`. Images are published for each version tag; set `app.image.tag` and
`ingest.image.tag` to pin another one.

## Routing

The Ingress sends `/e` and `/v1/traces` to ingest and everything else to the app, like the
Caddyfile does for compose. With `ingress.enabled=false`, route the same paths in your own gateway
to the `<release>-ingest` service on port 8081 and the `<release>-app` service on port 3000.

Both services read the client address from `x-forwarded-for`, one hop from the right
(`app.xffDepth` and `ingest.xffDepth`). Raise the depth when more proxies sit in front of the
Ingress controller, or the location lookups and sign-in rate limits see the proxy's address.

## Storage and scaling

| Component | Storage | Replicas |
| --- | --- | --- |
| App | A volume for the libSQL file and source maps (`app.persistence`); kept when the release is uninstalled | Always 1, replaced with `Recreate`, because only one process may open the libSQL file |
| Ingest | An `emptyDir` for batches it couldn't write to ClickHouse yet | `ingest.replicas`; it is stateless otherwise |
| ClickHouse | A volume per pod (`clickhouse.persistence`) | 1 |

The ingest spill directory survives container restarts but not a deleted pod. Keep ClickHouse
healthy before draining ingest nodes.

## External ClickHouse

To use ClickHouse Cloud or your own cluster, create the database user and point the chart at it:

```sh
helm install footprint ./deploy/helm/footprint \
  --set publicUrl=https://analytics.example.com \
  --set clickhouse.enabled=false \
  --set clickhouse.external.url=https://abc123.eu-central-1.aws.clickhouse.cloud:8443 \
  --set clickhouse.user=footprint \
  --set clickhouse.password=…
```

The app creates the database and applies its migrations when it starts.

## Location lookups

Mount a MaxMind-format city database into ingest, for example from a ConfigMap or a volume you
fill yourself:

```yaml
ingest:
  geoip:
    volume:
      persistentVolumeClaim:
        claimName: geoip
    file: dbip-city-lite.mmdb
```

Every value is documented in `deploy/helm/footprint/values.yaml`.
