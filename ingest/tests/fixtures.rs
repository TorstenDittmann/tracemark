//! Runs every shared wire-format fixture through the real router.

mod common;

use std::fs;
use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use common::{TEST_PROJECT, app, drain, post, send};
use serde_json::Value;

fn fixtures(kind: &str) -> Vec<PathBuf> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../packages/schema/fixtures")
        .join(kind);
    let mut files: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no fixtures in {}", dir.display());
    files
}

#[tokio::test]
async fn accepts_every_valid_fixture() {
    for path in fixtures("valid") {
        let raw = fs::read_to_string(&path).unwrap();
        let expected = serde_json::from_str::<Value>(&raw).unwrap()["batch"]
            .as_array()
            .unwrap()
            .len();
        let (app, mut rx) = app(10_000);

        let (status, body) = send(&app, post("/e", raw)).await;

        assert_eq!(status, StatusCode::ACCEPTED, "{}: {body}", path.display());
        assert_eq!(body["accepted"], expected, "{}", path.display());
        let rows = drain(&mut rx);
        assert_eq!(rows.len(), expected, "{}", path.display());
        assert!(rows.iter().all(|row| row.project_id == TEST_PROJECT));
    }
}

#[tokio::test]
async fn rejects_every_invalid_fixture() {
    for path in fixtures("invalid") {
        let raw = fs::read_to_string(&path).unwrap();
        let (app, mut rx) = app(10_000);

        let (status, body) = send(&app, post("/e", raw)).await;

        assert_eq!(
            status,
            StatusCode::BAD_REQUEST,
            "{}: {body}",
            path.display()
        );
        assert_eq!(body["error"], "invalid_batch", "{}", path.display());
        let details = body["details"].as_array().unwrap();
        assert!(!details.is_empty(), "{}", path.display());
        assert!(
            details.iter().all(|d| d["index"].is_u64()),
            "{}",
            path.display()
        );
        assert!(drain(&mut rx).is_empty(), "{} stored rows", path.display());
    }
}
