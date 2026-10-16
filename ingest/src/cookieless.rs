//! Cookieless visitors: SDKs that store nothing send a placeholder distinct_id, and ingest
//! replaces it with a hash of the daily salt, project, IP address and user agent. The salts
//! rotate every UTC day and old ones are deleted by the app, so a hash cannot be linked to an
//! address afterwards, and the same visitor gets a new id each day.

use std::net::IpAddr;

use sha2::{Digest, Sha256};
use uuid::Uuid;

/// The distinct_id (or `$anon_distinct_id`) a cookieless SDK sends.
pub const PLACEHOLDER: &str = "$cookieless";

/// A stable id for one visitor on one project for the day `salt` belongs to.
pub fn visitor_id(
    salt: &str,
    project: Uuid,
    ip: Option<IpAddr>,
    user_agent: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    for part in [
        salt.as_bytes(),
        project.as_bytes(),
        ip.map(|ip| ip.to_string()).unwrap_or_default().as_bytes(),
        user_agent.unwrap_or_default().as_bytes(),
    ] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part);
    }
    let digest = hasher.finalize();
    let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    format!("cookieless_{hex}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn depends_on_every_input() {
        let ip: Option<IpAddr> = Some("1.2.3.4".parse().unwrap());
        let project = Uuid::from_u128(1);
        let base = visitor_id("salt", project, ip, Some("ua"));
        assert!(base.starts_with("cookieless_"));
        assert_eq!(base.len(), "cookieless_".len() + 32);
        assert_eq!(base, visitor_id("salt", project, ip, Some("ua")));
        assert_ne!(base, visitor_id("other", project, ip, Some("ua")));
        assert_ne!(base, visitor_id("salt", Uuid::from_u128(2), ip, Some("ua")));
        assert_ne!(
            base,
            visitor_id(
                "salt",
                project,
                Some("1.2.3.5".parse().unwrap()),
                Some("ua")
            )
        );
        assert_ne!(base, visitor_id("salt", project, ip, Some("ub")));
        assert_ne!(base, visitor_id("salt", project, None, Some("ua")));
    }
}
