//! Wire types and validation for `POST /e` (see `docs/ingest-protocol.md`).

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, TimeDelta, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

pub const MAX_EVENTS: usize = 1000;
pub const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;
const MAX_STRING_CHARS: usize = 200;
const MAX_GROUPS: usize = 5;

type Object = Map<String, Value>;

/// One validation problem, serialized into the 400 response `details`.
/// `index` is absent for problems with the envelope rather than an event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Issue {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
    pub field: String,
    pub message: String,
}

impl Issue {
    fn envelope(field: &str, message: impl Into<String>) -> Self {
        Self {
            index: None,
            field: field.to_owned(),
            message: message.into(),
        }
    }
}

/// The request body with the envelope checked but the events not yet validated.
#[derive(Debug)]
pub struct Envelope {
    pub api_key: Option<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub batch: Vec<Value>,
}

impl Envelope {
    pub fn parse(body: &[u8]) -> Result<Self, Vec<Issue>> {
        let value: Value = serde_json::from_slice(body)
            .map_err(|e| vec![Issue::envelope("body", format!("malformed JSON: {e}"))])?;
        let Value::Object(mut root) = value else {
            return Err(vec![Issue::envelope("body", "must be a JSON object")]);
        };

        let mut issues = Vec::new();
        let api_key = match root.remove("api_key") {
            None | Some(Value::Null) => None,
            Some(Value::String(key)) => Some(key).filter(|k| !k.is_empty()),
            Some(_) => {
                issues.push(Issue::envelope("api_key", "must be a string"));
                None
            }
        };
        let sent_at = match root.remove("sent_at") {
            None | Some(Value::Null) => None,
            Some(value) => match parse_timestamp(&value) {
                Ok(ts) => Some(ts),
                Err(message) => {
                    issues.push(Issue::envelope("sent_at", message));
                    None
                }
            },
        };
        let batch = match root.remove("batch") {
            Some(Value::Array(events)) => events,
            None | Some(Value::Null) => {
                issues.push(Issue::envelope("batch", "is required"));
                Vec::new()
            }
            Some(_) => {
                issues.push(Issue::envelope("batch", "must be an array"));
                Vec::new()
            }
        };

        if issues.is_empty() {
            Ok(Self {
                api_key,
                sent_at,
                batch,
            })
        } else {
            Err(issues)
        }
    }
}

/// A row for the ClickHouse `events` table, serialized as one JSONEachRow line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Row {
    pub uuid: Uuid,
    pub project_id: Uuid,
    pub event: String,
    pub timestamp: String,
    pub distinct_id: String,
    pub session_id: String,
    pub properties: Map<String, Value>,
    pub person_set: Map<String, Value>,
    pub person_set_once: Map<String, Value>,
    pub groups: BTreeMap<String, String>,
}

/// Validates every event and converts the batch into rows. Either all events
/// are valid and every row is returned, or every issue found is returned.
///
/// `skew` is `server_now - sent_at` and is added to each event timestamp.
pub fn validate_batch(
    batch: &[Value],
    project_id: Uuid,
    skew: Option<TimeDelta>,
) -> Result<Vec<Row>, Vec<Issue>> {
    let mut rows = Vec::with_capacity(batch.len());
    let mut issues = Vec::new();
    for (index, event) in batch.iter().enumerate() {
        let mut check = Checker {
            index,
            issues: &mut issues,
        };
        if let Some(row) = check.event(event, project_id, skew) {
            rows.push(row);
        }
    }
    if issues.is_empty() {
        Ok(rows)
    } else {
        Err(issues)
    }
}

/// Clock-skew correction: `server_now - sent_at`, if the client sent `sent_at`.
pub fn clock_skew(sent_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> Option<TimeDelta> {
    sent_at.map(|sent| now - sent)
}

struct Checker<'a> {
    index: usize,
    issues: &'a mut Vec<Issue>,
}

impl Checker<'_> {
    fn fail(&mut self, field: &str, message: impl Into<String>) {
        self.issues.push(Issue {
            index: Some(self.index),
            field: field.to_owned(),
            message: message.into(),
        });
    }

    fn event(&mut self, value: &Value, project_id: Uuid, skew: Option<TimeDelta>) -> Option<Row> {
        let Value::Object(event) = value else {
            self.fail("batch", "event must be a JSON object");
            return None;
        };
        let get = |field| event.get(field).filter(|v| !v.is_null());

        let uuid = self.uuid(get("uuid"));
        let name = self.required_string("event", get("event"));
        let distinct_id = self.required_string("distinct_id", get("distinct_id"));
        let timestamp = self.timestamp(get("timestamp"), skew);
        let session_id = self.optional_string("session_id", get("session_id"));
        let properties = self.optional_object("properties", get("properties"));
        let (person_set, person_set_once) = self.person(get("person"));
        let groups = self.groups(get("groups"));

        Some(Row {
            uuid: uuid?,
            project_id,
            event: name?,
            timestamp: timestamp?,
            distinct_id: distinct_id?,
            session_id: session_id?,
            properties: properties?,
            person_set: person_set?,
            person_set_once: person_set_once?,
            groups: groups?,
        })
    }

    fn uuid(&mut self, value: Option<&Value>) -> Option<Uuid> {
        match value {
            None => self.fail("uuid", "is required"),
            Some(Value::String(s)) => match Uuid::parse_str(s) {
                Ok(uuid) => return Some(uuid),
                Err(_) => self.fail("uuid", "must be a UUID"),
            },
            Some(_) => self.fail("uuid", "must be a string"),
        }
        None
    }

    fn required_string(&mut self, field: &str, value: Option<&Value>) -> Option<String> {
        match value {
            None => self.fail(field, "is required"),
            Some(Value::String(s)) if s.is_empty() => self.fail(field, "must not be empty"),
            Some(Value::String(s)) => return self.bounded(field, s),
            Some(_) => self.fail(field, "must be a string"),
        }
        None
    }

    fn optional_string(&mut self, field: &str, value: Option<&Value>) -> Option<String> {
        match value {
            None => Some(String::new()),
            Some(Value::String(s)) => self.bounded(field, s),
            Some(_) => {
                self.fail(field, "must be a string");
                None
            }
        }
    }

    fn bounded(&mut self, field: &str, s: &str) -> Option<String> {
        if s.chars().count() > MAX_STRING_CHARS {
            self.fail(
                field,
                format!("must be at most {MAX_STRING_CHARS} characters"),
            );
            return None;
        }
        Some(s.to_owned())
    }

    fn timestamp(&mut self, value: Option<&Value>, skew: Option<TimeDelta>) -> Option<String> {
        let Some(value) = value else {
            self.fail("timestamp", "is required");
            return None;
        };
        let parsed = match parse_timestamp(value) {
            Ok(ts) => ts,
            Err(message) => {
                self.fail("timestamp", message);
                return None;
            }
        };
        let corrected = match skew {
            Some(skew) => parsed.checked_add_signed(skew),
            None => Some(parsed),
        };
        match corrected.filter(|ts| storable(*ts)) {
            Some(ts) => Some(ts.format("%Y-%m-%d %H:%M:%S%.3f").to_string()),
            None => {
                self.fail("timestamp", "is out of range");
                None
            }
        }
    }

    fn optional_object(
        &mut self,
        field: &str,
        value: Option<&Value>,
    ) -> Option<Map<String, Value>> {
        match value {
            None => Some(Map::new()),
            Some(Value::Object(map)) => Some(map.clone()),
            Some(_) => {
                self.fail(field, "must be a JSON object");
                None
            }
        }
    }

    fn person(&mut self, value: Option<&Value>) -> (Option<Object>, Option<Object>) {
        match value {
            None => (Some(Map::new()), Some(Map::new())),
            Some(Value::Object(person)) => {
                let get = |field| person.get(field).filter(|v| !v.is_null());
                (
                    self.optional_object("person.set", get("set")),
                    self.optional_object("person.set_once", get("set_once")),
                )
            }
            Some(_) => {
                self.fail("person", "must be a JSON object");
                (None, None)
            }
        }
    }

    fn groups(&mut self, value: Option<&Value>) -> Option<BTreeMap<String, String>> {
        let groups = match value {
            None => return Some(BTreeMap::new()),
            Some(Value::Object(groups)) => groups,
            Some(_) => {
                self.fail("groups", "must be a JSON object");
                return None;
            }
        };
        if groups.len() > MAX_GROUPS {
            self.fail("groups", format!("must have at most {MAX_GROUPS} entries"));
            return None;
        }
        let mut out = BTreeMap::new();
        let mut valid = true;
        for (group_type, key) in groups {
            let field = format!("groups.{group_type}");
            if group_type.chars().count() > MAX_STRING_CHARS {
                self.fail(
                    "groups",
                    format!("group type must be at most {MAX_STRING_CHARS} characters"),
                );
                valid = false;
                continue;
            }
            match key {
                Value::String(key) => match self.bounded(&field, key) {
                    Some(key) => {
                        out.insert(group_type.clone(), key);
                    }
                    None => valid = false,
                },
                _ => {
                    self.fail(&field, "must be a string");
                    valid = false;
                }
            }
        }
        valid.then_some(out)
    }
}

fn parse_timestamp(value: &Value) -> Result<DateTime<Utc>, &'static str> {
    let Value::String(s) = value else {
        return Err("must be a string");
    };
    DateTime::parse_from_rfc3339(s)
        .map(|ts| ts.with_timezone(&Utc))
        .map_err(|_| "must be an RFC 3339 timestamp with timezone")
}

/// ClickHouse `DateTime64(3)` covers 1900-01-01 to 2299-12-31. Anything outside
/// would make the whole INSERT fail, so it is rejected at the edge instead.
fn storable(ts: DateTime<Utc>) -> bool {
    let min = NaiveDate::from_ymd_opt(1900, 1, 1).expect("valid date");
    let max = NaiveDate::from_ymd_opt(2299, 12, 31).expect("valid date");
    (min..=max).contains(&ts.date_naive())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PROJECT: Uuid = Uuid::from_u128(0x5f0c);

    fn minimal() -> Value {
        json!({
            "uuid": "01927d0b-8c4a-7cc2-9f43-3c1b2b0e9a11",
            "event": "$pageview",
            "distinct_id": "user_123",
            "timestamp": "2026-10-07T20:59:58.120Z"
        })
    }

    fn with(field: &str, value: Value) -> Value {
        let mut event = minimal();
        event[field] = value;
        event
    }

    fn without(field: &str) -> Value {
        let mut event = minimal();
        event.as_object_mut().unwrap().remove(field);
        event
    }

    fn issues(event: Value) -> Vec<Issue> {
        validate_batch(&[event], PROJECT, None).unwrap_err()
    }

    fn assert_rejects(event: Value, field: &str) {
        let issues = issues(event);
        assert!(
            issues
                .iter()
                .any(|i| i.field == field && i.index == Some(0)),
            "expected issue on {field}, got {issues:?}"
        );
    }

    #[test]
    fn accepts_minimal_event_with_defaults() {
        let rows = validate_batch(&[minimal()], PROJECT, None).unwrap();
        let row = &rows[0];
        assert_eq!(row.project_id, PROJECT);
        assert_eq!(row.event, "$pageview");
        assert_eq!(row.timestamp, "2026-10-07 20:59:58.120");
        assert_eq!(row.session_id, "");
        assert!(row.properties.is_empty());
        assert!(row.person_set.is_empty() && row.person_set_once.is_empty());
        assert!(row.groups.is_empty());
    }

    #[test]
    fn maps_full_event() {
        let event = json!({
            "uuid": "01927D0B-8C4A-7CC2-9F43-3C1B2B0E9A11",
            "event": "signup",
            "distinct_id": "u",
            "timestamp": "2026-10-07T22:59:58.1+02:00",
            "session_id": "s1",
            "properties": {"a": {"b": [1, 2]}},
            "person": {"set": {"plan": "pro"}, "set_once": {"first": "web"}},
            "groups": {"company": "acme"},
            "unknown_field": true
        });
        let row = validate_batch(&[event], PROJECT, None).unwrap().remove(0);
        assert_eq!(row.uuid.to_string(), "01927d0b-8c4a-7cc2-9f43-3c1b2b0e9a11");
        assert_eq!(row.timestamp, "2026-10-07 20:59:58.100");
        assert_eq!(row.session_id, "s1");
        assert_eq!(row.properties["a"], json!({"b": [1, 2]}));
        assert_eq!(row.person_set["plan"], "pro");
        assert_eq!(row.person_set_once["first"], "web");
        assert_eq!(row.groups["company"], "acme");
    }

    #[test]
    fn treats_null_optional_fields_as_absent() {
        let mut event = minimal();
        for field in ["session_id", "properties", "person", "groups"] {
            event[field] = Value::Null;
        }
        assert!(validate_batch(&[event], PROJECT, None).is_ok());
    }

    #[test]
    fn requires_fields() {
        for field in ["uuid", "event", "distinct_id", "timestamp"] {
            assert_rejects(without(field), field);
        }
    }

    #[test]
    fn checks_uuid() {
        assert_rejects(with("uuid", json!("not-a-uuid")), "uuid");
        assert_rejects(with("uuid", json!(42)), "uuid");
    }

    #[test]
    fn checks_string_lengths() {
        let ok = "é".repeat(200);
        let long = "a".repeat(201);
        assert!(validate_batch(&[with("event", json!(ok))], PROJECT, None).is_ok());
        assert_rejects(with("event", json!("")), "event");
        assert_rejects(with("event", json!(long)), "event");
        assert_rejects(with("distinct_id", json!("")), "distinct_id");
        assert_rejects(with("distinct_id", json!(long)), "distinct_id");
        assert_rejects(with("session_id", json!(long)), "session_id");
        assert_rejects(with("event", json!(1)), "event");
    }

    #[test]
    fn checks_timestamp() {
        assert_rejects(with("timestamp", json!("yesterday")), "timestamp");
        assert_rejects(with("timestamp", json!("2026-10-07T20:59:58")), "timestamp");
        assert_rejects(with("timestamp", json!(1_700_000_000)), "timestamp");
        assert_rejects(
            with("timestamp", json!("9999-01-01T00:00:00Z")),
            "timestamp",
        );
    }

    #[test]
    fn checks_objects() {
        assert_rejects(with("properties", json!([1])), "properties");
        assert_rejects(with("properties", json!("x")), "properties");
        assert_rejects(with("person", json!("x")), "person");
        assert_rejects(with("person", json!({"set": 1})), "person.set");
        assert_rejects(with("person", json!({"set_once": []})), "person.set_once");
    }

    #[test]
    fn checks_groups() {
        let six: Map<String, Value> = (0..6).map(|i| (format!("t{i}"), json!("k"))).collect();
        assert_rejects(with("groups", Value::Object(six)), "groups");
        assert_rejects(with("groups", json!(["acme"])), "groups");
        assert_rejects(with("groups", json!({"company": 1})), "groups.company");
        assert_rejects(
            with("groups", json!({"company": "k".repeat(201)})),
            "groups.company",
        );
        assert_rejects(with("groups", json!({"t".repeat(201): "k"})), "groups");
    }

    #[test]
    fn reports_every_invalid_event_with_its_index() {
        let batch = [minimal(), without("uuid"), with("event", json!(""))];
        let issues = validate_batch(&batch, PROJECT, None).unwrap_err();
        let indexes: Vec<_> = issues.iter().map(|i| i.index).collect();
        assert_eq!(indexes, [Some(1), Some(2)]);
    }

    #[test]
    fn rejects_non_object_event() {
        assert_rejects(json!("event"), "batch");
    }

    #[test]
    fn corrects_clock_skew() {
        let now: DateTime<Utc> = "2026-10-07T21:00:05.000Z".parse().unwrap();
        let sent: DateTime<Utc> = "2026-10-07T21:00:00.000Z".parse().unwrap();
        let skew = clock_skew(Some(sent), now);
        let row = validate_batch(&[minimal()], PROJECT, skew)
            .unwrap()
            .remove(0);
        assert_eq!(row.timestamp, "2026-10-07 21:00:03.120");
        assert_eq!(clock_skew(None, now), None);
    }

    #[test]
    fn parses_envelope() {
        let env = Envelope::parse(
            br#"{"api_key":"k","sent_at":"2026-10-07T21:00:00Z","batch":[],"x":1}"#,
        )
        .unwrap();
        assert_eq!(env.api_key.as_deref(), Some("k"));
        assert!(env.sent_at.is_some());
        assert!(env.batch.is_empty());

        let env = Envelope::parse(br#"{"api_key":"","batch":[]}"#).unwrap();
        assert_eq!(env.api_key, None);
    }

    #[test]
    fn rejects_bad_envelope() {
        let field = |body: &[u8]| Envelope::parse(body).unwrap_err()[0].field.clone();
        assert_eq!(field(b"{nope"), "body");
        assert_eq!(field(b"[]"), "body");
        assert_eq!(field(br#"{"api_key":"k"}"#), "batch");
        assert_eq!(field(br#"{"batch":{}}"#), "batch");
        assert_eq!(field(br#"{"api_key":1,"batch":[]}"#), "api_key");
        assert_eq!(field(br#"{"sent_at":"later","batch":[]}"#), "sent_at");
    }
}
