CREATE TABLE IF NOT EXISTS events
(
    uuid        UUID,
    project_id  UUID,
    event       LowCardinality(String),
    timestamp   DateTime64(3, 'UTC'),
    distinct_id String,
    person_id   UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
    session_id  String DEFAULT '',
    properties  JSON,
    person_set       JSON,
    person_set_once  JSON,
    groups      Map(LowCardinality(String), String),
    inserted_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(inserted_at)
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, event, toDate(timestamp), distinct_id, uuid);
