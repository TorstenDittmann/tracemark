//! Adds browser, OS, device and location properties to events from the request
//! that carried them. The client IP is used for the lookup and never stored.

use std::collections::BTreeMap;
use std::net::IpAddr;
use std::path::Path;

use axum::http::HeaderMap;
use axum::http::header::USER_AGENT;
use maxminddb::Reader;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::cookieless::{self, PLACEHOLDER};
use crate::protocol::Row;

/// Event properties that override the request's values, for server SDKs sending
/// on behalf of a visitor. Both are removed from the stored event.
const IP_PROPERTY: &str = "$ip";
const USER_AGENT_PROPERTY: &str = "$user_agent";
/// Set to `true` on an event to skip location lookup, e.g. for server-side events.
const GEOIP_DISABLE_PROPERTY: &str = "$geoip_disable";

const ANON_DISTINCT_ID_PROPERTY: &str = "$anon_distinct_id";

/// Whether any row carries the cookieless placeholder and so needs today's salt.
pub fn needs_salt(rows: &[Row]) -> bool {
    rows.iter().any(|row| {
        row.distinct_id == PLACEHOLDER
            || row
                .properties
                .get(ANON_DISTINCT_ID_PROPERTY)
                .and_then(Value::as_str)
                == Some(PLACEHOLDER)
    })
}

pub struct Enricher {
    geoip: Option<Reader<Vec<u8>>>,
    user_agents: woothee::parser::Parser,
    address_header: Option<String>,
    xff_depth: usize,
}

/// What the request itself says about the visitor.
#[derive(Debug, Default, Clone)]
pub struct RequestInfo {
    pub ip: Option<IpAddr>,
    pub user_agent: Option<String>,
}

impl RequestInfo {
    /// `address_header` names a proxy header such as `x-forwarded-for`; the address
    /// `depth` entries from its right end is the client, as written by the nearest
    /// trusted proxy. Without the header the peer address is used.
    pub fn from_request(
        headers: &HeaderMap,
        peer: Option<IpAddr>,
        address_header: Option<&str>,
        depth: usize,
    ) -> Self {
        let ip = match address_header {
            Some(name) => headers
                .get_all(name)
                .iter()
                .filter_map(|value| value.to_str().ok())
                .flat_map(|value| value.split(','))
                .map(str::trim)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .nth(depth.saturating_sub(1))
                .and_then(parse_ip),
            None => peer,
        };
        let user_agent = headers
            .get(USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        Self { ip, user_agent }
    }
}

fn parse_ip(value: &str) -> Option<IpAddr> {
    value
        .parse::<IpAddr>()
        .ok()
        .or_else(|| value.parse::<std::net::SocketAddr>().ok().map(|a| a.ip()))
        .map(|ip| ip.to_canonical())
}

impl Enricher {
    pub fn new(geoip: Option<Reader<Vec<u8>>>) -> Self {
        Self {
            geoip,
            user_agents: woothee::parser::Parser::new(),
            address_header: None,
            xff_depth: 1,
        }
    }

    /// Opens a MaxMind-format city database (GeoLite2 City or DB-IP City Lite).
    pub fn open(path: Option<&Path>) -> Result<Self, maxminddb::MaxMindDbError> {
        let geoip = path.map(Reader::open_readfile).transpose()?;
        Ok(Self::new(geoip))
    }

    /// Reads the client address from `header` (see [`RequestInfo::from_request`]) instead of the peer.
    pub fn with_address_header(mut self, header: Option<String>, depth: usize) -> Self {
        self.address_header = header;
        self.xff_depth = depth;
        self
    }

    pub fn request_info(&self, headers: &HeaderMap, peer: Option<IpAddr>) -> RequestInfo {
        RequestInfo::from_request(
            headers,
            peer,
            self.address_header.as_deref(),
            self.xff_depth,
        )
    }

    pub fn has_geoip(&self) -> bool {
        self.geoip.is_some()
    }

    /// Adds derived properties to every row. Properties the client already set win.
    ///
    /// Cookieless placeholders in `distinct_id` and `$anon_distinct_id` are replaced with the
    /// visitor hash for `salt`; callers check [`needs_salt`] first and must pass one then.
    pub fn enrich(&self, rows: &mut [Row], request: &RequestInfo, salt: Option<&str>) {
        // Most batches come from one visitor, so cache the lookups per distinct input.
        let mut agents: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
        let mut places: BTreeMap<IpAddr, Map<String, Value>> = BTreeMap::new();

        for row in rows {
            let props = &mut row.properties;
            let ip = match props.remove(IP_PROPERTY) {
                Some(Value::String(ip)) => parse_ip(ip.trim()),
                _ => request.ip,
            };
            let user_agent = match props.remove(USER_AGENT_PROPERTY) {
                Some(Value::String(ua)) => Some(ua),
                _ => request.user_agent.clone(),
            };
            let geoip_disabled = props.get(GEOIP_DISABLE_PROPERTY) == Some(&Value::Bool(true));

            if let Some(salt) = salt {
                let visitor =
                    || cookieless::visitor_id(salt, row.project_id, ip, user_agent.as_deref());
                if row.distinct_id == PLACEHOLDER {
                    row.distinct_id = visitor();
                }
                if let Some(anon) = props.get_mut(ANON_DISTINCT_ID_PROPERTY)
                    && anon.as_str() == Some(PLACEHOLDER)
                {
                    *anon = visitor().into();
                }
            }

            if let Some(ua) = user_agent {
                let derived = agents
                    .entry(ua)
                    .or_insert_with_key(|ua| self.user_agent(ua));
                merge_missing(props, derived);
            }
            if let (Some(ip), false) = (ip, geoip_disabled) {
                let derived = places.entry(ip).or_insert_with(|| self.place(ip));
                merge_missing(props, derived);
            }
        }
    }

    fn user_agent(&self, ua: &str) -> Map<String, Value> {
        let mut out = Map::new();
        let Some(result) = self.user_agents.parse(ua) else {
            return out;
        };
        let known = |value: &str| !value.is_empty() && value != woothee::woothee::VALUE_UNKNOWN;
        if result.category == "crawler" {
            out.insert("$device_type".into(), "Bot".into());
            if known(result.name) {
                out.insert("$bot_name".into(), result.name.into());
            }
            return out;
        }
        if result.browser_type == "browser" && known(result.name) {
            out.insert("$browser".into(), result.name.into());
            if known(result.version) {
                out.insert("$browser_version".into(), result.version.into());
            }
        }
        if known(result.os) {
            let os = match result.os {
                "iPhone" | "iPad" | "iPod" => "iOS",
                "Mac OSX" => "macOS",
                os if os.starts_with("Windows") => "Windows",
                os => os,
            };
            out.insert("$os".into(), os.into());
            if known(&result.os_version) {
                out.insert("$os_version".into(), result.os_version.as_ref().into());
            }
        }
        let device = match (result.category, result.os) {
            (_, "iPad") => Some("Tablet"),
            (_, "Android") if !ua.contains("Mobile") => Some("Tablet"),
            ("smartphone" | "mobilephone", _) => Some("Mobile"),
            ("pc", _) => Some("Desktop"),
            ("appliance", _) => Some("Console"),
            _ => None,
        };
        if let Some(device) = device {
            out.insert("$device_type".into(), device.into());
        }
        out
    }

    fn place(&self, ip: IpAddr) -> Map<String, Value> {
        let mut out = Map::new();
        let Some(reader) = &self.geoip else {
            return out;
        };
        let city = match reader.lookup(ip).and_then(|r| r.decode::<City>()) {
            Ok(Some(city)) => city,
            Ok(None) => return out,
            Err(error) => {
                tracing::debug!(%error, "geoip lookup failed");
                return out;
            }
        };
        let mut put = |key: &str, value: Option<&str>| {
            if let Some(value) = value.filter(|v| !v.is_empty()) {
                out.insert(key.into(), value.into());
            }
        };
        put("$geoip_continent_code", city.continent.code);
        put("$geoip_country_code", city.country.iso_code);
        put("$geoip_country_name", city.country.names.en);
        put(
            "$geoip_subdivision_1_name",
            city.subdivisions.first().and_then(|s| s.names.en),
        );
        put("$geoip_city_name", city.city.names.en);
        put("$geoip_time_zone", city.location.time_zone);
        out
    }
}

fn merge_missing(props: &mut Map<String, Value>, derived: &Map<String, Value>) {
    for (key, value) in derived {
        if !props.contains_key(key) {
            props.insert(key.clone(), value.clone());
        }
    }
}

/// The subset of the GeoIP2 / DB-IP City record that footprint stores.
#[derive(Deserialize, Default)]
#[serde(default)]
struct City<'a> {
    #[serde(borrow)]
    continent: Continent<'a>,
    #[serde(borrow)]
    country: Country<'a>,
    #[serde(borrow)]
    subdivisions: Vec<Named<'a>>,
    #[serde(borrow)]
    city: Named<'a>,
    #[serde(borrow)]
    location: Location<'a>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Continent<'a> {
    code: Option<&'a str>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Country<'a> {
    iso_code: Option<&'a str>,
    #[serde(borrow)]
    names: Names<'a>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Named<'a> {
    #[serde(borrow)]
    names: Names<'a>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Names<'a> {
    en: Option<&'a str>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct Location<'a> {
    time_zone: Option<&'a str>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(xff: &[&str]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for value in xff {
            map.append("x-forwarded-for", value.parse().unwrap());
        }
        map
    }

    fn ip(s: &str) -> Option<IpAddr> {
        Some(s.parse().unwrap())
    }

    #[test]
    fn uses_the_peer_without_a_proxy_header() {
        let info = RequestInfo::from_request(&headers(&["1.1.1.1"]), ip("10.0.0.1"), None, 1);
        assert_eq!(info.ip, ip("10.0.0.1"));
    }

    #[test]
    fn counts_proxy_hops_from_the_right_across_header_lines() {
        let h = headers(&["9.9.9.9, 1.1.1.1", "2.2.2.2"]);
        let at = |depth| {
            RequestInfo::from_request(&h, ip("10.0.0.1"), Some("x-forwarded-for"), depth).ip
        };
        assert_eq!(at(1), ip("2.2.2.2"));
        assert_eq!(at(2), ip("1.1.1.1"));
        assert_eq!(at(4), None);
    }

    #[test]
    fn ignores_the_peer_when_the_proxy_header_is_missing_or_invalid() {
        let proxied = |h: &HeaderMap| {
            RequestInfo::from_request(h, ip("10.0.0.1"), Some("x-forwarded-for"), 1).ip
        };
        assert_eq!(proxied(&headers(&[])), None);
        assert_eq!(proxied(&headers(&["unknown"])), None);
        assert_eq!(proxied(&headers(&["[2001:db8::1]:443"])), ip("2001:db8::1"));
        assert_eq!(proxied(&headers(&["::ffff:1.2.3.4"])), ip("1.2.3.4"));
    }
}
