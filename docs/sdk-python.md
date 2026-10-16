# Python SDK

`footprint-sdk` sends events from Python servers and evaluates feature flags. It runs on Python 3.9+ and uses only the standard library.

```sh
pip install footprint-sdk
```

```python
import os
from footprint import Footprint

footprint = Footprint(
    "fp_pub_…",
    host="https://footprint.example.com",
    # Optional: evaluate flags in-process instead of asking the server each time.
    secret_key=os.environ.get("FOOTPRINT_SECRET_KEY"),
)

footprint.capture("user_123", "invoice_paid", {"amount": 49})
footprint.identify("user_123", set={"plan": "pro"})
footprint.alias("user_123", anonymous_id_from_the_browser)
footprint.group_identify("company", "acme", {"seats": 40})

if footprint.is_feature_enabled("new-checkout", "user_123", person_properties={"plan": "pro"}):
    ...

# Runs at exit too; call it yourself when you need the events sent now.
footprint.shutdown()
```

The client is also a context manager: `with Footprint(...) as footprint:` shuts it down when the block ends.

## Events

`capture(distinct_id, event, properties=None, groups=None, timestamp=None, set=None, set_once=None, uuid=None)`

- `timestamp` is a `datetime`; naive ones are local time. `datetime` and `date` values in properties are sent as ISO 8601 text.
- Events are queued and sent from a background thread in gzipped batches of up to 1000.
- A batch is sent once `flush_at` events (20) are queued, and at least every `flush_interval` seconds (10). `flush()` sends now and waits.
- A batch the server can't take (network error, 429, 5xx such as `503 not_ready`) is retried `max_retries` times (3), waiting `retry_backoff` seconds (0.5) and doubling. If it still fails it stays queued for the next flush.
- A batch the server rejects (other 4xx) is dropped with a warning on the `footprint` logger.
- The queue keeps at most `max_queue_size` events (10,000), dropping the oldest.
- No method raises on a failed send or an invalid event; errors are logged and passed to `on_error`.
- Every event carries `$lib: "footprint-python"` and `$lib_version`.

## Flags

```python
footprint.get_feature_flag("pricing", "user_123")         # False, True or the variant key
footprint.is_feature_enabled("new-checkout", "user_123")  # bool
footprint.get_feature_flag_payload("pricing", "user_123") # the JSON payload, or None
footprint.get_all_flags("user_123")                       # {key: value}
footprint.get_all_flags_and_payloads("user_123")          # .flags, .payloads
```

Each takes `person_properties`, `groups` and `group_properties`, plus `only_local`.

**Without `secret_key`**, every check is one `POST /flags` request (see [flags-api.md](flags-api.md)).

**With `secret_key`**:

- Definitions come from `GET /flags/definitions`, refreshed every `flags_poll_interval` seconds (30) in a background thread. If a refresh fails, the last definitions are kept. `reload_feature_flags()` refreshes now.
- Flags are evaluated in-process with a port of the shared evaluator in `packages/flags`, tested against `packages/flags/vectors.json`, so a person gets the same answer as from the server.
- Local evaluation only uses the properties you pass. When a flag filters on a property you didn't pass, or on a cohort, the SDK asks the server for it, and the server uses stored properties too.
- `only_local=True` skips the server; such flags come back off.

**Exposures:** `is_feature_enabled`, `get_feature_flag` and `get_feature_flag_payload` capture `$feature_flag_called` the first time a person gets each value. Turn this off per call with `send_exposure=False`. `get_all_flags` never captures one.

## Errors

```python
footprint = Footprint(api_key, host="https://footprint.example.com", release="1.4.0")

try:
    checkout()
except Exception:
    footprint.capture_exception(distinct_id=user.id, properties={"route": "/checkout"})

# Exceptions nothing caught (sys.excepthook and threading.excepthook) are captured and sent.
footprint.capture_uncaught_exceptions()
```

`capture_exception(error=None, distinct_id=None, properties=None, groups=None, mechanism="manual", handled=True)` sends a `$exception` event (see [errors.md](errors.md)). Without `error` it captures the exception being handled; without `distinct_id` it is attributed to `$server`. The `$exception_list` holds the exception, then its `__cause__` or `__context__` chain, with frames innermost first. Frames from the standard library and installed packages are not `in_app`.

## Options

| Option | Default | |
| --- | --- | --- |
| `api_key`, `host` | required | Public key and base URL |
| `secret_key` | `None` | Enables local flag evaluation |
| `flush_at` | `20` | Queue length that triggers a send |
| `flush_interval` | `10.0` | Seconds between sends |
| `flags_poll_interval` | `30.0` | Seconds between definition refreshes |
| `max_queue_size` | `10000` | Events kept while the server is unreachable |
| `request_timeout` | `10.0` | Seconds per request |
| `max_retries` | `3` | Retries of a failing batch per flush |
| `retry_backoff` | `0.5` | Seconds before the first retry, doubling |
| `gzip` | `True` | Compress event batches |
| `on_error` | `None` | Called with errors that are otherwise only logged |
| `release` | `None` | Sent as `$release` with exceptions |
