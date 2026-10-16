-- Group properties per group and key. Values are raw JSON; the latest `$groupidentify` wins.
-- Fed by `$groupidentify` events: `$group_type`, `$group_key` and the `$group_set` object.
CREATE TABLE IF NOT EXISTS group_properties
(
    project_id  UUID,
    group_type  String,
    group_key   String,
    key         String,
    value       AggregateFunction(argMax, String, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree
ORDER BY (project_id, group_type, group_key, key);

CREATE MATERIALIZED VIEW IF NOT EXISTS group_properties_mv TO group_properties AS
SELECT
    project_id,
    toString(properties.`$group_type`) AS group_type,
    toString(properties.`$group_key`) AS group_key,
    kv.1 AS key,
    argMaxState(kv.2, timestamp) AS value
FROM events
ARRAY JOIN JSONExtractKeysAndValuesRaw(JSONExtractRaw(toJSONString(properties), '$group_set')) AS kv
WHERE event = '$groupidentify'
    AND group_type NOT IN ('', '\\N')
    AND group_key NOT IN ('', '\\N')
GROUP BY project_id, group_type, group_key, key;

-- Group properties with each key's latest value.
CREATE VIEW IF NOT EXISTS groups_properties AS
SELECT project_id, group_type, group_key, key, argMaxMerge(value) AS value
FROM group_properties
GROUP BY project_id, group_type, group_key, key;
