//! Batches accepted rows and writes them to ClickHouse, spilling to disk when
//! ClickHouse is unavailable.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Url;
use tokio::sync::mpsc;

use crate::protocol::Row;

const INSERT_ATTEMPTS: u32 = 3;
const SPILL_EXTENSION: &str = "jsonl";

#[derive(Debug, thiserror::Error)]
pub enum InsertError {
    #[error("request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("clickhouse returned {status}: {body}")]
    Status {
        status: reqwest::StatusCode,
        body: String,
    },
}

#[derive(Clone)]
pub struct ClickHouse {
    client: reqwest::Client,
    url: Url,
    user: String,
    password: String,
}

impl ClickHouse {
    pub fn new(
        client: reqwest::Client,
        mut url: Url,
        database: &str,
        user: &str,
        password: &str,
    ) -> Self {
        if !url.path().ends_with('/') {
            let path = format!("{}/", url.path());
            url.set_path(&path);
        }
        url.query_pairs_mut()
            .append_pair("query", "INSERT INTO events FORMAT JSONEachRow")
            .append_pair("database", database)
            .append_pair("date_time_input_format", "best_effort")
            .append_pair("async_insert", "1")
            .append_pair("wait_for_async_insert", "1");
        Self {
            client,
            url,
            user: user.to_owned(),
            password: password.to_owned(),
        }
    }

    pub async fn insert(&self, body: String) -> Result<(), InsertError> {
        let response = self
            .client
            .post(self.url.clone())
            .basic_auth(&self.user, Some(&self.password))
            .header(reqwest::header::CONTENT_TYPE, "application/x-ndjson")
            .timeout(Duration::from_secs(30))
            .body(body)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let mut body = response.text().await.unwrap_or_default();
        body.truncate(500);
        Err(InsertError::Status { status, body })
    }
}

#[derive(Debug, Clone)]
pub struct WriterSettings {
    pub flush_interval: Duration,
    pub max_rows: usize,
    pub spill_dir: PathBuf,
    /// Delay before the first retry; doubles for each further retry.
    pub retry_backoff: Duration,
}

/// Runs until every sender is dropped, then flushes what is left and returns.
pub async fn run(rx: mpsc::Receiver<Row>, clickhouse: ClickHouse, settings: WriterSettings) {
    Writer {
        clickhouse,
        settings,
        lines: Vec::new(),
    }
    .run(rx)
    .await;
}

struct Writer {
    clickhouse: ClickHouse,
    settings: WriterSettings,
    lines: Vec<String>,
}

impl Writer {
    async fn run(mut self, mut rx: mpsc::Receiver<Row>) {
        let mut ticker = tokio::time::interval(self.settings.flush_interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut rows = Vec::new();
        loop {
            tokio::select! {
                received = rx.recv_many(&mut rows, self.settings.max_rows) => {
                    if received == 0 {
                        self.flush().await;
                        tracing::info!("writer drained");
                        return;
                    }
                    self.buffer(rows.drain(..));
                    if self.lines.len() >= self.settings.max_rows {
                        self.flush().await;
                    }
                }
                _ = ticker.tick() => self.flush().await,
            }
        }
    }

    fn buffer(&mut self, rows: impl Iterator<Item = Row>) {
        for row in rows {
            match serde_json::to_string(&row) {
                Ok(line) => self.lines.push(line),
                Err(error) => {
                    tracing::error!(%error, uuid = %row.uuid, "dropping unserializable row")
                }
            }
        }
    }

    async fn flush(&mut self) {
        if self.lines.is_empty() {
            return;
        }
        let count = self.lines.len();
        let body = to_body(std::mem::take(&mut self.lines));
        match self.insert_with_retry(&body).await {
            Ok(()) => {
                tracing::debug!(rows = count, "flushed rows");
                self.replay_spill().await;
            }
            Err(error) => {
                tracing::error!(%error, rows = count, "insert failed; spilling to disk");
                if let Err(error) = spill(&self.settings.spill_dir, &body).await {
                    tracing::error!(%error, rows = count, "spill failed; rows lost");
                }
            }
        }
    }

    async fn insert_with_retry(&self, body: &str) -> Result<(), InsertError> {
        let mut delay = self.settings.retry_backoff;
        let mut attempt = 1;
        loop {
            match self.clickhouse.insert(body.to_owned()).await {
                Ok(()) => return Ok(()),
                Err(error) if attempt >= INSERT_ATTEMPTS => return Err(error),
                Err(error) => {
                    tracing::warn!(%error, attempt, "insert failed; retrying");
                    tokio::time::sleep(delay).await;
                    delay *= 2;
                    attempt += 1;
                }
            }
        }
    }

    /// Re-inserts spilled files oldest first, stopping at the first failure so
    /// a still-flaky ClickHouse does not stall the writer for long.
    async fn replay_spill(&self) {
        let files = match spill_files(&self.settings.spill_dir).await {
            Ok(files) => files,
            Err(error) => {
                tracing::warn!(%error, "cannot list spill directory");
                return;
            }
        };
        for path in files {
            let body = match tokio::fs::read_to_string(&path).await {
                Ok(body) => body,
                Err(error) => {
                    tracing::warn!(%error, path = %path.display(), "cannot read spill file");
                    continue;
                }
            };
            if let Err(error) = self.clickhouse.insert(body).await {
                tracing::warn!(%error, path = %path.display(), "spill replay failed");
                return;
            }
            match tokio::fs::remove_file(&path).await {
                Ok(()) => tracing::info!(path = %path.display(), "replayed spill file"),
                Err(error) => {
                    tracing::error!(%error, path = %path.display(), "cannot remove replayed spill file");
                    return;
                }
            }
        }
    }
}

fn to_body(lines: Vec<String>) -> String {
    let mut body = lines.join("\n");
    body.push('\n');
    body
}

/// Writes to a temp name and renames so a crash never leaves a half-written
/// `.jsonl` file that would fail every replay.
async fn spill(dir: &Path, body: &str) -> std::io::Result<PathBuf> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    tokio::fs::create_dir_all(dir).await?;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seq = SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let name = format!("{nanos:020}-{seq:06}");
    let tmp = dir.join(format!("{name}.tmp"));
    let path = dir.join(format!("{name}.{SPILL_EXTENSION}"));
    tokio::fs::write(&tmp, body).await?;
    tokio::fs::rename(&tmp, &path).await?;
    Ok(path)
}

pub async fn spill_files(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut entries = match tokio::fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut files = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == SPILL_EXTENSION) {
            files.push(path);
        }
    }
    files.sort();
    Ok(files)
}
