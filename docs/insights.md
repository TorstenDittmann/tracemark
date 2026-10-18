# Insights

Insights chart a project's events under **Insights**. Each kind can be saved, put on dashboards
and run through the [query API](query-api.md). People are counted once across their distinct ids,
times are UTC, and every kind takes property filters and a cohort.

| Kind | Answers |
| --- | --- |
| Trends | How often an event happens, or how many people do it, over time |
| Funnels | How many people do steps in order within a conversion window |
| Retention | How many people come back in the days or weeks after they first did something |
| Paths | What people do in a session after (or before) a page or event |
| Lifecycle | How many active people are new, returning or resurrecting, and how many went dormant |

## Paths

A path is one session's steps in time order. A step is either a page view, named by its
`$pathname` (**Page paths**), or any event but `$pageleave`, named by the event
(**Event names**). The same step twice in a row counts once, so reloading a page is not a step.
Events without a session id make up one session per person.

- **Starting at** cuts each path to begin at its first visit to that page or event; sessions that
  never reach it are left out. Without a start, paths begin with the session.
- **Ending at** cuts each path after the first visit to that page or event (after the start, if
  there is one); sessions that never reach it are left out. With an end and no start, the steps
  count back from the end, so the chart shows what led up to it.
- **Steps** is how many steps follow the start (or lead to the end), 1 to 10, 5 by default.

Each step keeps its 8 busiest pages or events and groups the rest as **Other**. A node's drop-off
is the sessions whose path stops there; counting back from an end, it is the sessions whose path
began there.

## Lifecycle

Lifecycle sorts the people who did one event by how they did it in each day, week (from Monday)
or month, following PostHog's definitions. For a period:

| State | Who |
| --- | --- |
| New | Active in the period, and doing the event for the first time ever |
| Returning | Active in the period and in the period before |
| Resurrecting | Active in the period, not in the period before, but at some time before that |
| Dormant | Active in the period before, but not in this one |

Dormant people are counted as negative, so the chart stacks them below zero. "Ever" looks back
over every event the project keeps (see [privacy.md](privacy.md) for retention), with the
insight's filters and cohort applied. The first period is counted whole even when the date range
starts inside it.
