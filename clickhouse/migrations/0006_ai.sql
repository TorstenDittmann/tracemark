-- AI observability reads the model, trace and cost of `$ai_*` events on every query, so they get
-- materialized columns like the exception fingerprint. Older rows read them as empty or zero.
-- The cost is read through toString so a client-sent integer cost counts as well as a float.
ALTER TABLE events
    ADD COLUMN IF NOT EXISTS ai_model String
    MATERIALIZED ifNull(properties.`$ai_model`.:String, '');

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS ai_trace_id String
    MATERIALIZED ifNull(properties.`$ai_trace_id`.:String, '');

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS ai_cost_usd Float64
    MATERIALIZED ifNull(toFloat64OrNull(toString(properties.`$ai_cost_usd`)), 0);
