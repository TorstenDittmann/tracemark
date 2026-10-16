# footprint-sdk

Python server SDK for footprint, self-hosted product analytics. Sends events and evaluates feature flags. Python 3.9+, no dependencies.

```sh
pip install footprint-sdk
```

```python
from footprint import Footprint

footprint = Footprint("fp_pub_…", host="https://footprint.example.com")

footprint.capture("user_123", "invoice_paid", {"amount": 49})
footprint.identify("user_123", set={"plan": "pro"})

if footprint.is_feature_enabled("new-checkout", "user_123"):
    ...

try:
    checkout()
except Exception:
    footprint.capture_exception(distinct_id="user_123")

footprint.shutdown()  # also runs at exit
```

Pass `secret_key="fp_sec_…"` to evaluate flags in-process; flags that need a cohort or a property you didn't pass are asked of the server.

Full documentation: [docs/sdk-python.md](../../docs/sdk-python.md).

## Development

```sh
cd packages/sdk-python
python3 -m unittest discover -s tests
pyright   # strict, configured in pyproject.toml
```

The flag tests load the shared vectors from `packages/flags/vectors.json` and the wire format tests check against `packages/schema/fixtures`, so run them from inside the monorepo.
