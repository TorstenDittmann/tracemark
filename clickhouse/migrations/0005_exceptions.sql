-- Error tracking groups `$exception` events into issues by the fingerprint ingest adds
-- (see ingest/src/exceptions.rs). A materialized column keeps issue queries off the JSON.
-- Existing rows read it as empty until they are merged, which is fine: no events carried a
-- fingerprint before this migration.
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS exception_fingerprint String
    MATERIALIZED ifNull(properties.`$exception_fingerprint`.:String, '');
