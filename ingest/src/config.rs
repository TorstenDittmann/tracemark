use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("invalid value {value:?} for {var}")]
    Invalid { var: &'static str, value: String },
}

#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub clickhouse_url: String,
    pub clickhouse_user: String,
    pub clickhouse_password: String,
    pub clickhouse_database: String,
    pub app_internal_url: String,
    pub internal_token: String,
    pub flush_interval: Duration,
    pub flush_max_rows: usize,
    pub key_refresh: Duration,
    pub spill_dir: PathBuf,
    pub queue_capacity: usize,
    pub log_json: bool,
    /// MaxMind-format city database for location properties; none disables lookups.
    pub geoip_db: Option<PathBuf>,
    /// Header carrying the client address when behind a proxy, e.g. `x-forwarded-for`.
    pub address_header: Option<String>,
    pub xff_depth: usize,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|key| std::env::var(key).ok())
    }

    /// Builds the config from an arbitrary variable source so it can be tested
    /// without mutating the process environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get = |key: &str| lookup(key).filter(|v| !v.trim().is_empty());
        let string = |key: &str, default: &str| get(key).unwrap_or_else(|| default.to_owned());

        let internal_token = get("INTERNAL_TOKEN").ok_or(ConfigError::Missing("INTERNAL_TOKEN"))?;

        Ok(Self {
            port: parse(&get, "PORT", 8081)?,
            clickhouse_url: trim_slash(string("CLICKHOUSE_URL", "http://localhost:8123")),
            clickhouse_user: string("CLICKHOUSE_USER", "default"),
            clickhouse_password: lookup("CLICKHOUSE_PASSWORD").unwrap_or_default(),
            clickhouse_database: string("CLICKHOUSE_DATABASE", "footprint"),
            app_internal_url: trim_slash(string("APP_INTERNAL_URL", "http://localhost:3000")),
            internal_token,
            flush_interval: Duration::from_millis(positive(&get, "FLUSH_INTERVAL_MS", 1000)?),
            flush_max_rows: positive(&get, "FLUSH_MAX_ROWS", 10_000)?,
            key_refresh: Duration::from_secs(positive(&get, "KEY_REFRESH_SECS", 30)?),
            spill_dir: PathBuf::from(string("SPILL_DIR", "./spill")),
            queue_capacity: positive(&get, "QUEUE_CAPACITY", 100_000)?,
            log_json: get("LOG_FORMAT").is_some_and(|v| v.eq_ignore_ascii_case("json")),
            geoip_db: get("GEOIP_DB").map(PathBuf::from),
            address_header: get("ADDRESS_HEADER").map(|v| v.trim().to_ascii_lowercase()),
            xff_depth: positive(&get, "XFF_DEPTH", 1)?,
        })
    }
}

fn parse<T: FromStr>(
    get: &impl Fn(&str) -> Option<String>,
    var: &'static str,
    default: T,
) -> Result<T, ConfigError> {
    match get(var) {
        None => Ok(default),
        Some(value) => value
            .trim()
            .parse()
            .map_err(|_| ConfigError::Invalid { var, value }),
    }
}

fn positive<T: FromStr + Default + PartialEq>(
    get: &impl Fn(&str) -> Option<String>,
    var: &'static str,
    default: T,
) -> Result<T, ConfigError> {
    let value = parse(get, var, default)?;
    if value == T::default() {
        return Err(ConfigError::Invalid {
            var,
            value: "0".into(),
        });
    }
    Ok(value)
}

fn trim_slash(mut url: String) -> String {
    while url.ends_with('/') {
        url.pop();
    }
    url
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        Config::from_lookup(|k| vars.get(k).cloned())
    }

    #[test]
    fn requires_internal_token() {
        assert_eq!(
            config(&[]).unwrap_err(),
            ConfigError::Missing("INTERNAL_TOKEN")
        );
    }

    #[test]
    fn applies_defaults() {
        let c = config(&[("INTERNAL_TOKEN", "t")]).unwrap();
        assert_eq!(c.port, 8081);
        assert_eq!(c.clickhouse_url, "http://localhost:8123");
        assert_eq!(c.clickhouse_user, "default");
        assert_eq!(c.clickhouse_password, "");
        assert_eq!(c.clickhouse_database, "footprint");
        assert_eq!(c.app_internal_url, "http://localhost:3000");
        assert_eq!(c.flush_interval, Duration::from_secs(1));
        assert_eq!(c.flush_max_rows, 10_000);
        assert_eq!(c.key_refresh, Duration::from_secs(30));
        assert_eq!(c.spill_dir, PathBuf::from("./spill"));
        assert!(!c.log_json);
        assert_eq!(c.geoip_db, None);
        assert_eq!(c.address_header, None);
        assert_eq!(c.xff_depth, 1);
    }

    #[test]
    fn reads_overrides() {
        let c = config(&[
            ("INTERNAL_TOKEN", "t"),
            ("PORT", "9000"),
            ("CLICKHOUSE_URL", "http://ch:8123/"),
            ("FLUSH_INTERVAL_MS", "250"),
            ("FLUSH_MAX_ROWS", "5"),
            ("LOG_FORMAT", "JSON"),
            ("GEOIP_DB", "/data/city.mmdb"),
            ("ADDRESS_HEADER", "X-Forwarded-For"),
            ("XFF_DEPTH", "2"),
        ])
        .unwrap();
        assert_eq!(c.geoip_db, Some(PathBuf::from("/data/city.mmdb")));
        assert_eq!(c.address_header.as_deref(), Some("x-forwarded-for"));
        assert_eq!(c.xff_depth, 2);
        assert_eq!(c.port, 9000);
        assert_eq!(c.clickhouse_url, "http://ch:8123");
        assert_eq!(c.flush_interval, Duration::from_millis(250));
        assert_eq!(c.flush_max_rows, 5);
        assert!(c.log_json);
    }

    #[test]
    fn rejects_bad_numbers() {
        assert!(matches!(
            config(&[("INTERNAL_TOKEN", "t"), ("PORT", "nope")]),
            Err(ConfigError::Invalid { var: "PORT", .. })
        ));
        assert!(matches!(
            config(&[("INTERNAL_TOKEN", "t"), ("FLUSH_MAX_ROWS", "0")]),
            Err(ConfigError::Invalid {
                var: "FLUSH_MAX_ROWS",
                ..
            })
        ));
    }
}
