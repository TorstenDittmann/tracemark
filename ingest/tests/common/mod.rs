#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use tracemark_ingest::enrich::Enricher;
use tracemark_ingest::keys::KeyStore;
use tracemark_ingest::protocol::Row;
use tracemark_ingest::routes::{self, AppState};
use serde_json::Value;
use tokio::sync::mpsc;
use tower::ServiceExt;
use uuid::Uuid;

pub const TEST_KEY: &str = "fp_pub_test";
pub const TEST_PROJECT: Uuid = Uuid::from_u128(0x5f0c_0000_0000_4000_8000_0000_0000_0001);

pub fn fake_keys() -> KeyStore {
    KeyStore::from_map(HashMap::from([(TEST_KEY.to_owned(), TEST_PROJECT)]))
}

/// A router backed by the fake key store and a channel the test can drain.
pub fn app(capacity: usize) -> (Router, mpsc::Receiver<Row>) {
    app_with_keys(fake_keys(), capacity)
}

pub fn app_with_keys(keys: KeyStore, capacity: usize) -> (Router, mpsc::Receiver<Row>) {
    app_with(keys, Enricher::new(None), capacity)
}

pub fn app_with(
    keys: KeyStore,
    enricher: Enricher,
    capacity: usize,
) -> (Router, mpsc::Receiver<Row>) {
    let (events, rx) = mpsc::channel(capacity);
    let state = AppState {
        keys,
        events,
        enricher: Arc::new(enricher),
    };
    (routes::router(state), rx)
}

pub fn post(uri: &str, body: impl Into<Body>) -> Request<Body> {
    Request::post(uri)
        .header("content-type", "application/json")
        .body(body.into())
        .unwrap()
}

pub async fn send(app: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()));
    (status, body)
}

pub fn drain(rx: &mut mpsc::Receiver<Row>) -> Vec<Row> {
    let mut rows = Vec::new();
    while let Ok(row) = rx.try_recv() {
        rows.push(row);
    }
    rows
}
