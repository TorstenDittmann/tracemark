package tracemark

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

var bg = context.Background()

func flagDef(key string, extra map[string]any) map[string]any {
	f := map[string]any{
		"key":        key,
		"active":     true,
		"conditions": []any{map[string]any{"filters": []any{}, "rollout": 100}},
		"variants":   []any{},
		"payloads":   map[string]any{},
	}
	for k, v := range extra {
		f[k] = v
	}
	return f
}

func flagRequests(s *fakeServer) []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]any(nil), s.flagRequests...)
}

func TestAsksTheServerWithoutASecretKey(t *testing.T) {
	s := newServer(t)
	s.flags = func(map[string]any) any {
		return map[string]any{
			"flags":    map[string]any{"beta": "test", "off": false},
			"payloads": map[string]any{"beta": map[string]any{"x": 1}},
		}
	}
	c, _ := newClient(t, s, Config{})
	req := FlagRequest{DistinctID: "ada", PersonProperties: Properties{"plan": "pro"}, Groups: map[string]string{"company": "acme"}}
	if v, err := c.GetFeatureFlag(bg, "beta", req); err != nil || v != "test" {
		t.Errorf("GetFeatureFlag = %v, %v", v, err)
	}
	if on, err := c.IsFeatureEnabled(bg, "off", FlagRequest{DistinctID: "ada"}); err != nil || on {
		t.Errorf("IsFeatureEnabled(off) = %v, %v", on, err)
	}
	if p, err := c.GetFeatureFlagPayload(bg, "beta", FlagRequest{DistinctID: "ada"}); err != nil || mustJSON(t, p) != `{"x":1}` {
		t.Errorf("GetFeatureFlagPayload = %v, %v", p, err)
	}
	if p, _ := c.GetFeatureFlagPayload(bg, "off", FlagRequest{DistinctID: "ada"}); p != nil {
		t.Errorf("payload of an off flag = %v", p)
	}
	want := map[string]any{
		"api_key":           "fp_pub_test",
		"distinct_id":       "ada",
		"person_properties": map[string]any{"plan": "pro"},
		"groups":            map[string]any{"company": "acme"},
	}
	if got := flagRequests(s)[0]; !reflect.DeepEqual(got, want) {
		t.Errorf("POST /flags body = %v", got)
	}
	flush(t, c)
	events := s.events()
	if len(events) != 2 {
		t.Fatalf("got %d exposures, want 2: %v", len(events), s.eventNames())
	}
	first := events[0]["properties"].(map[string]any)
	second := events[1]["properties"].(map[string]any)
	if events[0]["event"] != "$feature_flag_called" || events[0]["distinct_id"] != "ada" ||
		first["$feature_flag"] != "beta" || first["$feature_flag_response"] != "test" ||
		mustJSON(t, events[0]["groups"]) != `{"company":"acme"}` {
		t.Errorf("first exposure = %s", mustJSON(t, events[0]))
	}
	if second["$feature_flag"] != "off" || second["$feature_flag_response"] != false {
		t.Errorf("second exposure = %s", mustJSON(t, events[1]))
	}
}

func TestEvaluatesLocallyAndAsksTheServerOnlyWhenItMust(t *testing.T) {
	s := newServer(t)
	s.definitions = []any{
		flagDef("everyone", map[string]any{"payloads": map[string]any{"true": "hi"}}),
		flagDef("pros", map[string]any{"conditions": []any{map[string]any{
			"filters": []any{map[string]any{"type": "person", "property": "plan", "operator": "eq", "value": "pro"}},
			"rollout": 100,
		}}}),
		flagDef("vips", map[string]any{"conditions": []any{map[string]any{
			"filters": []any{map[string]any{"type": "cohort", "cohort": "c1"}},
			"rollout": 100,
		}}}),
	}
	s.flags = func(map[string]any) any {
		return map[string]any{
			"flags":    map[string]any{"everyone": true, "pros": false, "vips": true},
			"payloads": map[string]any{"everyone": "from the server"},
		}
	}
	c, _ := newClient(t, s, Config{SecretKey: "fp_sec_test"})
	ada := FlagRequest{DistinctID: "ada"}
	check := func(key string, req FlagRequest, want bool) {
		t.Helper()
		if on, err := c.IsFeatureEnabled(bg, key, req); err != nil || on != want {
			t.Errorf("IsFeatureEnabled(%s, %+v) = %v, %v; want %v", key, req, on, err, want)
		}
	}
	check("everyone", ada, true)
	if p, err := c.GetFeatureFlagPayload(bg, "everyone", ada); err != nil || p != "hi" {
		t.Errorf("payload = %v, %v", p, err)
	}
	check("pros", FlagRequest{DistinctID: "ada", PersonProperties: Properties{"plan": "pro"}}, true)
	check("missing", ada, false)
	if n := len(flagRequests(s)); n != 0 {
		t.Errorf("asked the server %d times for flags it could decide", n)
	}
	s.set(func(s *fakeServer) {
		if !reflect.DeepEqual(s.definitionsAuth, []string{"Bearer fp_sec_test"}) {
			t.Errorf("definitions requests: %v", s.definitionsAuth)
		}
	})

	// A property it wasn't given, and a cohort: the server decides.
	check("pros", ada, false)
	check("vips", ada, true)
	if n := len(flagRequests(s)); n != 2 {
		t.Errorf("asked the server %d times, want 2", n)
	}
	check("vips", FlagRequest{DistinctID: "ada", OnlyLocal: true}, false)
	if n := len(flagRequests(s)); n != 2 {
		t.Errorf("OnlyLocal asked the server")
	}

	all, err := c.GetAllFlagsAndPayloads(bg, FlagRequest{DistinctID: "ada", PersonProperties: Properties{"plan": "free"}})
	if err != nil {
		t.Fatal(err)
	}
	if want := map[string]FlagValue{"everyone": true, "pros": false, "vips": true}; !reflect.DeepEqual(all.Flags, want) {
		t.Errorf("flags = %v", all.Flags)
	}
	// The local payload wins over the server's.
	if want := map[string]any{"everyone": "hi"}; !reflect.DeepEqual(all.Payloads, want) {
		t.Errorf("payloads = %v", all.Payloads)
	}
}

func TestReturnsTheServersErrorWithoutAnExposure(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	s.set(func(s *fakeServer) { s.flagsStatus = 500 })
	v, err := c.GetFeatureFlag(bg, "a", FlagRequest{DistinctID: "ada"})
	if err == nil || !strings.Contains(err.Error(), "HTTP 500") || v != false {
		t.Errorf("GetFeatureFlag = %v, %v", v, err)
	}
	if _, err := c.GetAllFlags(bg, FlagRequest{}); err == nil {
		t.Error("GetAllFlags without a distinct id should fail")
	}
	flush(t, c)
	if n := len(s.events()); n != 0 {
		t.Errorf("captured %d exposures for a failed check", n)
	}
}

func TestKeepsTheLastDefinitionsWhenARefreshFails(t *testing.T) {
	s := newServer(t)
	s.definitions = []any{flagDef("a", nil), map[string]any{"key": "!bad"}}
	c, l := newClient(t, s, Config{SecretKey: "fp_sec_test"})
	local := FlagRequest{DistinctID: "ada", OnlyLocal: true}
	if on, _ := c.IsFeatureEnabled(bg, "a", local); !on {
		t.Fatal("a is off")
	}
	s.set(func(s *fakeServer) { s.definitions = nil })
	err := c.ReloadFlags(bg)
	if err == nil || !strings.Contains(err.Error(), "HTTP 401") {
		t.Errorf("ReloadFlags = %v", err)
	}
	if on, _ := c.IsFeatureEnabled(bg, "a", local); !on {
		t.Error("lost the definitions after a failed refresh")
	}
	if logged := l.all(); len(logged) != 1 || !strings.Contains(logged[0], "invalid flag definition") {
		t.Errorf("logged %q", logged)
	}
}

func TestPollsDefinitions(t *testing.T) {
	s := newServer(t)
	s.definitions = []any{}
	c, _ := newClient(t, s, Config{SecretKey: "fp_sec_test", FlagsPollInterval: 20 * time.Millisecond})
	local := FlagRequest{DistinctID: "ada", OnlyLocal: true}
	if on, _ := c.IsFeatureEnabled(bg, "late", local); on {
		t.Fatal("late is on before it exists")
	}
	s.set(func(s *fakeServer) { s.definitions = []any{flagDef("late", nil)} })
	waitFor(t, "the next poll", func() bool {
		on, _ := c.IsFeatureEnabled(bg, "late", local)
		return on
	})
}

func TestFallsBackToTheServerWhenDefinitionsNeverLoaded(t *testing.T) {
	s := newServer(t)
	s.definitions = nil
	s.flags = func(map[string]any) any {
		return map[string]any{"flags": map[string]any{"a": true}, "payloads": map[string]any{}}
	}
	c, _ := newClient(t, s, Config{SecretKey: "fp_sec_bad"})
	if on, err := c.IsFeatureEnabled(bg, "a", FlagRequest{DistinctID: "ada"}); err != nil || !on {
		t.Errorf("IsFeatureEnabled = %v, %v", on, err)
	}
	if n := len(flagRequests(s)); n != 1 {
		t.Errorf("asked the server %d times, want 1", n)
	}
}

func TestRecordsAnExposureOncePerPersonAndValue(t *testing.T) {
	s := newServer(t)
	s.definitions = []any{flagDef("a", nil)}
	c, _ := newClient(t, s, Config{SecretKey: "fp_sec_test"})
	for _, req := range []FlagRequest{
		{DistinctID: "ada"},
		{DistinctID: "ada"},
		{DistinctID: "grace"},
		{DistinctID: "bob", DisableExposure: true},
	} {
		if _, err := c.IsFeatureEnabled(bg, "a", req); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := c.GetFeatureFlagPayload(bg, "a", FlagRequest{DistinctID: "ada"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetAllFlags(bg, FlagRequest{DistinctID: "eve"}); err != nil {
		t.Fatal(err)
	}
	// The same person getting a new value is a new exposure.
	s.set(func(s *fakeServer) { s.definitions = []any{flagDef("a", map[string]any{"active": false})} })
	must(t, c.ReloadFlags(bg))
	if _, err := c.GetFeatureFlag(bg, "a", FlagRequest{DistinctID: "ada"}); err != nil {
		t.Fatal(err)
	}
	flush(t, c)
	var got []string
	for _, e := range s.events() {
		got = append(got, e["distinct_id"].(string)+"="+mustJSON(t, e["properties"].(map[string]any)["$feature_flag_response"]))
	}
	if want := []string{"ada=true", "grace=true", "ada=false"}; !reflect.DeepEqual(got, want) {
		t.Errorf("exposures = %v, want %v", got, want)
	}
}

// Every vector case that can be decided locally comes out the same through the client, without
// a request to the server.
func TestPassesTheSharedVectorsThroughTheClient(t *testing.T) {
	ran := 0
	for _, vf := range loadVectors(t).Flags {
		s := newServer(t)
		s.definitions = []any{vf.Flag}
		c, _ := newClient(t, s, Config{SecretKey: "fp_sec_test"})
		def, err := parseFlag(vf.Flag)
		if err != nil {
			t.Fatal(err)
		}
		key := def.Key
		for i, vc := range vf.Cases {
			// Cases that need a property or cohort the context lacks are the server's to decide,
			// and the SDK never knows cohort membership.
			if _, err := evaluate(&def, vc.context(), true); err != nil || string(vc.Expected) == `"inconclusive"` || vc.Context.Cohorts != nil {
				continue
			}
			var want struct {
				Value any `json:"value"`
			}
			must(t, json.Unmarshal(vc.Expected, &want))
			got, err := c.GetFeatureFlag(bg, key, FlagRequest{
				DistinctID:       vc.Context.DistinctID,
				PersonProperties: vc.Context.PersonProperties,
				Groups:           vc.Context.Groups,
				GroupProperties:  vc.Context.GroupProperties,
				OnlyLocal:        true,
				DisableExposure:  true,
			})
			if err != nil || got != want.Value {
				t.Errorf("%s case %d: got %v, %v; want %v", vf.Name, i, got, err, want.Value)
			}
			ran++
		}
		if n := len(flagRequests(s)); n != 0 {
			t.Errorf("%s: asked the server %d times", vf.Name, n)
		}
	}
	if ran == 0 {
		t.Fatal("no vector cases ran")
	}
}

func TestInconclusiveVectorsGoToTheServer(t *testing.T) {
	ran := 0
	for _, vf := range loadVectors(t).Flags {
		def, _ := parseFlag(vf.Flag)
		for _, vc := range vf.Cases {
			if _, err := evaluate(&def, vc.context(), true); err == nil && vc.Context.Cohorts == nil {
				continue
			}
			s := newServer(t)
			s.definitions = []any{vf.Flag}
			s.flags = func(map[string]any) any {
				return map[string]any{"flags": map[string]any{def.Key: "from-server"}, "payloads": map[string]any{}}
			}
			c, _ := newClient(t, s, Config{SecretKey: "fp_sec_test"})
			got, err := c.GetFeatureFlag(bg, def.Key, FlagRequest{
				DistinctID:       vc.Context.DistinctID,
				PersonProperties: vc.Context.PersonProperties,
				Groups:           vc.Context.Groups,
				GroupProperties:  vc.Context.GroupProperties,
			})
			if err != nil || got != "from-server" || len(flagRequests(s)) != 1 {
				t.Errorf("%s: got %v, %v after %d requests", vf.Name, got, err, len(flagRequests(s)))
			}
			ran++
		}
	}
	if ran == 0 {
		t.Fatal("no inconclusive cases ran")
	}
}

func TestFlagChecksHonorTheContext(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	ctx, cancel := context.WithCancel(bg)
	cancel()
	if _, err := c.GetFeatureFlag(ctx, "a", FlagRequest{DistinctID: "ada"}); !errors.Is(err, context.Canceled) {
		t.Errorf("GetFeatureFlag = %v, want context.Canceled", err)
	}
}
