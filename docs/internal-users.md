# Internal users

Your team clicks around the product too, and so do test accounts and a site running on
`localhost`. Under **Settings → Internal users**, owners and admins list rules that pick out that
traffic, then turn on **Filter out internal users by default** to leave it out of analytics.

## Rules

| Rule | Matches |
| --- | --- |
| Email is | People whose `email` person property is this address |
| Email ends with | People whose `email` ends with this domain, such as `@acme.com` (`acme.com` is stored as `@acme.com`) |
| Distinct id is | The person with this distinct id |
| Event property equals | Single events whose property has this value, such as `$host` equals `localhost` |

Emails compare without case. An event is left out when any rule matches it. A project has at most
50 rules.

Email and distinct id rules match **people**: every distinct id linked to the person is left out,
so a teammate's anonymous page views from before they signed in go too. A person matches when the
latest `email` set on any of their ids matches (with `$set`, or `$set_once` when nothing was set). Property
rules match events one at a time, so a customer's visit from `localhost` is left out but their
other visits stay.

Rules apply to past events too: they change what queries count, not what is stored.

## Where it applies

With the setting on, internal users are left out of:

- web analytics, including web vitals and the project home page,
- experiment results,
- the AI overview and trace list,
- error issues, the issue page and its counts,
- alerts: event counts, AI cost, and new or regressed issues.

Insights (trends, funnels, retention, paths, lifecycle and stickiness) have their own **Filter
internal users** toggle. It starts at the project's setting, and a saved insight keeps the choice it was
saved with, also on dashboards and in the [query API](query-api.md), which takes an optional
`filterInternal` boolean. Insights saved before the setting existed follow the project's setting.
With no rules the toggle is off and links to the settings.

Some pages always show everything, internal users included: the events explorer and the events
API, persons and groups, cohorts and their sizes, a single AI trace, flag evaluation, and person
export and deletion (see [privacy.md](privacy.md)).
