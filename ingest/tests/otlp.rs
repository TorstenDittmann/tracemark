mod common;

use std::collections::HashMap;
use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{TEST_KEY, TEST_PROJECT, app, app_with_keys, drain, send};
use prost::Message;
use serde_json::{Value, json};
use tower::ServiceExt;
use tracemark_ingest::ai::{Price, Prices};
use tracemark_ingest::keys::{KeyStore, Snapshot};
use tracemark_ingest::otlp::proto::{
    AnyValue, ExportTraceServiceRequest, KeyValue, Resource, ResourceSpans, ScopeSpans, Span,
    Status, Value as V,
};

const TRACE: &str = "4bf92f3577b34da6a3ce929d0e0e4736";
const OUTER: &str = "00f067aa0ba902b7";
const INNER: &str = "b7ad6b7169203331";

fn keys_with_prices() -> KeyStore {
    KeyStore::from_map(Snapshot {
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
    })
}

fn otlp(content_type: &str, body: impl Into<Body>) -> Request<Body> {
    Request::post("/v1/traces")
        .header("content-type", content_type)
        .header("authorization", format!("Bearer {TEST_KEY}"))
        .body(body.into())
        .unwrap()
}

fn attr(key: &str, value: Value) -> Value {
    let value = match value {
        Value::String(s) => json!({ "stringValue": s }),
        Value::Number(n) if n.is_i64() => json!({ "intValue": n.to_string() }),
        Value::Number(n) => json!({ "doubleValue": n }),
        Value::Bool(b) => json!({ "boolValue": b }),
        other => panic!("unsupported {other}"),
    };
    json!({ "key": key, "value": value })
}

/// What the Vercel AI SDK exports for one `generateText` call, plus an unrelated HTTP span.
fn vercel_export() -> Value {
    json!({
        "resourceSpans": [{
            "resource": { "attributes": [attr("service.name", json!("chat-api"))] },
            "scopeSpans": [{
                "scope": { "name": "ai" },
                "spans": [
                    {
                        "traceId": TRACE,
                        "spanId": OUTER,
                        "name": "ai.generateText",
                        "startTimeUnixNano": "1792141200000000000",
                        "endTimeUnixNano": "1792141201500000000",
                        "attributes": [
                            attr("ai.operationId", json!("ai.generateText")),
                            attr("ai.telemetry.functionId", json!("answer-question")),
                            attr("ai.telemetry.metadata.userId", json!("user-42")),
                            attr("ai.model.id", json!("gpt-4o")),
                            attr("ai.usage.promptTokens", json!(1000)),
                            attr("ai.usage.completionTokens", json!(100))
                        ],
                        "status": {}
                    },
                    {
                        "traceId": TRACE,
                        "spanId": INNER,
                        "parentSpanId": OUTER,
                        "name": "ai.generateText.doGenerate",
                        "startTimeUnixNano": 1_792_141_200_100_000_000_u64,
                        "endTimeUnixNano": 1_792_141_201_400_000_000_u64,
                        "attributes": [
                            attr("ai.operationId", json!("ai.generateText.doGenerate")),
                            attr("ai.telemetry.metadata.userId", json!("user-42")),
                            attr("ai.model.provider", json!("openai.chat")),
                            attr("ai.model.id", json!("gpt-4o")),
                            attr("gen_ai.response.model", json!("gpt-4o-2024-08-06")),
                            attr("ai.prompt.messages", json!("[{\"role\":\"user\",\"content\":\"Hi\"}]")),
                            attr("ai.response.text", json!("Hello!")),
                            attr("ai.usage.promptTokens", json!(1000)),
                            attr("ai.usage.completionTokens", json!(100)),
                            attr("gen_ai.request.temperature", json!(0.5))
                        ]
                    },
                    {
                        "traceId": TRACE,
                        "spanId": "1111111111111111",
                        "parentSpanId": INNER,
                        "name": "POST",
                        "startTimeUnixNano": "1792141200200000000",
                        "endTimeUnixNano": "1792141201300000000",
                        "attributes": [attr("http.request.method", json!("POST"))]
                    }
                ]
            }]
        }]
    })
}

#[tokio::test]
async fn turns_vercel_ai_sdk_spans_into_ai_events() {
    let (app, mut rx) = app_with_keys(keys_with_prices(), 10);
    let response = app
        .clone()
        .oneshot(otlp("application/json", vercel_export().to_string()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let rows = drain(&mut rx);
    assert_eq!(rows.len(), 2, "the HTTP span is dropped");
    let (outer, inner) = (&rows[0], &rows[1]);

    assert_eq!(outer.event, "$ai_span");
    assert_eq!(outer.distinct_id, "user-42");
    assert_eq!(outer.timestamp, "2026-10-16 09:00:00.000");
    assert_eq!(outer.properties["$ai_trace_id"], TRACE);
    assert_eq!(outer.properties["$ai_span_name"], "answer-question");
    assert_eq!(outer.properties["$ai_latency"], json!(1.5));
    assert!(!outer.properties.contains_key("$ai_parent_id"));
    assert!(
        !outer.properties.contains_key("$ai_cost_usd"),
        "usage is counted once"
    );

    assert_eq!(inner.event, "$ai_generation");
    assert_eq!(inner.distinct_id, "user-42");
    let props = &inner.properties;
    assert_eq!(props["$ai_span_id"], INNER);
    assert_eq!(props["$ai_parent_id"], OUTER);
    assert_eq!(props["$ai_provider"], "openai");
    assert_eq!(props["$ai_model"], "gpt-4o-2024-08-06");
    assert_eq!(
        props["$ai_input"],
        json!([{ "role": "user", "content": "Hi" }])
    );
    assert_eq!(
        props["$ai_output_choices"],
        json!([{ "role": "assistant", "content": "Hello!" }])
    );
    assert_eq!(props["$ai_input_tokens"], json!(1000));
    assert_eq!(props["$ai_output_tokens"], json!(100));
    assert_eq!(props["$ai_temperature"], json!(0.5));
    assert_eq!(props["$ai_stream"], json!(false));
    assert_eq!(props["$ai_cost_usd"], json!(0.0035));
    assert_eq!(props["userId"], "user-42");
    assert_eq!(props["$geoip_disable"], json!(true));
    assert_ne!(inner.uuid, outer.uuid);

    // A retried export produces the same event ids.
    app.oneshot(otlp("application/json", vercel_export().to_string()))
        .await
        .unwrap();
    let again = drain(&mut rx);
    assert_eq!(again[1].uuid, inner.uuid);
}

fn kv(key: &str, value: V) -> KeyValue {
    KeyValue {
        key: key.into(),
        value: Some(AnyValue { value: Some(value) }),
    }
}

#[tokio::test]
async fn accepts_protobuf_gen_ai_spans() {
    let request = ExportTraceServiceRequest {
        resource_spans: vec![ResourceSpans {
            resource: Some(Resource {
                attributes: vec![kv("service.name", V::StringValue("worker".into()))],
            }),
            scope_spans: vec![ScopeSpans {
                scope: None,
                spans: vec![Span {
                    trace_id: hex::decode(TRACE).unwrap(),
                    span_id: hex::decode(INNER).unwrap(),
                    name: "chat claude-sonnet-4-5".into(),
                    start_time_unix_nano: 1_792_141_200_000_000_000,
                    end_time_unix_nano: 1_792_141_202_000_000_000,
                    attributes: vec![
                        kv("gen_ai.operation.name", V::StringValue("chat".into())),
                        kv("gen_ai.provider.name", V::StringValue("anthropic".into())),
                        kv(
                            "gen_ai.request.model",
                            V::StringValue("claude-sonnet-4-5".into()),
                        ),
                        kv("gen_ai.usage.input_tokens", V::IntValue(12)),
                        kv("gen_ai.usage.output_tokens", V::IntValue(0)),
                    ],
                    status: Some(Status {
                        message: "overloaded".into(),
                        code: 2,
                    }),
                    ..Span::default()
                }],
            }],
        }],
    };
    let (app, mut rx) = app(10);
    let response = app
        .oneshot(otlp("application/x-protobuf", request.encode_to_vec()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/x-protobuf");
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(body.is_empty());

    let rows = drain(&mut rx);
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.event, "$ai_generation");
    assert_eq!(row.distinct_id, "otel:worker");
    assert_eq!(row.properties["$ai_provider"], "anthropic");
    assert_eq!(row.properties["$ai_model"], "claude-sonnet-4-5");
    assert_eq!(row.properties["$ai_input_tokens"], json!(12));
    assert_eq!(row.properties["$ai_latency"], json!(2.0));
    assert_eq!(row.properties["$ai_is_error"], json!(true));
    assert_eq!(row.properties["$ai_error"], "overloaded");
    assert!(!row.properties.contains_key("$ai_stream"));
}

#[tokio::test]
async fn checks_the_key_and_the_body() {
    let (app, mut rx) = app(10);
    let export = vercel_export().to_string();

    let mut no_key = otlp("application/json", export.clone());
    no_key.headers_mut().remove("authorization");
    let (status, body) = send(&app, no_key).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body["error"], "invalid_api_key");

    let mut header_key = otlp("application/json", export.clone());
    header_key.headers_mut().remove("authorization");
    header_key
        .headers_mut()
        .insert("x-tracemark-api-key", TEST_KEY.parse().unwrap());
    let (status, body) = send(&app, header_key).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({}));

    let (status, body) = send(&app, otlp("text/plain", export)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["details"][0]["field"], "content-type");

    let (status, body) = send(&app, otlp("application/json", "{\"resourceSpans\": 1}")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["details"][0]["field"], "body");

    let (status, _) = send(&app, otlp("application/x-protobuf", vec![0xff, 0xff])).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    assert_eq!(
        drain(&mut rx).len(),
        2,
        "only the accepted export was queued"
    );
}
