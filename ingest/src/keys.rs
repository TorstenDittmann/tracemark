//! Public API key → project id cache, refreshed by polling the app.

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde::Deserialize;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lookup {
    Found(Uuid),
    Unknown,
    /// The first successful poll has not happened yet.
    NotReady,
}

type KeyMap = HashMap<String, Uuid>;

#[derive(Clone, Default)]
pub struct KeyStore {
    /// `None` until the first successful poll.
    keys: Arc<RwLock<Option<Arc<KeyMap>>>>,
}

impl KeyStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(keys: HashMap<String, Uuid>) -> Self {
        let store = Self::new();
        store.replace(keys);
        store
    }

    pub fn replace(&self, keys: HashMap<String, Uuid>) {
        *self.keys.write().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(keys));
    }

    pub fn lookup(&self, public_key: &str) -> Lookup {
        let guard = self.keys.read().unwrap_or_else(|e| e.into_inner());
        match guard.as_deref() {
            None => Lookup::NotReady,
            Some(keys) => keys
                .get(public_key)
                .map_or(Lookup::Unknown, |id| Lookup::Found(*id)),
        }
    }

    pub fn is_ready(&self) -> bool {
        self.keys
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .is_some()
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
    pub async fn fetch(&self) -> Result<HashMap<String, Uuid>, FetchError> {
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
        Ok(body
            .projects
            .into_iter()
            .map(|p| (p.public_key, p.id))
            .collect())
    }
}

/// Polls forever. Until the first success it retries with a capped backoff;
/// afterwards it polls every `refresh`, keeping the last good map on failure.
pub async fn poll(source: KeySource, store: KeyStore, refresh: Duration) {
    let mut retry = Duration::from_millis(500);
    while !store.is_ready() {
        match source.fetch().await {
            Ok(keys) => {
                tracing::info!(projects = keys.len(), "loaded project keys");
                store.replace(keys);
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
            Ok(keys) => {
                tracing::debug!(projects = keys.len(), "refreshed project keys");
                store.replace(keys);
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
}
