//! The parts of the OTLP trace request footprint reads, decodable from both OTLP/protobuf (field
//! tags from opentelemetry-proto) and OTLP/JSON (lowerCamelCase names, hex ids, 64-bit integers as
//! strings). Fields not listed here are skipped by both decoders.

use std::fmt;

use base64::Engine;
use serde::Deserialize;
use serde::de::{self, Deserializer, Visitor};

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportTraceServiceRequest {
    #[prost(message, repeated, tag = "1")]
    #[serde(default)]
    pub resource_spans: Vec<ResourceSpans>,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceSpans {
    #[prost(message, optional, tag = "1")]
    #[serde(default)]
    pub resource: Option<Resource>,
    #[prost(message, repeated, tag = "2")]
    #[serde(default)]
    pub scope_spans: Vec<ScopeSpans>,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    #[prost(message, repeated, tag = "1")]
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeSpans {
    #[prost(message, optional, tag = "1")]
    #[serde(default)]
    pub scope: Option<InstrumentationScope>,
    #[prost(message, repeated, tag = "2")]
    #[serde(default)]
    pub spans: Vec<Span>,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentationScope {
    #[prost(string, tag = "1")]
    #[serde(default)]
    pub name: String,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    #[prost(bytes = "vec", tag = "1")]
    #[serde(default, deserialize_with = "hex_bytes")]
    pub trace_id: Vec<u8>,
    #[prost(bytes = "vec", tag = "2")]
    #[serde(default, deserialize_with = "hex_bytes")]
    pub span_id: Vec<u8>,
    #[prost(bytes = "vec", tag = "4")]
    #[serde(default, deserialize_with = "hex_bytes")]
    pub parent_span_id: Vec<u8>,
    #[prost(string, tag = "5")]
    #[serde(default)]
    pub name: String,
    #[prost(fixed64, tag = "7")]
    #[serde(default, deserialize_with = "uint64")]
    pub start_time_unix_nano: u64,
    #[prost(fixed64, tag = "8")]
    #[serde(default, deserialize_with = "uint64")]
    pub end_time_unix_nano: u64,
    #[prost(message, repeated, tag = "9")]
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
    #[prost(message, repeated, tag = "11")]
    #[serde(default)]
    pub events: Vec<Event>,
    #[prost(message, optional, tag = "15")]
    #[serde(default)]
    pub status: Option<Status>,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[prost(string, tag = "2")]
    #[serde(default)]
    pub name: String,
    #[prost(message, repeated, tag = "3")]
    #[serde(default)]
    pub attributes: Vec<KeyValue>,
}

/// `code` is 0 (unset), 1 (ok) or 2 (error).
#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[prost(string, tag = "2")]
    #[serde(default)]
    pub message: String,
    #[prost(int32, tag = "3")]
    #[serde(default, deserialize_with = "status_code")]
    pub code: i32,
}

pub const STATUS_ERROR: i32 = 2;

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    #[prost(string, tag = "1")]
    #[serde(default)]
    pub key: String,
    #[prost(message, optional, tag = "2")]
    #[serde(default)]
    pub value: Option<AnyValue>,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
pub struct AnyValue {
    #[prost(oneof = "Value", tags = "1, 2, 3, 4, 5, 6, 7")]
    #[serde(flatten)]
    pub value: Option<Value>,
}

#[derive(Clone, PartialEq, prost::Oneof, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Value {
    #[prost(string, tag = "1")]
    StringValue(String),
    #[prost(bool, tag = "2")]
    BoolValue(bool),
    #[prost(int64, tag = "3")]
    IntValue(#[serde(deserialize_with = "int64")] i64),
    #[prost(double, tag = "4")]
    DoubleValue(f64),
    #[prost(message, tag = "5")]
    ArrayValue(ArrayValue),
    #[prost(message, tag = "6")]
    KvlistValue(KeyValueList),
    #[prost(bytes, tag = "7")]
    BytesValue(#[serde(deserialize_with = "base64_bytes")] Vec<u8>),
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
pub struct ArrayValue {
    #[prost(message, repeated, tag = "1")]
    #[serde(default)]
    pub values: Vec<AnyValue>,
}

#[derive(Clone, PartialEq, prost::Message, Deserialize)]
pub struct KeyValueList {
    #[prost(message, repeated, tag = "1")]
    #[serde(default)]
    pub values: Vec<KeyValue>,
}

/// OTLP/JSON writes trace and span ids as hex.
fn hex_bytes<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
    let text = String::deserialize(d)?;
    hex::decode(text.trim()).map_err(de::Error::custom)
}

fn base64_bytes<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
    let text = String::deserialize(d)?;
    base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .map_err(de::Error::custom)
}

/// OTLP/JSON writes 64-bit integers as strings, but some exporters send numbers.
struct Integer;

impl Visitor<'_> for Integer {
    type Value = i128;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an integer or a string holding one")
    }

    fn visit_i64<E: de::Error>(self, v: i64) -> Result<i128, E> {
        Ok(v.into())
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<i128, E> {
        Ok(v.into())
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<i128, E> {
        if v.fract() == 0.0 && v.is_finite() {
            Ok(v as i128)
        } else {
            Err(E::custom("expected an integer"))
        }
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<i128, E> {
        v.trim().parse().map_err(E::custom)
    }
}

fn int64<'de, D: Deserializer<'de>>(d: D) -> Result<i64, D::Error> {
    let value = d.deserialize_any(Integer)?;
    i64::try_from(value).map_err(de::Error::custom)
}

fn uint64<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    let value = d.deserialize_any(Integer)?;
    u64::try_from(value).map_err(de::Error::custom)
}

/// Status codes are numbers in OTLP/JSON, though some exporters write the enum name.
fn status_code<'de, D: Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Code {
        Number(i32),
        Name(String),
    }
    Ok(match Code::deserialize(d)? {
        Code::Number(n) => n,
        Code::Name(name) => match name.as_str() {
            "STATUS_CODE_OK" => 1,
            "STATUS_CODE_ERROR" => STATUS_ERROR,
            _ => 0,
        },
    })
}
