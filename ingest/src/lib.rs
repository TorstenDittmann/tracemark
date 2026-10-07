//! footprint ingest service: accepts SDK event batches and writes them to ClickHouse.

pub mod config;
pub mod keys;
pub mod protocol;
pub mod routes;
pub mod writer;
