mod common;

use std::collections::HashMap;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::Utc;
use common::{TEST_KEY, TEST_PROJECT, app_with, drain, send};
use footprint_ingest::cookieless::{PLACEHOLDER, visitor_id};
use footprint_ingest::enrich::Enricher;
use footprint_ingest::keys::{KeyStore, Snapshot};
use serde_json::{Value, json};

fn keys(salt: Option<&str>) -> KeyStore {
    let mut salts = HashMap::new();
    if let Some(salt) = salt {
        salts.insert(Utc::now().format("%Y-%m-%d").to_string(), salt.to_owned());
    }
    KeyStore::from_map(Snapshot {
        keys: HashMap::from([(TEST_KEY.to_owned(), TEST_PROJECT)]),
        salts,
        ..Snapshot::default()
    })
}

fn request(ip: &str, user_agent: &str, events: Vec<Value>) -> Request<Body> {
    Request::post("/e")
        .header("content-type", "application/json")
        .header("user-agent", user_agent)
        .header("x-forwarded-for", ip)
        .body(Body::from(
            json!({"api_key": TEST_KEY, "batch": events}).to_string(),
        ))
        .unwrap()
}

fn event(n: u128, name: &str, distinct_id: &str, properties: Value) -> Value {
    json!({
        "uuid": uuid::Uuid::from_u128(n).to_string(),
        "event": name,
        "distinct_id": distinct_id,
        "timestamp": Utc::now().to_rfc3339(),
        "properties": properties
    })
}

fn enricher() -> Enricher {
    Enricher::new(None).with_address_header(Some("x-forwarded-for".into()), 1)
}

#[tokio::test]
async fn replaces_the_placeholder_with_the_daily_visitor_hash() {
    let (app, mut rx) = app_with(keys(Some("today")), enricher(), 10);
    let batch = vec![
        event(1, "$pageview", PLACEHOLDER, json!({})),
        event(
            2,
            "$identify",
            "user_1",
            json!({"$anon_distinct_id": PLACEHOLDER}),
        ),
        event(3, "$pageview", "user_1", json!({})),
    ];
    let (status, _) = send(&app, request("81.2.69.1", "agent", batch)).await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let expected = visitor_id(
        "today",
        TEST_PROJECT,
        Some("81.2.69.1".parse().unwrap()),
        Some("agent"),
    );
    let rows = drain(&mut rx);
    assert_eq!(rows[0].distinct_id, expected);
    assert_eq!(rows[1].distinct_id, "user_1");
    assert_eq!(rows[1].properties["$anon_distinct_id"], json!(expected));
    assert_eq!(rows[2].distinct_id, "user_1");

    // Another visitor on the same day gets a different id.
    let (_, _) = send(
        &app,
        request(
            "81.2.69.2",
            "agent",
            vec![event(4, "$pageview", PLACEHOLDER, json!({}))],
        ),
    )
    .await;
    assert_ne!(drain(&mut rx)[0].distinct_id, expected);
}

#[tokio::test]
async fn hashes_the_address_a_server_sdk_sends_for() {
    let (app, mut rx) = app_with(keys(Some("today")), enricher(), 10);
    let batch = vec![event(
        1,
        "$pageview",
        PLACEHOLDER,
        json!({"$ip": "203.0.113.9", "$user_agent": "visitor"}),
    )];
    send(&app, request("10.0.0.1", "server", batch)).await;
    let row = &drain(&mut rx)[0];
    assert_eq!(
        row.distinct_id,
        visitor_id(
            "today",
            TEST_PROJECT,
            Some("203.0.113.9".parse().unwrap()),
            Some("visitor")
        )
    );
    assert!(!row.properties.contains_key("$ip"));
}

#[tokio::test]
async fn retries_cookieless_batches_until_a_salt_is_loaded() {
    let (app, mut rx) = app_with(keys(None), enricher(), 10);
    let (status, body) = send(
        &app,
        request(
            "81.2.69.1",
            "agent",
            vec![event(1, "$pageview", PLACEHOLDER, json!({}))],
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(body, json!({"error": "not_ready"}));
    assert!(drain(&mut rx).is_empty());

    // Batches without the placeholder do not need one.
    let (status, _) = send(
        &app,
        request(
            "81.2.69.1",
            "agent",
            vec![event(2, "$pageview", "anon", json!({}))],
        ),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
}
