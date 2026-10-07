# Build context: repository root (needs the workspace lockfile and clickhouse/migrations).
FROM oven/bun:1.4 AS build
WORKDIR /repo
COPY package.json bun.lock ./
COPY app/package.json app/package.json
COPY packages/sdk-browser/package.json packages/sdk-browser/package.json
RUN bun install --frozen-lockfile
COPY app app
RUN cd app && bun run build

FROM oven/bun:1.4-slim
WORKDIR /srv/app
ENV NODE_ENV=production DATABASE_URL=file:/data/footprint.db CLICKHOUSE_MIGRATIONS=/srv/clickhouse/migrations
COPY --from=build /repo/app/package.json ./
RUN bun install --production --ignore-scripts
COPY --from=build /repo/app/build ./build
COPY --from=build /repo/app/scripts ./scripts
COPY --from=build /repo/app/src/lib/server ./src/lib/server
COPY --from=build /repo/app/drizzle ./drizzle
COPY clickhouse/migrations /srv/clickhouse/migrations
VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "bun ./scripts/migrate.ts && bun ./build"]
