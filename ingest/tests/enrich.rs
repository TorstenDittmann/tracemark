mod common;

use std::net::{IpAddr, Ipv4Addr};

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::{TEST_KEY, app, app_with, drain, fake_keys, send};
use tracemark_ingest::enrich::Enricher;
use maxminddb_writer::Database;
use maxminddb_writer::metadata::IpVersion;
use maxminddb_writer::paths::IpAddrWithMask;
use serde_json::{Map, Value, json};

const CHROME_MAC: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const SAFARI_IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const GOOGLEBOT: &str = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

/// A two-network city database in the GeoIP2 / DB-IP layout.
fn geoip() -> maxminddb::Reader<Vec<u8>> {
    let mut db = Database::default();
    db.metadata.ip_version = IpVersion::V4;
    db.metadata.database_type = "tracemark-test-city".into();
    db.metadata.binary_format_major_version = 2;
    let berlin = db
        .insert_value(json!({
            "continent": {"code": "EU"},
            "country": {"iso_code": "DE", "names": {"en": "Germany", "de": "Deutschland"}},
            "subdivisions": [{"names": {"en": "Land Berlin"}}],
            "city": {"names": {"en": "Berlin"}},
            "location": {"time_zone": "Europe/Berlin", "latitude": 52.5, "longitude": 13.4}
        }))
        .unwrap();
    let country_only = db
        .insert_value(json!({"country": {"iso_code": "NZ", "names": {"en": "New Zealand"}}}))
        .unwrap();
    db.insert_node(
        IpAddrWithMask::new(IpAddr::V4(Ipv4Addr::new(81, 2, 69, 0)), 24),
        berlin,
    );
    db.insert_node(
        IpAddrWithMask::new(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 0)), 24),
        country_only,
    );
    maxminddb::Reader::from_source(db.write_to(Vec::new()).unwrap()).unwrap()
}

fn enricher() -> Enricher {
    Enricher::new(Some(geoip())).with_address_header(Some("x-forwarded-for".into()), 1)
}

fn request(
    user_agent: Option<&str>,
    forwarded_for: Option<&str>,
    events: Vec<Value>,
) -> Request<Body> {
    let mut builder = Request::post("/e").header("content-type", "application/json");
    if let Some(ua) = user_agent {
        builder = builder.header("user-agent", ua);
    }
    if let Some(xff) = forwarded_for {
        builder = builder.header("x-forwarded-for", xff);
    }
    builder
        .body(Body::from(
            json!({"api_key": TEST_KEY, "batch": events}).to_string(),
        ))
        .unwrap()
}

fn event(n: u128, properties: Value) -> Value {
    json!({
        "uuid": uuid::Uuid::from_u128(n).to_string(),
        "event": "$pageview",
        "distinct_id": "anon",
        "timestamp": "2026-10-07T20:59:58.120Z",
        "properties": properties
    })
}

async fn enriched(
    enricher: Enricher,
    user_agent: Option<&str>,
    forwarded_for: Option<&str>,
    events: Vec<Value>,
) -> Vec<Map<String, Value>> {
    let (app, mut rx) = app_with(fake_keys(), enricher, 10);
    let (status, body) = send(&app, request(user_agent, forwarded_for, events)).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    drain(&mut rx)
        .into_iter()
        .map(|row| row.properties)
        .collect()
}

#[tokio::test]
async fn adds_browser_and_location_from_the_request() {
    let props = enriched(
        enricher(),
        Some(CHROME_MAC),
        Some("81.2.69.160"),
        vec![event(1, json!({"$current_url": "https://example.com"}))],
    )
    .await;
    assert_eq!(
        Value::Object(props[0].clone()),
        json!({
            "$current_url": "https://example.com",
            "$browser": "Chrome",
            "$browser_version": "129.0.0.0",
            "$os": "macOS",
            "$os_version": "10.15.7",
            "$device_type": "Desktop",
            "$geoip_continent_code": "EU",
            "$geoip_country_code": "DE",
            "$geoip_country_name": "Germany",
            "$geoip_subdivision_1_name": "Land Berlin",
            "$geoip_city_name": "Berlin",
            "$geoip_time_zone": "Europe/Berlin"
        })
    );
}

#[tokio::test]
async fn uses_the_address_added_by_the_nearest_proxy() {
    // The client can prepend anything; only the right-most entry is trusted at depth 1.
    let props = enriched(
        enricher(),
        None,
        Some("81.2.69.160, 203.0.113.9"),
        vec![event(1, json!({}))],
    )
    .await;
    assert_eq!(props[0]["$geoip_country_code"], "NZ");
    assert!(!props[0].contains_key("$geoip_city_name"));
}

#[tokio::test]
async fn event_ip_and_user_agent_override_the_request_and_are_not_stored() {
    let props = enriched(
        enricher(),
        Some(CHROME_MAC),
        Some("203.0.113.9"),
        vec![event(
            1,
            json!({"$ip": "81.2.69.160", "$user_agent": SAFARI_IPHONE}),
        )],
    )
    .await;
    assert_eq!(props[0]["$geoip_city_name"], "Berlin");
    assert_eq!(props[0]["$browser"], "Safari");
    assert_eq!(props[0]["$os"], "iOS");
    assert_eq!(props[0]["$device_type"], "Mobile");
    assert!(!props[0].contains_key("$ip"));
    assert!(!props[0].contains_key("$user_agent"));
}

#[tokio::test]
async fn client_properties_win_and_geoip_can_be_disabled() {
    let props = enriched(
        enricher(),
        Some(CHROME_MAC),
        Some("81.2.69.160"),
        vec![event(
            1,
            json!({"$browser": "Custom", "$geoip_disable": true}),
        )],
    )
    .await;
    assert_eq!(props[0]["$browser"], "Custom");
    assert_eq!(props[0]["$os"], "macOS");
    assert!(
        props[0]
            .keys()
            .all(|k| !k.starts_with("$geoip_") || k == "$geoip_disable")
    );
}

#[tokio::test]
async fn marks_crawlers_as_bots() {
    let props = enriched(enricher(), Some(GOOGLEBOT), None, vec![event(1, json!({}))]).await;
    assert_eq!(props[0]["$device_type"], "Bot");
    assert!(!props[0].contains_key("$browser"));
}

#[tokio::test]
async fn without_a_database_or_headers_nothing_is_added() {
    let (app, mut rx) = app(10);
    let (status, _) = send(
        &app,
        request(None, Some("81.2.69.160"), vec![event(1, json!({}))]),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert!(drain(&mut rx)[0].properties.is_empty());
}

#[tokio::test]
async fn fingerprints_exceptions_only() {
    let list = json!([{ "type": "TypeError", "value": "x is undefined" }]);
    let mut exception = event(1, json!({ "$exception_list": list }));
    exception["event"] = json!("$exception");
    let mut custom = event(
        2,
        json!({ "$exception_list": list, "$exception_fingerprint": "mine" }),
    );
    custom["event"] = json!("$exception");
    let pageview = event(3, json!({ "$exception_list": list }));
    let props = enriched(
        Enricher::new(None),
        None,
        None,
        vec![exception, custom, pageview],
    )
    .await;
    assert_eq!(
        props[0]["$exception_fingerprint"],
        json!(tracemark_ingest::exceptions::fingerprint(Some(&list)))
    );
    assert_eq!(props[1]["$exception_fingerprint"], "mine");
    assert!(!props[2].contains_key("$exception_fingerprint"));
}
