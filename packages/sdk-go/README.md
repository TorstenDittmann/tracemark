# footprint Go SDK

Send events and evaluate feature flags from Go servers with [footprint](https://github.com/TorstenDittmann/footprint), self-hosted product analytics. Go 1.22+, standard library only.

```sh
go get github.com/TorstenDittmann/footprint/packages/sdk-go
```

```go
package main

import (
	"context"
	"log"
	"os"

	footprint "github.com/TorstenDittmann/footprint/packages/sdk-go"
)

func main() {
	client, err := footprint.New(footprint.Config{
		APIKey:    "fp_pub_…",
		Host:      "https://footprint.example.com",
		SecretKey: os.Getenv("FOOTPRINT_SECRET_KEY"), // optional: local flag evaluation
	})
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close(context.Background())

	client.Capture(footprint.Event{
		DistinctID: "user_123",
		Event:      "invoice_paid",
		Properties: footprint.Properties{"amount": 49},
	})

	on, err := client.IsFeatureEnabled(context.Background(), "new-checkout", footprint.FlagRequest{
		DistinctID:       "user_123",
		PersonProperties: footprint.Properties{"plan": "pro"},
	})
	if err != nil {
		log.Print(err)
	}
	_ = on
}
```

The full guide is [docs/sdk-go.md](../../docs/sdk-go.md).

## Development

```sh
gofmt -l .        # prints nothing
go vet ./...
go test -race ./...
```

The tests read `../flags/vectors.json` (the shared flag vectors every evaluator must pass) and `../schema/fixtures`, so run them from a checkout of the monorepo. They use `httptest` servers and never the network.
