//! Writer and key poller against in-process mock ClickHouse / app servers.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::Router;
use axum::extract::{RawQuery, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::{get, post};
use tracemark_ingest::keys::{self, KeySource, KeyStore, Lookup};
use tracemark_ingest::protocol::Row;
use tracemark_ingest::writer::{self, ClickHouse, WriterSettings, spill_files};
use reqwest::Url;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use uuid::Uuid;

#[derive(Debug, Clone)]
struct Captured {
    params: HashMap<String, String>,
    authorization: Option<String>,
    body: String,
    succeeded: bool,
}

#[derive(Clone, Default)]
struct Mock {
    requests: Arc<Mutex<Vec<Captured>>>,
    failing: Arc<AtomicBool>,
}

impl Mock {
    fn requests(&self) -> Vec<Captured> {
        self.requests.lock().unwrap().clone()
    }

    fn inserted_rows(&self) -> Vec<Value> {
        self.requests()
            .iter()
            .filter(|r| r.succeeded)
            .flat_map(|r| {
                r.body
                    .lines()
                    .map(|l| serde_json::from_str(l).unwrap())
                    .collect::<Vec<_>>()
            })
            .collect()
    }
}

async fn spawn(router: Router) -> Url {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Url::parse(&format!("http://{addr}")).unwrap()
}

async fn mock_clickhouse() -> (Mock, Url) {
    async fn insert(
        State(mock): State<Mock>,
        RawQuery(query): RawQuery,
        headers: HeaderMap,
        body: String,
    ) -> StatusCode {
        let succeeded = !mock.failing.load(Ordering::SeqCst);
        let params = Url::parse(&format!("http://x/?{}", query.unwrap_or_default()))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect();
        mock.requests.lock().unwrap().push(Captured {
            params,
            authorization: headers
                .get("authorization")
                .map(|v| v.to_str().unwrap().to_owned()),
            body,
            succeeded,
        });
        if succeeded {
            StatusCode::OK
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
    let mock = Mock::default();
    let url = spawn(
        Router::new()
            .route("/", post(insert))
            .with_state(mock.clone()),
    )
    .await;
    (mock, url)
}

fn temp_dir() -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!("tracemark-ingest-{}-{n}", std::process::id()))
}

fn start_writer(
    url: Url,
    flush_interval: Duration,
    max_rows: usize,
    spill_dir: PathBuf,
) -> (mpsc::Sender<Row>, JoinHandle<()>) {
    let clickhouse = ClickHouse::new(
        reqwest::Client::new(),
        url,
        "tracemark",
        "default",
        "secret",
    );
    let (tx, rx) = mpsc::channel(10_000);
    let handle = tokio::spawn(writer::run(
        rx,
        clickhouse,
        WriterSettings {
            flush_interval,
            max_rows,
            spill_dir,
            retry_backoff: Duration::from_millis(1),
        },
    ));
    (tx, handle)
}

fn row(n: u128) -> Row {
    let event = json!({
        "uuid": Uuid::from_u128(n).to_string(),
        "event": "$pageview",
        "distinct_id": format!("user_{n}"),
        "timestamp": "2026-10-07T20:59:58.120Z",
        "properties": {"$current_url": "https://example.com/pricing"},
        "person": {"set": {"plan": "pro"}},
        "groups": {"company": "acme"}
    });
    tracemark_ingest::protocol::validate_batch(&[event], Uuid::from_u128(0xabc), None)
        .unwrap()
        .remove(0)
}

async fn eventually(what: &str, mut check: impl FnMut() -> bool) {
    for _ in 0..500 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {what}");
}

#[tokio::test]
async fn flushes_json_each_row_with_settings_and_auth() {
    let (mock, url) = mock_clickhouse().await;
    let (tx, writer) = start_writer(url, Duration::from_millis(50), 1000, temp_dir());

    tx.send(row(1)).await.unwrap();
    tx.send(row(2)).await.unwrap();
    eventually("a flush", || !mock.requests().is_empty()).await;

    let request = &mock.requests()[0];
    let expected_params: HashMap<String, String> = [
        ("query", "INSERT INTO events FORMAT JSONEachRow"),
        ("database", "tracemark"),
        ("date_time_input_format", "best_effort"),
        ("async_insert", "1"),
        ("wait_for_async_insert", "1"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    assert_eq!(request.params, expected_params);
    // base64("default:secret")
    assert_eq!(
        request.authorization.as_deref(),
        Some("Basic ZGVmYXVsdDpzZWNyZXQ=")
    );

    assert!(request.body.ends_with('\n'));
    let lines: Vec<Value> = request
        .body
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(
        lines[0],
        json!({
            "uuid": Uuid::from_u128(1).to_string(),
            "project_id": Uuid::from_u128(0xabc).to_string(),
            "event": "$pageview",
            "timestamp": "2026-10-07 20:59:58.120",
            "distinct_id": "user_1",
            "session_id": "",
            "properties": {"$current_url": "https://example.com/pricing"},
            "person_set": {"plan": "pro"},
            "person_set_once": {},
            "groups": {"company": "acme"}
        })
    );

    drop(tx);
    writer.await.unwrap();
}

#[tokio::test]
async fn flushes_when_max_rows_reached() {
    let (mock, url) = mock_clickhouse().await;
    let (tx, _writer) = start_writer(url, Duration::from_secs(3600), 3, temp_dir());

    for n in 0..3 {
        tx.send(row(n)).await.unwrap();
    }
    eventually("a size-triggered flush", || mock.inserted_rows().len() == 3).await;
}

#[tokio::test]
async fn flushes_buffer_on_shutdown() {
    let (mock, url) = mock_clickhouse().await;
    let (tx, writer) = start_writer(url, Duration::from_secs(3600), 1000, temp_dir());

    tx.send(row(7)).await.unwrap();
    // Let the writer pick the row up before the channel closes.
    tokio::time::sleep(Duration::from_millis(50)).await;
    drop(tx);
    writer.await.unwrap();

    assert_eq!(mock.inserted_rows().len(), 1);
}

#[tokio::test]
async fn spills_after_retries_then_replays_on_next_success() {
    let (mock, url) = mock_clickhouse().await;
    mock.failing.store(true, Ordering::SeqCst);
    let spill_dir = temp_dir();
    let (tx, writer) = start_writer(url, Duration::from_millis(20), 1000, spill_dir.clone());

    tx.send(row(1)).await.unwrap();
    let dir = spill_dir.clone();
    eventually("a spill file", || {
        std::fs::read_dir(&dir).is_ok_and(|entries| {
            entries
                .flatten()
                .any(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        })
    })
    .await;
    assert_eq!(mock.requests().len(), 3, "expected three insert attempts");
    let spilled = spill_files(&spill_dir).await.unwrap();
    let content = std::fs::read_to_string(&spilled[0]).unwrap();
    assert_eq!(content, mock.requests()[0].body);

    mock.failing.store(false, Ordering::SeqCst);
    tx.send(row(2)).await.unwrap();
    eventually("the replay", || mock.inserted_rows().len() == 2).await;

    let ids: Vec<_> = mock
        .inserted_rows()
        .iter()
        .map(|r| r["distinct_id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, ["user_2", "user_1"]);
    // The file is removed after the replayed insert returns, so it can briefly outlive it.
    let dir = spill_dir.clone();
    eventually("the spill file to be removed", || {
        std::fs::read_dir(&dir).is_ok_and(|entries| {
            !entries
                .flatten()
                .any(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        })
    })
    .await;

    drop(tx);
    writer.await.unwrap();
    std::fs::remove_dir_all(&spill_dir).unwrap();
}

#[tokio::test]
async fn polls_project_keys_and_keeps_last_good_map() {
    #[derive(Clone, Default)]
    struct App {
        calls: Arc<Mutex<u32>>,
        tokens: Arc<Mutex<Vec<String>>>,
    }
    async fn projects(State(app): State<App>, headers: HeaderMap) -> (StatusCode, String) {
        let token = headers
            .get("x-internal-token")
            .map(|v| v.to_str().unwrap().to_owned())
            .unwrap_or_default();
        app.tokens.lock().unwrap().push(token.clone());
        let mut calls = app.calls.lock().unwrap();
        *calls += 1;
        // The first call fails (app still booting) and so does every call
        // after the first success (app down), to exercise both paths.
        if *calls != 2 || token != "s3cret" {
            return (StatusCode::INTERNAL_SERVER_ERROR, String::new());
        }
        let body = json!({
            "projects": [{"id": Uuid::from_u128(9), "public_key": "fp_pub_test", "name": "x"}],
            "model_prices": {
                "defaults": [{"model": "gpt-4o", "input": 2.5, "output": 10, "cache_read": null, "cache_write": null}],
                "projects": {Uuid::from_u128(9).to_string(): [{"model": "gpt-4o", "input": 1, "output": 2}]}
            }
        });
        (StatusCode::OK, body.to_string())
    }

    let app = App::default();
    let mut url = spawn(
        Router::new()
            .route("/internal/projects", get(projects))
            .with_state(app.clone()),
    )
    .await;
    url.set_path("");
    let store = KeyStore::new();
    let poller = tokio::spawn(keys::poll(
        KeySource {
            client: reqwest::Client::new(),
            app_internal_url: url.as_str().trim_end_matches('/').to_owned(),
            internal_token: "s3cret".into(),
        },
        store.clone(),
        Duration::from_millis(20),
    ));

    assert_eq!(store.lookup("fp_pub_test"), Lookup::NotReady);
    eventually("keys to load", || store.is_ready()).await;
    assert_eq!(
        store.lookup("fp_pub_test"),
        Lookup::Found(Uuid::from_u128(9))
    );

    eventually("failed refreshes", || *app.calls.lock().unwrap() >= 4).await;
    assert_eq!(
        store.lookup("fp_pub_test"),
        Lookup::Found(Uuid::from_u128(9))
    );
    assert_eq!(store.lookup("fp_pub_other"), Lookup::Unknown);
    let prices = store.prices();
    assert_eq!(
        prices.lookup(Uuid::from_u128(1), "gpt-4o").unwrap().input,
        2.5
    );
    assert_eq!(
        prices.lookup(Uuid::from_u128(9), "gpt-4o").unwrap().input,
        1.0
    );
    assert!(app.tokens.lock().unwrap().iter().all(|t| t == "s3cret"));

    poller.abort();
}
