-- Identity: links an anonymous distinct_id to the id it later identified as.
-- Fed by `$identify` events. When one anonymous id is identified more than once,
-- the earliest identification wins (higher version = earlier timestamp).
CREATE TABLE IF NOT EXISTS person_aliases
(
    project_id  UUID,
    alias       String,
    distinct_id String,
    timestamp   DateTime64(3, 'UTC'),
    version     UInt64
)
ENGINE = ReplacingMergeTree(version)
ORDER BY (project_id, alias);

CREATE MATERIALIZED VIEW IF NOT EXISTS person_aliases_mv TO person_aliases AS
SELECT
    project_id,
    toString(properties.`$anon_distinct_id`) AS alias,
    distinct_id,
    timestamp,
    toUInt64(253402300799999 - toUnixTimestamp64Milli(timestamp)) AS version
FROM events
WHERE event = '$identify'
    AND alias NOT IN ('', '\\N')
    AND alias != distinct_id;

-- Person properties per distinct_id and key. Values are raw JSON.
-- `set` keeps the latest value by event time, `set_once` the earliest.
CREATE TABLE IF NOT EXISTS person_properties
(
    project_id     UUID,
    distinct_id    String,
    key            String,
    set_value      AggregateFunction(argMax, String, DateTime64(3, 'UTC')),
    set_once_value AggregateFunction(argMin, String, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
ORDER BY (project_id, distinct_id, key);

CREATE MATERIALIZED VIEW IF NOT EXISTS person_properties_set_mv TO person_properties AS
SELECT
    project_id,
    distinct_id,
    kv.1 AS key,
    argMaxState(kv.2, timestamp) AS set_value,
    argMinStateIf('', timestamp, false) AS set_once_value
FROM events
ARRAY JOIN JSONExtractKeysAndValuesRaw(toJSONString(person_set)) AS kv
GROUP BY project_id, distinct_id, key;

CREATE MATERIALIZED VIEW IF NOT EXISTS person_properties_set_once_mv TO person_properties AS
SELECT
    project_id,
    distinct_id,
    kv.1 AS key,
    argMaxStateIf('', timestamp, false) AS set_value,
    argMinState(kv.2, timestamp) AS set_once_value
FROM events
ARRAY JOIN JSONExtractKeysAndValuesRaw(toJSONString(person_set_once)) AS kv
GROUP BY project_id, distinct_id, key;

-- Maps any distinct_id to its person key: the identified id for a linked anonymous id, otherwise itself.
CREATE VIEW IF NOT EXISTS person_distinct_ids AS
SELECT project_id, alias, argMax(distinct_id, version) AS person
FROM person_aliases
GROUP BY project_id, alias;

-- Person properties merged across every distinct_id of a person.
CREATE VIEW IF NOT EXISTS persons_properties AS
SELECT
    p.project_id AS project_id,
    if(a.person = '', p.distinct_id, a.person) AS person,
    p.key AS key,
    if(argMaxMerge(p.set_value) != '', argMaxMerge(p.set_value), argMinMerge(p.set_once_value)) AS value
FROM person_properties AS p
LEFT JOIN person_distinct_ids AS a ON a.project_id = p.project_id AND a.alias = p.distinct_id
GROUP BY project_id, person, key;
