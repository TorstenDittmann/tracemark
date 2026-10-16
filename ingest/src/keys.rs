//! Public API key → project id cache and cookieless salts, refreshed by polling the app.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use chrono::NaiveDate;
use serde::Deserialize;
use uuid::Uuid;

use crate::ai::Prices;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lookup {
    Found(Uuid),
    Unknown,
    /// The first successful poll has not happened yet.
    NotReady,
}

type KeyMap = HashMap<String, Uuid>;

/// What one poll of the app returns.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Snapshot {
    pub keys: KeyMap,
    /// Cookieless salts by UTC day (`YYYY-MM-DD`): today's and tomorrow's.
    pub salts: HashMap<String, String>,
    /// Model prices for `$ai_cost_usd`.
    pub prices: Arc<Prices>,
}

impl From<KeyMap> for Snapshot {
    fn from(keys: KeyMap) -> Self {
        Self {
            keys,
            ..Self::default()
        }
    }
}

#[derive(Clone, Default)]
pub struct KeyStore {
    /// `None` until the first successful poll.
    snapshot: Arc<RwLock<Option<Arc<Snapshot>>>>,
}

impl KeyStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(keys: impl Into<Snapshot>) -> Self {
        let store = Self::new();
        store.replace(keys);
        store
    }

    pub fn replace(&self, snapshot: impl Into<Snapshot>) {
        *self.snapshot.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(snapshot.into()));
    }

    fn current(&self) -> Option<Arc<Snapshot>> {
        self.snapshot
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    pub fn lookup(&self, public_key: &str) -> Lookup {
        match self.current() {
            None => Lookup::NotReady,
            Some(snapshot) => snapshot
                .keys
                .get(public_key)
                .map_or(Lookup::Unknown, |id| Lookup::Found(*id)),
        }
    }

    /// The cookieless salt for `day`, if the app has handed it out.
    pub fn salt(&self, day: NaiveDate) -> Option<String> {
        self.current()?
            .salts
            .get(&day.format("%Y-%m-%d").to_string())
            .cloned()
    }

    /// The model prices from the last poll; empty before the first one.
    pub fn prices(&self) -> Arc<Prices> {
        self.current()
            .map(|snapshot| snapshot.prices.clone())
            .unwrap_or_default()
    }

    pub fn is_ready(&self) -> bool {
        self.current().is_some()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum FetchError {
    #[error("request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("unexpected status {0}")]
    Status(reqwest::StatusCode),
}

#[derive(Deserialize)]
struct ProjectsResponse {
    projects: Vec<Project>,
    #[serde(default)]
    salts: HashMap<String, String>,
    #[serde(default)]
    model_prices: Prices,
}

#[derive(Deserialize)]
struct Project {
    id: Uuid,
    public_key: String,
}

pub struct KeySource {
    pub client: reqwest::Client,
    pub app_internal_url: String,
    pub internal_token: String,
}

impl KeySource {
    pub async fn fetch(&self) -> Result<Snapshot, FetchError> {
        let response = self
            .client
            .get(format!("{}/internal/projects", self.app_internal_url))
            .header("x-internal-token", &self.internal_token)
            .timeout(Duration::from_secs(10))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(FetchError::Status(response.status()));
        }
        let body: ProjectsResponse = response.json().await?;
        Ok(Snapshot {
            keys: body
                .projects
                .into_iter()
                .map(|p| (p.public_key, p.id))
                .collect(),
            salts: body.salts,
            prices: Arc::new(body.model_prices),
        })
    }
}

/// Polls forever. Until the first success it retries with a capped backoff;
/// afterwards it polls every `refresh`, keeping the last good map on failure.
pub async fn poll(source: KeySource, store: KeyStore, refresh: Duration) {
    let mut retry = Duration::from_millis(500);
    while !store.is_ready() {
        match source.fetch().await {
            Ok(snapshot) => {
                tracing::info!(projects = snapshot.keys.len(), "loaded project keys");
                store.replace(snapshot);
            }
            Err(error) => {
                tracing::warn!(%error, retry_in = ?retry, "initial project key fetch failed");
                tokio::time::sleep(retry).await;
                retry = (retry * 2).min(refresh);
            }
        }
    }

    let mut interval = tokio::time::interval(refresh);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval.tick().await;
    loop {
        interval.tick().await;
        match source.fetch().await {
            Ok(snapshot) => {
                tracing::debug!(projects = snapshot.keys.len(), "refreshed project keys");
                store.replace(snapshot);
            }
            Err(error) => tracing::warn!(%error, "project key refresh failed; keeping last keys"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_reports_readiness_and_unknown_keys() {
        let store = KeyStore::new();
        assert_eq!(store.lookup("fp_pub_x"), Lookup::NotReady);

        let id = Uuid::from_u128(7);
        store.replace(HashMap::from([("fp_pub_x".to_owned(), id)]));
        assert_eq!(store.lookup("fp_pub_x"), Lookup::Found(id));
        assert_eq!(store.lookup("fp_pub_y"), Lookup::Unknown);
    }

    #[test]
    fn salts_are_looked_up_by_utc_day() {
        let store = KeyStore::new();
        let day = NaiveDate::from_ymd_opt(2026, 10, 16).unwrap();
        assert_eq!(store.salt(day), None);
        store.replace(Snapshot {
            keys: HashMap::new(),
            salts: HashMap::from([("2026-10-16".to_owned(), "abc".to_owned())]),
            ..Snapshot::default()
        });
        assert_eq!(store.salt(day).as_deref(), Some("abc"));
        assert_eq!(store.salt(day.succ_opt().unwrap()), None);
    }
}
