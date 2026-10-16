mod common;

use std::collections::HashMap;
use std::sync::Arc;

use axum::http::StatusCode;
use common::{TEST_KEY, TEST_PROJECT, app_with_keys, drain, post, send};
use footprint_ingest::ai::{Price, Prices};
use footprint_ingest::keys::{KeyStore, Snapshot};
use serde_json::json;

#[tokio::test]
async fn costs_generations_with_the_projects_prices() {
    let keys = KeyStore::from_map(Snapshot {
        keys: HashMap::from([(TEST_KEY.to_owned(), TEST_PROJECT)]),
        prices: Arc::new(Prices {
            defaults: vec![Price {
                model: "gpt-4o".into(),
                input: 2.5,
                output: 10.0,
                cache_read: None,
                cache_write: None,
            }],
            projects: HashMap::new(),
        }),
        ..Snapshot::default()
    });
    let (app, mut rx) = app_with_keys(keys, 10);
    let event = |n: u128, name: &str| {
        json!({
            "uuid": uuid::Uuid::from_u128(n),
            "event": name,
            "distinct_id": "ada",
            "timestamp": "2026-10-16T09:00:00.000Z",
            "properties": {
                "$ai_model": "gpt-4o-2024-08-06",
                "$ai_input_tokens": 1000,
                "$ai_output_tokens": 100
            }
        })
    };
    let body = json!({
        "api_key": TEST_KEY,
        "batch": [event(1, "$ai_generation"), event(2, "$ai_span")]
    });
    let (status, _) = send(&app, post("/e", body.to_string())).await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let rows = drain(&mut rx);
    assert_eq!(rows[0].properties["$ai_cost_usd"], json!(0.0035));
    assert_eq!(rows[0].properties["$ai_input_cost_usd"], json!(0.0025));
    assert_eq!(rows[0].properties["$ai_output_cost_usd"], json!(0.001));
    assert!(!rows[1].properties.contains_key("$ai_cost_usd"));
}
