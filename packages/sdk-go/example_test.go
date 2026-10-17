package tracemark_test

import (
	"context"
	"errors"
	"log"
	"os"

	tracemark "github.com/TorstenDittmann/footprint/packages/sdk-go"
)

// Compiled, not run: it would need a tracemark instance.
func Example() {
	client, err := tracemark.New(tracemark.Config{
		APIKey:    "fp_pub_…",
		Host:      "https://tracemark.example.com",
		SecretKey: os.Getenv("TRACEMARK_SECRET_KEY"),
		Release:   "1.4.0",
	})
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close(context.Background())
	defer client.CapturePanic("")

	ctx := context.Background()
	_ = client.Capture(tracemark.Event{DistinctID: "user_123", Event: "invoice_paid", Properties: tracemark.Properties{"amount": 49}})
	_ = client.Identify("user_123", tracemark.Properties{"plan": "pro"}, nil)
	_ = client.Alias("user_123", "anon-1")
	_ = client.GroupIdentify("company", "acme", tracemark.Properties{"seats": 40})
	_ = client.CaptureException("user_123", errors.New("payment failed"), tracemark.Properties{"route": "/checkout"})

	req := tracemark.FlagRequest{
		DistinctID:       "user_123",
		PersonProperties: tracemark.Properties{"plan": "pro"},
		Groups:           map[string]string{"company": "acme"},
		GroupProperties:  map[string]tracemark.Properties{"company": {"seats": 40}},
	}
	if on, _ := client.IsFeatureEnabled(ctx, "new-checkout", req); on {
		log.Print("new checkout")
	}
	if value, _ := client.GetFeatureFlag(ctx, "pricing", req); value == "test" {
		payload, _ := client.GetFeatureFlagPayload(ctx, "pricing", req)
		log.Print(payload)
	}
	flags, _ := client.GetAllFlags(ctx, req)
	log.Print(flags)
	_ = client.Flush(ctx)
}
