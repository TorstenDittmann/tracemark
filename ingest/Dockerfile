# syntax=docker/dockerfile:1

# Pin the Debian release so the binary's glibc matches the runtime image.
FROM rust:1-slim-bookworm AS builder
WORKDIR /build

# Build dependencies first so source edits do not invalidate this layer.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
    && echo 'fn main() {}' > src/main.rs \
    && touch src/lib.rs \
    && cargo build --release --locked \
    && rm -rf src

COPY src ./src
# Bump mtimes so cargo rebuilds the crate instead of reusing the stub.
RUN touch src/main.rs src/lib.rs \
    && cargo build --release --locked \
    && strip target/release/tracemark-ingest \
    && mkdir -p /out/spill

FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=builder /build/target/release/tracemark-ingest /app/tracemark-ingest
COPY --from=builder --chown=nonroot:nonroot /out/spill /app/spill
ENV PORT=8081 \
    SPILL_DIR=/app/spill
EXPOSE 8081
ENTRYPOINT ["/app/tracemark-ingest"]
