-- Members of static cohorts, by person key (an anonymous id is resolved when it is added).
-- Cohort definitions live in libSQL; removing a member is a lightweight DELETE.
CREATE TABLE IF NOT EXISTS cohort_people
(
    project_id  UUID,
    cohort_id   UUID,
    person      String,
    added_at    DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(added_at)
ORDER BY (project_id, cohort_id, person);
