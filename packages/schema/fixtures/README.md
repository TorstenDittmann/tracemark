Shared fixtures for the ingest wire format. Every SDK and the Rust ingest service test against these.
- `valid/*.json`: request bodies `POST /e` must accept.
- `invalid/*.json`: request bodies `POST /e` must reject with 400.
