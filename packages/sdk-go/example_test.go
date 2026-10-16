package footprint_test

import (
	"context"
	"errors"
	"log"
	"os"

	footprint "github.com/TorstenDittmann/footprint/packages/sdk-go"
)

// Compiled, not run: it would need a footprint instance.
func Example() {
	client, err := footprint.New(footprint.Config{
		APIKey:    "fp_pub_…",
		Host:      "https://footprint.example.com",
		SecretKey: os.Getenv("FOOTPRINT_SECRET_KEY"),
		Release:   "1.4.0",
	})
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close(context.Background())
	defer client.CapturePanic("")

	ctx := context.Background()
	_ = client.Capture(footprint.Event{DistinctID: "user_123", Event: "invoice_paid", Properties: footprint.Properties{"amount": 49}})
	_ = client.Identify("user_123", footprint.Properties{"plan": "pro"}, nil)
	_ = client.Alias("user_123", "anon-1")
	_ = client.GroupIdentify("company", "acme", footprint.Properties{"seats": 40})
	_ = client.CaptureException("user_123", errors.New("payment failed"), footprint.Properties{"route": "/checkout"})

	req := footprint.FlagRequest{
		DistinctID:       "user_123",
		PersonProperties: footprint.Properties{"plan": "pro"},
		Groups:           map[string]string{"company": "acme"},
		GroupProperties:  map[string]footprint.Properties{"company": {"seats": 40}},
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
