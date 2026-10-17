# @tracemark/react

React bindings for [tracemark](https://github.com/TorstenDittmann/tracemark): client context, feature flag hooks and error boundaries. Supports React 18 and 19.

```sh
npm install @tracemark/react @tracemark/browser
```

Wrap your app in `TracemarkProvider`, then use `useTracemark`, `useFeatureFlag`, `useFeatureFlagEnabled` and `useFeatureFlagPayload`. Add `TracemarkErrorBoundary` to capture rendering errors.

Requires a running tracemark instance and its project key.

[Setup and examples](https://github.com/TorstenDittmann/tracemark/blob/main/docs/frameworks.md#react-tracemarkreact)

MIT licensed.
