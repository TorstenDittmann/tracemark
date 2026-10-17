mod common;

use std::io::Write;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{DateTime, Utc};
use common::{TEST_KEY, TEST_PROJECT, app, app_with_keys, drain, post, send};
use flate2::Compression;
use flate2::write::GzEncoder;
use serde_json::{Value, json};
use tower::ServiceExt;
use tracemark_ingest::keys::KeyStore;

fn event(uuid: u128) -> Value {
    json!({
        "uuid": uuid::Uuid::from_u128(uuid).to_string(),
        "event": "$pageview",
        "distinct_id": "user_123",
        "timestamp": "2026-10-07T20:59:58.120Z",
        "properties": {"$current_url": "https://example.com/pricing"}
    })
}

fn body(events: Vec<Value>) -> String {
    json!({"api_key": TEST_KEY, "batch": events}).to_string()
}

fn gzip(data: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::fast());
    encoder.write_all(data).unwrap();
    encoder.finish().unwrap()
}

fn gzip_post(data: Vec<u8>) -> Request<Body> {
    Request::post("/e")
        .header("content-type", "application/json")
        .header("content-encoding", "gzip")
        .body(Body::from(data))
        .unwrap()
}

#[tokio::test]
async fn health_is_ok() {
    let (app, _rx) = app(10);
    let request = Request::get("/health").body(Body::empty()).unwrap();
    let (status, body) = send(&app, request).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "ok");
}

#[tokio::test]
async fn accepts_batch_and_enqueues_rows() {
    let (app, mut rx) = app(10);
    let (status, body) = send(&app, post("/e", body(vec![event(1), event(2)]))).await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body, json!({"accepted": 2}));
    let rows = drain(&mut rx);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].project_id, TEST_PROJECT);
    assert_eq!(rows[0].uuid, uuid::Uuid::from_u128(1));
    assert_eq!(rows[0].timestamp, "2026-10-07 20:59:58.120");
    assert_eq!(
        rows[0].properties["$current_url"],
        "https://example.com/pricing"
    );
}

#[tokio::test]
async fn corrects_clock_skew_from_sent_at() {
    let (app, mut rx) = app(10);
    // The client clock is one hour behind the server.
    let sent_at = Utc::now() - chrono::TimeDelta::hours(1);
    let request = json!({
        "api_key": TEST_KEY,
        "sent_at": sent_at.to_rfc3339(),
        "batch": [event(1)]
    });
    let (status, _) = send(&app, post("/e", request.to_string())).await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let row = drain(&mut rx).remove(0);
    let stored: DateTime<Utc> = format!("{}Z", row.timestamp.replace(' ', "T"))
        .parse()
        .unwrap();
    let original: DateTime<Utc> = "2026-10-07T20:59:58.120Z".parse().unwrap();
    let shift = (stored - original).num_seconds();
    assert!((3599..=3601).contains(&shift), "shifted by {shift}s");
}

#[tokio::test]
async fn accepts_api_key_from_query_string() {
    let (app, mut rx) = app(10);
    let request = json!({"batch": [event(1)]}).to_string();
    let (status, _) = send(&app, post(&format!("/e?api_key={TEST_KEY}"), request)).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(drain(&mut rx).len(), 1);
}

#[tokio::test]
async fn rejects_missing_or_unknown_key() {
    let (app, mut rx) = app(10);
    let missing = json!({"batch": [event(1)]}).to_string();
    let unknown = json!({"api_key": "fp_pub_nope", "batch": [event(1)]}).to_string();

    for request in [missing, unknown] {
        let (status, body) = send(&app, post("/e", request)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({"error": "invalid_api_key"}));
    }
    assert!(drain(&mut rx).is_empty());
}

#[tokio::test]
async fn returns_503_before_keys_are_loaded() {
    let (app, _rx) = app_with_keys(KeyStore::new(), 10);
    let (status, body) = send(&app, post("/e", body(vec![event(1)]))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body["error"], "not_ready");
}

#[tokio::test]
async fn rejects_malformed_json() {
    let (app, _rx) = app(10);
    let (status, body) = send(&app, post("/e", "{not json")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["error"], "invalid_batch");
    assert_eq!(body["details"][0]["field"], "body");
}

#[tokio::test]
async fn rejects_whole_batch_and_lists_details() {
    let (app, mut rx) = app(10);
    let mut bad = event(2);
    bad["event"] = json!("");
    let (status, body) = send(&app, post("/e", body(vec![event(1), bad]))).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body["details"],
        json!([{"index": 1, "field": "event", "message": "must not be empty"}])
    );
    assert!(drain(&mut rx).is_empty());
}

#[tokio::test]
async fn rejects_more_than_1000_events() {
    let (app, _rx) = app(10_000);
    let events = (0..1001).map(event).collect();
    let (status, body) = send(&app, post("/e", body(events))).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(body, json!({"error": "payload_too_large"}));
}

#[tokio::test]
async fn accepts_exactly_1000_events() {
    let (app, mut rx) = app(10_000);
    let events = (0..1000).map(event).collect();
    let (status, _) = send(&app, post("/e", body(events))).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(drain(&mut rx).len(), 1000);
}

#[tokio::test]
async fn rejects_body_over_5_mb() {
    let (app, _rx) = app(10);
    let padding = "x".repeat(5 * 1024 * 1024);
    let request = json!({"api_key": TEST_KEY, "pad": padding, "batch": []}).to_string();
    let (status, _) = send(&app, post("/e", request)).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn accepts_gzip_body() {
    let (app, mut rx) = app(10);
    let request = gzip_post(gzip(body(vec![event(1)]).as_bytes()));
    let (status, body) = send(&app, request).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    assert_eq!(drain(&mut rx).len(), 1);
}

#[tokio::test]
async fn rejects_gzip_that_inflates_past_5_mb() {
    let (app, _rx) = app(10);
    let padding = "x".repeat(6 * 1024 * 1024);
    let request = json!({"api_key": TEST_KEY, "pad": padding, "batch": []}).to_string();
    let compressed = gzip(request.as_bytes());
    assert!(compressed.len() < 1024 * 1024);
    let (status, _) = send(&app, gzip_post(compressed)).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn rejects_corrupt_gzip() {
    let (app, _rx) = app(10);
    let (status, body) = send(&app, gzip_post(b"definitely not gzip".to_vec())).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["details"][0]["field"], "body");
}

#[tokio::test]
async fn returns_503_when_queue_is_full() {
    let (app, mut rx) = app(2);
    let (status, _) = send(&app, post("/e", body(vec![event(1)]))).await;
    assert_eq!(status, StatusCode::ACCEPTED);

    // One slot left: a two-event batch must be refused as a whole.
    let (status, body) = send(&app, post("/e", body(vec![event(2), event(3)]))).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, json!({"error": "overloaded"}));
    assert_eq!(drain(&mut rx).len(), 1);
}

#[tokio::test]
async fn answers_cors_preflight() {
    let (app, _rx) = app(10);
    let request = Request::options("/e")
        .header("origin", "https://example.com")
        .header("access-control-request-method", "POST")
        .header("access-control-request-headers", "content-type")
        .body(Body::empty())
        .unwrap();
    let response = app.oneshot(request).await.unwrap();

    assert!(response.status().is_success());
    let headers = response.headers();
    assert_eq!(headers["access-control-allow-origin"], "*");
    let methods = headers["access-control-allow-methods"].to_str().unwrap();
    assert!(methods.contains("POST"));
    let allowed = headers["access-control-allow-headers"].to_str().unwrap();
    assert!(allowed.contains("content-type"));
}

#[tokio::test]
async fn sets_cors_header_on_post() {
    let (app, _rx) = app(10);
    let mut request = post("/e", body(vec![]));
    request
        .headers_mut()
        .insert("origin", "https://example.com".parse().unwrap());
    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(response.headers()["access-control-allow-origin"], "*");
}
