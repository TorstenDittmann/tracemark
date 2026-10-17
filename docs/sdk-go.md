# Go SDK

`github.com/TorstenDittmann/footprint/packages/sdk-go` sends events from Go servers and evaluates feature flags. It needs Go 1.22+ and has no dependencies outside the standard library.

```sh
go get github.com/TorstenDittmann/footprint/packages/sdk-go
```

```go
import tracemark "github.com/TorstenDittmann/footprint/packages/sdk-go"

client, err := tracemark.New(tracemark.Config{
	APIKey: "fp_pub_…",
	Host:   "https://tracemark.example.com",
	// Optional: evaluate flags in-process instead of asking the server each time.
	SecretKey: os.Getenv("TRACEMARK_SECRET_KEY"),
})
if err != nil {
	log.Fatal(err)
}
// Before the process exits:
defer client.Close(context.Background())

client.Capture(tracemark.Event{DistinctID: "user_123", Event: "invoice_paid", Properties: tracemark.Properties{"amount": 49}})
client.Identify("user_123", tracemark.Properties{"plan": "pro"}, nil)
client.Alias("user_123", anonymousIDFromTheBrowser)
client.GroupIdentify("company", "acme", tracemark.Properties{"seats": 40})

on, err := client.IsFeatureEnabled(ctx, "new-checkout", tracemark.FlagRequest{
	DistinctID:       "user_123",
	PersonProperties: tracemark.Properties{"plan": "pro"},
})
```

## Events

- Events are queued and sent from a background goroutine in gzipped batches of up to 1000.
- A batch is sent once `FlushAt` events (20) are queued, and at least every `FlushInterval` (10 s). `Flush(ctx)` sends now and waits.
- A network error, 5xx or 429 is retried `MaxRetries` times (3) with exponential backoff from `RetryBackoff` (500 ms), honoring `Retry-After`. A batch that still fails stays queued for the next flush, and `Flush` returns the error.
- A batch the server rejects (any other 4xx) is dropped and logged as a warning to `Logger` (`slog.Default()`).
- The queue keeps at most `MaxQueueSize` events (10,000), dropping the oldest.
- `Capture` returns an error, and queues nothing, for an event ingest would reject: an empty or over-long id or name, more than 5 groups, a timestamp outside 1900–2299, or properties that don't encode to JSON. Properties are encoded right away, so you can reuse your maps.
- Every event carries `$lib: "tracemark-go"` and `$lib_version`.
- The client is safe for concurrent use. After `Close`, `Capture` returns `ErrClosed`.

## Flags

**Without `SecretKey`**, every check is one `POST /flags` request (see [flags-api.md](flags-api.md)).

**With `SecretKey`**:

- Definitions come from `GET /flags/definitions`, refreshed every `FlagsPollInterval` (30 s). If a refresh fails, the last definitions are kept. `ReloadFlags(ctx)` refreshes now.
- Flags are evaluated in-process with a port of `packages/flags`, tested against the shared vectors, so a person gets the same answer as from the server.
- Local evaluation only uses the properties you pass in `PersonProperties` and `GroupProperties`. When a flag filters on a property you didn't pass, or on a cohort, the SDK asks the server for it, and the server uses stored properties too.
- `OnlyLocal: true` skips the server; such flags come back off.

```go
req := tracemark.FlagRequest{
	DistinctID:      "user_123",
	Groups:          map[string]string{"company": "acme"},
	GroupProperties: map[string]tracemark.Properties{"company": {"seats": 40}},
}
value, err := client.GetFeatureFlag(ctx, "pricing", req)        // false, true or a variant key
payload, err := client.GetFeatureFlagPayload(ctx, "pricing", req) // decoded JSON, nil when off
flags, err := client.GetAllFlags(ctx, req)                      // map[string]FlagValue
all, err := client.GetAllFlagsAndPayloads(ctx, req)
```

A failed check returns the error with the flag off. `GetAllFlags` returns the flags it could decide locally along with the error.

**Exposures:** `IsFeatureEnabled`, `GetFeatureFlag` and `GetFeatureFlagPayload` capture `$feature_flag_called` the first time a person gets each value. Turn this off per call with `DisableExposure: true`. `GetAllFlags` never captures one, and neither does a failed check.

## Errors

```go
client.CaptureException("user_123", err, tracemark.Properties{"route": "/checkout"})

// Panics: captured as fatal, sent, then panicked again.
defer client.CapturePanic("user_123")
```

- An empty distinct id attributes the error to `$server`.
- `$exception_list` holds the error, then each error it wraps (`errors.Unwrap`, the first of a join), up to four. The type is the Go type, such as `fs.PathError`; a non-error panic value has type `panic`.
- The first entry carries the stack where the error was captured (for `CapturePanic`, where it panicked), innermost first, as `{ filename, function, lineno, in_app }`. Frames from the standard library, the module cache and `vendor` are not `in_app`.
- `CaptureExceptionWith(err, ExceptionOptions{…})` sets the groups, the mechanism (`manual`) and `Unhandled` (level `fatal`).
- `Release` in the config is sent as `$release`.

## Cookies

`client.DistinctIDFromCookie(r.Header.Get("Cookie"))` reads the distinct id the browser SDK keeps in its cookie (with `persistence: 'cookie'`), so server events join the visitor's person.
