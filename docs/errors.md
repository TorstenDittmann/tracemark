# Error tracking

Errors are `$exception` events. Ingest groups them into issues by a fingerprint, and the app
shows each issue with how often it happens and who it affects.

## Browser

```ts
import { footprint } from '@footprint/browser';
import { createErrors } from '@footprint/browser/errors';

const errors = createErrors({ release: '1.4.0' });
footprint.init({ apiKey: 'fp_pub_…', host: 'https://footprint.example.com' });
footprint.use(errors);

try {
  checkout();
} catch (error) {
  errors.captureException(error, { step: 'payment' });
}
```

The plugin captures errors nothing caught (`error` and `unhandledrejection` on `window`) unless
`autocapture: false`. Options:

- `release`: your app's version, sent as `$release`; source maps are matched against it.
- `ignore`: strings or patterns; errors whose `Type: message` matches are dropped.
- `inApp(filename)`: which frames are your code. Defaults to scripts from the page's origin.

Cross-origin "Script error." events are dropped, and the same error is captured at most five
times per page so a loop can't flood your project. Script tag: `footprint-errors.iife.js`
exposes `window.footprintErrors.createErrors`.

## Node

```ts
const footprint = new Footprint({ apiKey, host, release: '1.4.0' });

footprint.captureException(error, { distinctId: user.id, properties: { route: '/checkout' } });

// Errors nothing caught: captured, sent, then the process exits with code 1 as it would anyway.
footprint.captureUncaughtExceptions();
```

Without a `distinctId` an error is attributed to `$server`.

## The `$exception` event

| Property | |
| -- | -- |
| `$exception_list` | The error, then each `cause`: `{ type, value, mechanism: { type, handled }, stacktrace?: { frames } }` |
| `frames` | Innermost first (`frames[0]` threw): `{ filename, function, lineno, colno, in_app }` |
| `$exception_level` | `error` for caught errors, `fatal` for uncaught ones |
| `$exception_fingerprint` | Set by ingest; send your own to group errors yourself |
| `$release` | The app version, when configured |

## Grouping

Ingest fingerprints each `$exception` that doesn't bring its own `$exception_fingerprint`:

- With a stack trace: the error type plus the first five frames of your own code (`in_app`), as
  file and function. Line and column numbers, origins, query strings and bundler hashes such as
  `index-B3xk9aZ1.js` are ignored, so an issue survives deploys.
- Without one: the type and message, with every word containing a digit masked, so
  `User 123 not found` and `User 456 not found` are one issue.

Minified function names can change between builds; when that splits an issue, set
`$exception_fingerprint` yourself.

## Issues

Each fingerprint is an issue on the project's **Issues** page, listed by when it was last seen,
with occurrences, people affected and a trend over the chosen range. An issue's page shows its
chart over time, the latest occurrence's stack trace and causes, the people it hit most and its
recent occurrences. Errors attributed to `$server` don't count as people.

Issues are open until someone resolves or ignores them. A resolved issue that happens again
opens again, marked as regressed; an ignored one stays ignored.
