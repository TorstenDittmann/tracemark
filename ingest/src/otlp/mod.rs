//! Turns OpenTelemetry spans from LLM instrumentation into `$ai_*` events.
//!
//! Spans following the GenAI semantic conventions (`gen_ai.*`) and spans from the Vercel AI SDK
//! (`ai.*`) become `$ai_generation`, `$ai_embedding` or `$ai_span` events with the properties in
//! docs/ai.md. Other spans, such as HTTP or database spans from the same exporter, are dropped.

pub mod proto;

use std::collections::HashMap;

use base64::Engine;
use chrono::{DateTime, Utc};
use prost::Message;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use proto::{AnyValue, ExportTraceServiceRequest, KeyValue, STATUS_ERROR, Span};

/// Spans with an attribute under one of these prefixes are kept.
const PREFIXES: [&str; 4] = ["gen_ai.", "ai.", "llm.", "footprint."];
/// The distinct id of spans that name no user, followed by the service name.
pub const FALLBACK_DISTINCT_ID: &str = "otel";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Encoding {
    Json,
    Protobuf,
}

pub fn decode(encoding: Encoding, body: &[u8]) -> Result<ExportTraceServiceRequest, String> {
    match encoding {
        Encoding::Protobuf => ExportTraceServiceRequest::decode(body).map_err(|e| e.to_string()),
        Encoding::Json => serde_json::from_slice(body).map_err(|e| e.to_string()),
    }
}

/// An OTLP attribute value as JSON.
fn json_value(value: &AnyValue) -> Value {
    use proto::Value as V;
    match &value.value {
        None => Value::Null,
        Some(V::StringValue(s)) => s.clone().into(),
        Some(V::BoolValue(b)) => (*b).into(),
        Some(V::IntValue(i)) => (*i).into(),
        Some(V::DoubleValue(d)) => {
            serde_json::Number::from_f64(*d).map_or(Value::Null, Value::Number)
        }
        Some(V::ArrayValue(array)) => array.values.iter().map(json_value).collect(),
        Some(V::KvlistValue(list)) => Value::Object(
            list.values
                .iter()
                .map(|kv| {
                    (
                        kv.key.clone(),
                        kv.value.as_ref().map_or(Value::Null, json_value),
                    )
                })
                .collect(),
        ),
        Some(V::BytesValue(bytes)) => base64::engine::general_purpose::STANDARD
            .encode(bytes)
            .into(),
    }
}

struct Attributes<'a> {
    span: HashMap<&'a str, Value>,
    resource: &'a HashMap<&'a str, Value>,
}

impl Attributes<'_> {
    fn get(&self, keys: &[&str]) -> Option<&Value> {
        keys.iter()
            .find_map(|key| self.span.get(*key))
            .filter(|v| !v.is_null())
    }

    fn string(&self, keys: &[&str]) -> Option<String> {
        self.get(keys)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    }

    fn number(&self, keys: &[&str]) -> Option<Value> {
        match self.get(keys)? {
            Value::Number(n) => Some(Value::Number(n.clone())),
            Value::String(s) => s.trim().parse::<f64>().ok().map(Value::from),
            _ => None,
        }
    }

    /// A value instrumentation stores as JSON text, such as a list of messages.
    fn json(&self, keys: &[&str]) -> Option<Value> {
        match self.get(keys)? {
            Value::String(s) => Some(serde_json::from_str(s).unwrap_or_else(|_| s.clone().into())),
            other => Some(other.clone()),
        }
    }

    /// Looks in the span's attributes, then the resource's.
    fn either(&self, keys: &[&str]) -> Option<String> {
        self.string(keys).or_else(|| {
            keys.iter()
                .find_map(|key| self.resource.get(*key))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        })
    }
}

fn attributes(list: &[KeyValue]) -> HashMap<&str, Value> {
    list.iter()
        .map(|kv| {
            (
                kv.key.as_str(),
                kv.value.as_ref().map_or(Value::Null, json_value),
            )
        })
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Generation,
    Embedding,
    Span,
}

impl Kind {
    fn event(self) -> &'static str {
        match self {
            Self::Generation => "$ai_generation",
            Self::Embedding => "$ai_embedding",
            Self::Span => "$ai_span",
        }
    }
}

fn kind(attrs: &Attributes) -> Kind {
    let operation = attrs.string(&["gen_ai.operation.name"]).unwrap_or_default();
    // The Vercel AI SDK calls the model in `ai.generateText.doGenerate`, `ai.streamText.doStream`,
    // `ai.embed.doEmbed` and so on; the outer spans repeat the usage, so they stay spans.
    let vercel = attrs.string(&["ai.operationId"]).unwrap_or_default();
    match operation.as_str() {
        "chat" | "text_completion" | "generate_content" => Kind::Generation,
        "embeddings" => Kind::Embedding,
        _ if vercel.ends_with(".doGenerate") || vercel.ends_with(".doStream") => Kind::Generation,
        _ if vercel.ends_with(".doEmbed") => Kind::Embedding,
        _ => Kind::Span,
    }
}

/// A stable event id per span, so a retried export doesn't count twice once events are deduped.
fn event_uuid(trace_id: &str, span_id: &str) -> Uuid {
    let digest = Sha256::digest(format!("{trace_id}/{span_id}").as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    uuid::Builder::from_custom_bytes(bytes).into_uuid()
}

fn timestamp(nanos: u64, now: DateTime<Utc>) -> String {
    i64::try_from(nanos)
        .ok()
        .filter(|n| *n > 0)
        .map_or(now, DateTime::from_timestamp_nanos)
        .to_rfc3339()
}

/// `openai.chat` and `anthropic.messages` (Vercel AI SDK) name the provider before the dot.
fn provider(attrs: &Attributes) -> Option<String> {
    attrs
        .string(&["gen_ai.provider.name", "gen_ai.system", "ai.model.provider"])
        .map(|p| p.split('.').next().unwrap_or_default().to_lowercase())
}

fn insert(props: &mut Map<String, Value>, key: &str, value: Option<impl Into<Value>>) {
    if let Some(value) = value {
        props.insert(key.to_owned(), value.into());
    }
}

/// The event for one span, or `None` for spans that aren't about AI.
fn event(span: &Span, resource: &HashMap<&str, Value>, now: DateTime<Utc>) -> Option<Value> {
    let attrs = Attributes {
        span: attributes(&span.attributes),
        resource,
    };
    if !attrs
        .span
        .keys()
        .any(|key| PREFIXES.iter().any(|p| key.starts_with(p)))
    {
        return None;
    }
    let trace_id = hex::encode(&span.trace_id);
    let span_id = hex::encode(&span.span_id);
    if trace_id.is_empty() || span_id.is_empty() {
        return None;
    }
    let kind = kind(&attrs);
    let mut props = Map::new();

    // Metadata the Vercel AI SDK passes through `experimental_telemetry.metadata`.
    for (key, value) in &attrs.span {
        if let Some(name) = key.strip_prefix("ai.telemetry.metadata.") {
            props.insert(name.to_owned(), value.clone());
        }
    }

    props.insert("$ai_trace_id".into(), trace_id.clone().into());
    props.insert("$ai_span_id".into(), span_id.clone().into());
    if !span.parent_span_id.is_empty() {
        props.insert(
            "$ai_parent_id".into(),
            hex::encode(&span.parent_span_id).into(),
        );
    }
    insert(
        &mut props,
        "$ai_span_name",
        attrs
            .string(&["ai.telemetry.functionId", "footprint.span_name"])
            .or_else(|| Some(span.name.clone()).filter(|n| !n.is_empty())),
    );
    if span.end_time_unix_nano > span.start_time_unix_nano && span.start_time_unix_nano > 0 {
        let seconds = (span.end_time_unix_nano - span.start_time_unix_nano) as f64 / 1e9;
        props.insert("$ai_latency".into(), seconds.into());
    }

    let status = span.status.as_ref();
    if status.is_some_and(|s| s.code == STATUS_ERROR) {
        props.insert("$ai_is_error".into(), true.into());
        let message = status
            .map(|s| s.message.clone())
            .filter(|m| !m.is_empty())
            .or_else(|| {
                span.events
                    .iter()
                    .filter(|e| e.name == "exception")
                    .find_map(|e| {
                        attributes(&e.attributes)
                            .get("exception.message")?
                            .as_str()
                            .map(str::to_owned)
                    })
            });
        insert(&mut props, "$ai_error", message);
    }

    if kind == Kind::Span {
        insert(
            &mut props,
            "$ai_input_state",
            attrs.json(&[
                "gen_ai.tool.call.arguments",
                "ai.toolCall.args",
                "input.value",
            ]),
        );
        insert(
            &mut props,
            "$ai_output_state",
            attrs.json(&[
                "gen_ai.tool.call.result",
                "ai.toolCall.result",
                "output.value",
            ]),
        );
    } else {
        insert(&mut props, "$ai_provider", provider(&attrs));
        insert(
            &mut props,
            "$ai_model",
            attrs.string(&[
                "gen_ai.response.model",
                "ai.response.model",
                "gen_ai.request.model",
                "ai.model.id",
            ]),
        );
        insert(
            &mut props,
            "$ai_input_tokens",
            attrs.number(&[
                "gen_ai.usage.input_tokens",
                "gen_ai.usage.prompt_tokens",
                "ai.usage.inputTokens",
                "ai.usage.promptTokens",
                "ai.usage.tokens",
            ]),
        );
        insert(
            &mut props,
            "$ai_output_tokens",
            attrs.number(&[
                "gen_ai.usage.output_tokens",
                "gen_ai.usage.completion_tokens",
                "ai.usage.outputTokens",
                "ai.usage.completionTokens",
            ]),
        );
        insert(
            &mut props,
            "$ai_cache_read_input_tokens",
            attrs.number(&[
                "gen_ai.usage.cache_read.input_tokens",
                "gen_ai.usage.cache_read_input_tokens",
                "ai.usage.cachedInputTokens",
            ]),
        );
        insert(
            &mut props,
            "$ai_cache_creation_input_tokens",
            attrs.number(&[
                "gen_ai.usage.cache_creation.input_tokens",
                "gen_ai.usage.cache_creation_input_tokens",
            ]),
        );
        insert(
            &mut props,
            "$ai_temperature",
            attrs.number(&["gen_ai.request.temperature", "ai.settings.temperature"]),
        );
        insert(
            &mut props,
            "$ai_max_tokens",
            attrs.number(&[
                "gen_ai.request.max_tokens",
                "ai.settings.maxOutputTokens",
                "ai.settings.maxTokens",
            ]),
        );
        insert(
            &mut props,
            "$ai_input",
            attrs.json(&[
                "gen_ai.input.messages",
                "ai.prompt.messages",
                "ai.prompt",
                "ai.values",
            ]),
        );
        let output = attrs.json(&["gen_ai.output.messages"]).or_else(|| {
            attrs
                .get(&["ai.response.text", "ai.response.object"])
                .map(|text| json!([{ "role": "assistant", "content": text }]))
        });
        insert(&mut props, "$ai_output_choices", output);
        insert(
            &mut props,
            "$ai_tools",
            attrs.json(&["gen_ai.tool.definitions", "ai.prompt.tools"]),
        );
        if kind == Kind::Generation
            && let Some(vercel) = attrs.string(&["ai.operationId"])
        {
            props.insert("$ai_stream".into(), vercel.ends_with(".doStream").into());
        }
    }

    let distinct_id = attrs
        .either(&[
            "footprint.distinct_id",
            "ai.telemetry.metadata.distinct_id",
            "ai.telemetry.metadata.userId",
            "user.id",
            "enduser.id",
        ])
        .unwrap_or_else(|| match attrs.either(&["service.name"]) {
            Some(service) => format!("{FALLBACK_DISTINCT_ID}:{service}"),
            None => FALLBACK_DISTINCT_ID.to_owned(),
        });
    // Spans come from servers, so the request's address says nothing about the user.
    props.insert("$geoip_disable".into(), true.into());

    let mut event = json!({
        "uuid": event_uuid(&trace_id, &span_id),
        "event": kind.event(),
        "distinct_id": distinct_id,
        "timestamp": timestamp(span.start_time_unix_nano, now),
        "properties": props,
    });
    if let Some(session) = attrs.either(&["session.id", "ai.telemetry.metadata.sessionId"]) {
        event["session_id"] = session.into();
    }
    Some(event)
}

/// The events for every AI span in an export, in the `/e` batch format. Spans without a start
/// time are stamped `now`.
pub fn events(request: &ExportTraceServiceRequest, now: DateTime<Utc>) -> Vec<Value> {
    let mut out = Vec::new();
    for resource_spans in &request.resource_spans {
        let resource = resource_spans
            .resource
            .as_ref()
            .map(|r| attributes(&r.attributes))
            .unwrap_or_default();
        for scope in &resource_spans.scope_spans {
            out.extend(
                scope
                    .spans
                    .iter()
                    .filter_map(|span| event(span, &resource, now)),
            );
        }
    }
    out
}
