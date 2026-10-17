# Build context: repository root (needs the workspace lockfile and clickhouse/migrations).
FROM oven/bun:1.4 AS build
WORKDIR /repo
COPY package.json bun.lock ./
COPY app/package.json app/package.json
COPY packages/sdk-browser/package.json packages/sdk-browser/package.json
# Workspaces the copied ones depend on, so the pruned install resolves.
COPY packages/errors/package.json packages/errors/package.json
# Workspace packages the app bundles from source.
COPY tsconfig.base.json ./
COPY packages/flags packages/flags
RUN bun install --frozen-lockfile
COPY app app
WORKDIR /repo/app
RUN bun run build
# Scripts are bundled so the image needs no dev dependencies. libSQL loads a native
# module and the server build imports drizzle, so both stay external and are copied below.
RUN bun build scripts/start.ts scripts/migrate.ts scripts/create-project.ts scripts/reset-password.ts \
        --target bun --outdir /out/scripts --external @libsql/client --external 'drizzle-orm' --external 'drizzle-orm/*' \
    && bun scripts/copy-runtime-deps.ts /out @libsql/client drizzle-orm \
        --exclude @types+ --exclude bun-types@ --exclude -musl@
# The distroless image lacks libgcc_s, which libSQL's native module links, and a shell,
# which `bun run <script>` needs. dash only depends on libc.
RUN lib=usr/lib/$(uname -m)-linux-gnu && mkdir -p /out/root/$lib /out/root/usr/bin \
    && cp /$lib/libgcc_s.so.1 /out/root/$lib/ \
    && cp /bin/dash /out/root/usr/bin/sh

FROM oven/bun:1.4-distroless
WORKDIR /srv/app
ENV NODE_ENV=production DATABASE_URL=file:/data/tracemark.db CLICKHOUSE_MIGRATIONS=/srv/clickhouse/migrations
COPY app/docker/package.json ./
COPY --from=build /out/root/ /
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/scripts ./scripts
COPY --from=build /repo/app/build ./build
COPY app/drizzle ./drizzle
COPY clickhouse/migrations /srv/clickhouse/migrations
VOLUME /data
EXPOSE 3000
ENTRYPOINT []
CMD ["bun", "./scripts/start.js"]
