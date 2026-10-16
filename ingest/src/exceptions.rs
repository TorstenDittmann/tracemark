//! Groups `$exception` events into issues by giving each a `$exception_fingerprint`.
//!
//! Errors with a stack trace group by their type and the app's own frames closest to where they
//! were thrown; line and column numbers are left out so a deploy doesn't split an issue. Errors
//! without one group by type and message, with numbers and ids masked. A fingerprint the client
//! sent wins.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

pub const EVENT: &str = "$exception";
pub const FINGERPRINT: &str = "$exception_fingerprint";
const LIST: &str = "$exception_list";
/// In-app frames that count towards the fingerprint, from the one that threw.
const FRAMES: usize = 5;

/// Adds a fingerprint to an `$exception` event's properties unless it already has one.
pub fn add_fingerprint(props: &mut Map<String, Value>) {
    if matches!(props.get(FINGERPRINT), Some(Value::String(s)) if !s.is_empty()) {
        return;
    }
    let fingerprint = fingerprint(props.get(LIST));
    props.insert(FINGERPRINT.to_owned(), fingerprint.into());
}

/// The fingerprint for an `$exception_list`: 16 hex characters.
pub fn fingerprint(list: Option<&Value>) -> String {
    let first = list.and_then(Value::as_array).and_then(|list| list.first());
    let text = |key: &str| first.and_then(|e| e.get(key)).and_then(Value::as_str);
    let mut parts = vec![
        text("type")
            .filter(|t| !t.is_empty())
            .unwrap_or("Error")
            .to_owned(),
    ];

    let frames: Vec<String> = first
        .and_then(|e| e.pointer("/stacktrace/frames"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|frame| frame.get("in_app") != Some(&Value::Bool(false)))
        .filter_map(|frame| {
            let file = frame
                .get("filename")
                .and_then(Value::as_str)
                .map(normalize_file);
            let function = frame.get("function").and_then(Value::as_str);
            match (file, function) {
                (None, None) => None,
                (file, function) => Some(format!(
                    "{}:{}",
                    file.unwrap_or_default(),
                    function.unwrap_or_default()
                )),
            }
        })
        .take(FRAMES)
        .collect();

    if frames.is_empty() {
        parts.push(normalize_message(text("value").unwrap_or_default()));
    } else {
        parts.extend(frames);
    }
    let digest = Sha256::digest(parts.join("\n").as_bytes());
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}

/// A script's path without origin, query, fragment or build hashes, so the same source file
/// keeps its name across deploys and hosts.
fn normalize_file(file: &str) -> String {
    let file = file.split(['?', '#']).next().unwrap_or_default();
    let path = match file.find("://") {
        Some(scheme) => {
            let rest = &file[scheme + 3..];
            rest.find('/').map_or("", |slash| &rest[slash..])
        }
        None => file,
    };
    let (dir, name) = path.rsplit_once('/').map_or(("", path), |(d, n)| (d, n));
    let mut pieces: Vec<&str> = name.split('.').collect();
    let extension = if pieces.len() > 1 { pieces.pop() } else { None };
    let stem: Vec<String> = pieces
        .iter()
        .filter(|piece| !looks_like_hash(piece))
        .map(|piece| {
            piece
                .split('-')
                .filter(|part| !looks_like_hash(part))
                .collect::<Vec<_>>()
                .join("-")
        })
        .collect();
    let mut name = stem.join(".");
    if let Some(extension) = extension {
        name.push('.');
        name.push_str(extension);
    }
    if dir.is_empty() {
        name
    } else {
        format!("{dir}/{name}")
    }
}

/// Bundlers name chunks like `index-B3xk9aZ1.js` or `main.3f2a91c0.js`.
fn looks_like_hash(piece: &str) -> bool {
    (6..=32).contains(&piece.len())
        && piece.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && piece.chars().any(|c| c.is_ascii_digit())
}

/// Masks every word containing a digit, so `User 123 not found` and `User 456 not found` match.
fn normalize_message(message: &str) -> String {
    let mut out = String::with_capacity(message.len());
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String| {
        if word.chars().any(|c| c.is_ascii_digit()) {
            out.push('*');
        } else {
            out.push_str(word);
        }
        word.clear();
    };
    for c in message.chars().take(500) {
        if c.is_alphanumeric() || c == '_' || c == '-' {
            word.push(c);
        } else {
            flush(&mut word, &mut out);
            out.push(c);
        }
    }
    flush(&mut word, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn error(type_: &str, value: &str, frames: Value) -> Value {
        json!([{ "type": type_, "value": value, "stacktrace": { "frames": frames } }])
    }

    #[test]
    fn groups_by_type_and_in_app_frames_ignoring_lines_and_build_hashes() {
        let a = error(
            "TypeError",
            "x is undefined",
            json!([
                { "filename": "https://a.example.com/assets/index-B3xk9aZ1.js?v=1", "function": "render", "lineno": 10, "colno": 2 },
                { "filename": "https://cdn.example.com/react.js", "function": "call", "in_app": false },
                { "filename": "https://a.example.com/assets/main.3f2a91c0.js", "function": "boot", "lineno": 1 }
            ]),
        );
        let b = error(
            "TypeError",
            "y is undefined",
            json!([
                { "filename": "https://b.example.com/assets/index-Zq81kLp0.js", "function": "render", "lineno": 99, "colno": 7 },
                { "filename": "https://a.example.com/assets/main.77aa0b12.js", "function": "boot", "lineno": 5 }
            ]),
        );
        assert_eq!(fingerprint(Some(&a)), fingerprint(Some(&b)));
        assert_eq!(fingerprint(Some(&a)).len(), 16);

        let other_type = error(
            "RangeError",
            "",
            json!([{ "filename": "/assets/index.js", "function": "render" }]),
        );
        let other_function = error(
            "TypeError",
            "",
            json!([{ "filename": "/assets/index.js", "function": "paint" }]),
        );
        let mine = error(
            "TypeError",
            "",
            json!([{ "filename": "/assets/index.js", "function": "render" }]),
        );
        assert_ne!(fingerprint(Some(&mine)), fingerprint(Some(&a)));
        assert_ne!(fingerprint(Some(&other_type)), fingerprint(Some(&mine)));
        assert_ne!(fingerprint(Some(&other_function)), fingerprint(Some(&mine)));
    }

    #[test]
    fn groups_errors_without_frames_by_masked_message() {
        let a = error("Error", "User 123 not found (id 9f3c2a)", json!([]));
        let b = error("Error", "User 456 not found (id 0b7e11)", json!([]));
        let c = error("Error", "Order 123 not found", json!([]));
        assert_eq!(fingerprint(Some(&a)), fingerprint(Some(&b)));
        assert_ne!(fingerprint(Some(&a)), fingerprint(Some(&c)));
        // Only library frames: same as no frames.
        let library = error(
            "Error",
            "User 7 not found (id 1)",
            json!([{ "filename": "x.js", "in_app": false }]),
        );
        assert_eq!(fingerprint(Some(&library)), fingerprint(Some(&a)));
    }

    #[test]
    fn handles_missing_or_odd_lists() {
        assert_eq!(fingerprint(None), fingerprint(Some(&json!([]))));
        assert_eq!(fingerprint(Some(&json!("nope"))), fingerprint(None));
        assert_eq!(
            fingerprint(Some(&json!([{ "stacktrace": { "frames": "x" } }]))),
            fingerprint(None)
        );
    }

    #[test]
    fn keeps_a_fingerprint_the_client_sent() {
        let mut props = Map::new();
        props.insert(FINGERPRINT.into(), json!("checkout-failed"));
        add_fingerprint(&mut props);
        assert_eq!(props[FINGERPRINT], json!("checkout-failed"));

        let mut props = Map::new();
        props.insert(FINGERPRINT.into(), json!(""));
        props.insert(LIST.into(), error("Error", "boom", json!([])));
        add_fingerprint(&mut props);
        assert_eq!(props[FINGERPRINT], json!(fingerprint(props.get(LIST))));
    }

    #[test]
    fn normalizes_files() {
        assert_eq!(
            normalize_file("https://x.com/a/b/index-B3xk9aZ1.js?x#y"),
            "/a/b/index.js"
        );
        assert_eq!(normalize_file("/app/src/server.ts"), "/app/src/server.ts");
        assert_eq!(normalize_file("webpack:///./src/app.tsx"), "/./src/app.tsx");
        assert_eq!(normalize_file("main.3f2a91c0.chunk.js"), "main.chunk.js");
        assert_eq!(normalize_file("vendor-react.js"), "vendor-react.js");
        assert_eq!(normalize_file("https://x.com"), "");
    }
}
