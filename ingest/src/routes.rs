use std::io::Read;

use axum::body::{Body, Bytes};
use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::{ConnectInfo, Query, State};
use axum::http::header::{AUTHORIZATION, CONTENT_ENCODING, CONTENT_TYPE};
use axum::http::{Extensions, HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use flate2::read::MultiGzDecoder;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};

use crate::ai;
use crate::enrich::{self, Enricher};
use crate::keys::{KeyStore, Lookup};
use crate::otlp::{self, Encoding};
use crate::protocol::{self, Envelope, Issue, MAX_BODY_BYTES, MAX_EVENTS, Row};

#[derive(Clone)]
pub struct AppState {
    pub keys: KeyStore,
    pub events: mpsc::Sender<Row>,
    pub enricher: Arc<Enricher>,
}

pub fn router(state: AppState) -> Router {
    // Browser SDKs post cross-origin; Content-Encoding is allowed so they can gzip.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::POST, Method::OPTIONS])
        .allow_headers([CONTENT_TYPE, CONTENT_ENCODING, AUTHORIZATION]);
    Router::new()
        .route("/e", post(ingest))
        .route("/v1/traces", post(traces))
        .route("/health", get(health))
        .layer(cors)
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

#[derive(Debug)]
pub enum ApiError {
    InvalidBatch(Vec<Issue>),
    InvalidApiKey,
    PayloadTooLarge,
    Overloaded,
    NotReady,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            Self::InvalidBatch(details) => (
                StatusCode::BAD_REQUEST,
                json!({ "error": "invalid_batch", "details": details }),
            ),
            Self::InvalidApiKey => (
                StatusCode::UNAUTHORIZED,
                json!({ "error": "invalid_api_key" }),
            ),
            Self::PayloadTooLarge => (
                StatusCode::PAYLOAD_TOO_LARGE,
                json!({ "error": "payload_too_large" }),
            ),
            Self::Overloaded => (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "error": "overloaded" }),
            ),
            Self::NotReady => (
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "error": "not_ready" }),
            ),
        };
        (status, Json(body)).into_response()
    }
}

#[derive(Deserialize)]
struct KeyQuery {
    api_key: Option<String>,
}

async fn ingest(
    State(state): State<AppState>,
    Query(query): Query<KeyQuery>,
    headers: HeaderMap,
    extensions: Extensions,
    body: Body,
) -> Result<Response, ApiError> {
    let raw = axum::body::to_bytes(body, MAX_BODY_BYTES)
        .await
        .map_err(|_| ApiError::PayloadTooLarge)?;
    let body = decode(&headers, raw)?;
    let envelope = Envelope::parse(&body).map_err(ApiError::InvalidBatch)?;

    let api_key = envelope
        .api_key
        .or(query.api_key.filter(|k| !k.is_empty()))
        .ok_or(ApiError::InvalidApiKey)?;
    let project_id = match state.keys.lookup(&api_key) {
        Lookup::Found(id) => id,
        Lookup::Unknown => return Err(ApiError::InvalidApiKey),
        Lookup::NotReady => return Err(ApiError::NotReady),
    };

    if envelope.batch.len() > MAX_EVENTS {
        return Err(ApiError::PayloadTooLarge);
    }
    let skew = protocol::clock_skew(envelope.sent_at, Utc::now());
    let mut rows = protocol::validate_batch(&envelope.batch, project_id, skew)
        .map_err(ApiError::InvalidBatch)?;
    let peer = extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip());
    let request = state.enricher.request_info(&headers, peer);
    let salt = if enrich::needs_salt(&rows) {
        // Salts are handed out a day ahead, so this only fails before the app has created any.
        let salt = state.keys.salt(Utc::now().date_naive());
        Some(salt.ok_or(ApiError::NotReady)?)
    } else {
        None
    };
    state.enricher.enrich(&mut rows, &request, salt.as_deref());
    let prices = state.keys.prices();
    for row in &mut rows {
        ai::add_cost(&row.event, row.project_id, &mut row.properties, &prices);
    }

    let accepted = rows.len();
    enqueue(&state.events, rows)?;
    Ok((StatusCode::ACCEPTED, Json(json!({ "accepted": accepted }))).into_response())
}

/// OTLP/HTTP trace export: spans from LLM instrumentation become `$ai_*` events (see
/// docs/ai.md). The project's public key comes as `Authorization: Bearer fp_pub_…`, an
/// `x-tracemark-api-key` header or an `api_key` query parameter.
async fn traces(
    State(state): State<AppState>,
    Query(query): Query<KeyQuery>,
    headers: HeaderMap,
    body: Body,
) -> Result<Response, ApiError> {
    let header = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    let api_key = header("x-tracemark-api-key")
        .or_else(|| header(AUTHORIZATION.as_str())?.strip_prefix("Bearer "))
        .map(str::trim)
        .map(str::to_owned)
        .or(query.api_key.filter(|k| !k.is_empty()))
        .ok_or(ApiError::InvalidApiKey)?;
    let project_id = match state.keys.lookup(&api_key) {
        Lookup::Found(id) => id,
        Lookup::Unknown => return Err(ApiError::InvalidApiKey),
        Lookup::NotReady => return Err(ApiError::NotReady),
    };

    let encoding = match header(CONTENT_TYPE.as_str()).map(|v| v.to_ascii_lowercase()) {
        Some(t) if t.starts_with("application/json") => Encoding::Json,
        Some(t)
            if t.starts_with("application/x-protobuf") || t.starts_with("application/protobuf") =>
        {
            Encoding::Protobuf
        }
        other => {
            return Err(invalid(
                "content-type",
                format!(
                    "unsupported content type {other:?}; use application/x-protobuf or application/json"
                ),
            ));
        }
    };
    let raw = axum::body::to_bytes(body, MAX_BODY_BYTES)
        .await
        .map_err(|_| ApiError::PayloadTooLarge)?;
    let body = decode(&headers, raw)?;
    let request = otlp::decode(encoding, &body).map_err(|e| invalid("body", e))?;

    let events = otlp::events(&request, Utc::now());
    if events.len() > MAX_EVENTS {
        return Err(ApiError::PayloadTooLarge);
    }
    let mut rows =
        protocol::validate_batch(&events, project_id, None).map_err(ApiError::InvalidBatch)?;
    let prices = state.keys.prices();
    for row in &mut rows {
        ai::add_cost(&row.event, row.project_id, &mut row.properties, &prices);
    }
    enqueue(&state.events, rows)?;

    // An empty ExportTraceServiceResponse: zero bytes in protobuf, `{}` in JSON.
    Ok(match encoding {
        Encoding::Protobuf => (
            StatusCode::OK,
            [(CONTENT_TYPE, "application/x-protobuf")],
            Vec::new(),
        )
            .into_response(),
        Encoding::Json => (StatusCode::OK, Json(json!({}))).into_response(),
    })
}

fn invalid(field: &str, message: impl Into<String>) -> ApiError {
    ApiError::InvalidBatch(vec![Issue {
        index: None,
        field: field.into(),
        message: message.into(),
    }])
}

/// Reserves room for the whole batch up front so it is queued entirely or not at all.
fn enqueue(events: &mpsc::Sender<Row>, rows: Vec<Row>) -> Result<(), ApiError> {
    if rows.is_empty() {
        return Ok(());
    }
    let permits = events
        .try_reserve_many(rows.len())
        .map_err(|_| ApiError::Overloaded)?;
    for (permit, row) in permits.zip(rows) {
        permit.send(row);
    }
    Ok(())
}

fn decode(headers: &HeaderMap, raw: Bytes) -> Result<Bytes, ApiError> {
    let encoding = headers
        .get(CONTENT_ENCODING)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim().to_ascii_lowercase());
    match encoding.as_deref() {
        None | Some("" | "identity") => Ok(raw),
        Some("gzip" | "x-gzip") => gunzip(&raw).map(Bytes::from),
        Some(other) => Err(ApiError::InvalidBatch(vec![Issue {
            index: None,
            field: "content-encoding".into(),
            message: format!("unsupported encoding {other:?}; use gzip or none"),
        }])),
    }
}

fn gunzip(compressed: &[u8]) -> Result<Vec<u8>, ApiError> {
    let mut out = Vec::new();
    // Read one byte past the limit so an oversized body is detected without
    // inflating all of it.
    MultiGzDecoder::new(compressed)
        .take(MAX_BODY_BYTES as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|e| {
            ApiError::InvalidBatch(vec![Issue {
                index: None,
                field: "body".into(),
                message: format!("invalid gzip body: {e}"),
            }])
        })?;
    if out.len() > MAX_BODY_BYTES {
        return Err(ApiError::PayloadTooLarge);
    }
    Ok(out)
}
