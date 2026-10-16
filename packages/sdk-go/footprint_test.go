package footprint

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

func TestNewNeedsKeyAndHost(t *testing.T) {
	if _, err := New(Config{Host: "http://x"}); err == nil {
		t.Error("New accepted a config without APIKey")
	}
	if _, err := New(Config{APIKey: "fp_pub_x"}); err == nil {
		t.Error("New accepted a config without Host")
	}
}

func TestSendsEventsInTheIngestWireFormat(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	ts := time.Date(2026, 10, 16, 14, 0, 0, 0, time.FixedZone("CEST", 2*3600))
	must(t, c.Capture(Event{
		DistinctID: "ada",
		Event:      "purchase",
		Properties: Properties{"amount": 9},
		Groups:     map[string]string{"company": "acme"},
		Timestamp:  ts,
		UUID:       "01927d0b-8c4a-7cc2-9f43-3c1b2b0e9a11",
	}))
	must(t, c.Identify("ada", Properties{"plan": "pro"}, Properties{"first": "go"}))
	must(t, c.Alias("ada", "anon-1"))
	must(t, c.GroupIdentify("company", "acme", Properties{"seats": 4}))
	flush(t, c)

	if len(s.batchList()) != 1 {
		t.Fatalf("got %d batches, want 1", len(s.batchList()))
	}
	if s.batchList()[0].APIKey != "fp_pub_test" {
		t.Errorf("api_key = %q", s.batchList()[0].APIKey)
	}
	if _, err := time.Parse(time.RFC3339Nano, s.batchList()[0].SentAt); err != nil {
		t.Errorf("sent_at %q: %v", s.batchList()[0].SentAt, err)
	}
	if s.encodingList()[0] != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip", s.encodingList()[0])
	}
	events := s.events()
	wantPurchase := map[string]any{
		"uuid":        "01927d0b-8c4a-7cc2-9f43-3c1b2b0e9a11",
		"event":       "purchase",
		"distinct_id": "ada",
		"timestamp":   "2026-10-16T12:00:00.000Z",
		"properties":  map[string]any{"$lib": "footprint-go", "$lib_version": Version, "amount": 9},
		"groups":      map[string]any{"company": "acme"},
	}
	if got, want := asJSON(t, events[0]), asJSON(t, wantPurchase); !reflect.DeepEqual(got, want) {
		t.Errorf("purchase:\n got %s\nwant %s", mustJSON(t, got), mustJSON(t, want))
	}
	set := events[1]
	if set["event"] != "$set" || mustJSON(t, set["person"]) != `{"set":{"plan":"pro"},"set_once":{"first":"go"}}` {
		t.Errorf("identify = %s", mustJSON(t, set))
	}
	alias := events[2]
	if alias["event"] != "$identify" || alias["distinct_id"] != "ada" ||
		alias["properties"].(map[string]any)["$anon_distinct_id"] != "anon-1" {
		t.Errorf("alias = %s", mustJSON(t, alias))
	}
	group := events[3]
	props := group["properties"].(map[string]any)
	if group["event"] != "$groupidentify" || group["distinct_id"] != "$company_acme" ||
		props["$group_type"] != "company" || props["$group_key"] != "acme" ||
		mustJSON(t, props["$group_set"]) != `{"seats":4}` || mustJSON(t, group["groups"]) != `{"company":"acme"}` {
		t.Errorf("groupidentify = %s", mustJSON(t, group))
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(group["uuid"].(string)) {
		t.Errorf("generated uuid %v is not a v7 UUID", group["uuid"])
	}
}

// fixtureRules checks one event against the ingest protocol's rules for POST /e.
func fixtureRules(e map[string]any) error {
	str := func(field string, required bool, max int) error {
		v, ok := e[field]
		if !ok || v == nil {
			if required {
				return fmt.Errorf("%s is missing", field)
			}
			return nil
		}
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("%s is not a string", field)
		}
		if n := utf8.RuneCountInString(s); (required && n == 0) || n > max {
			return fmt.Errorf("%s has %d characters", field, n)
		}
		return nil
	}
	for _, check := range []error{
		str("uuid", true, 36), str("event", true, 200), str("distinct_id", true, 200),
		str("timestamp", true, 64), str("session_id", false, 200),
	} {
		if check != nil {
			return check
		}
	}
	if !regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`).MatchString(e["uuid"].(string)) {
		return errors.New("uuid is not a UUID")
	}
	ts, err := time.Parse(time.RFC3339Nano, e["timestamp"].(string))
	if err != nil || ts.Year() < 1900 || ts.Year() > 2299 {
		return fmt.Errorf("bad timestamp %v", e["timestamp"])
	}
	for _, field := range []string{"properties", "person", "groups"} {
		if v, ok := e[field]; ok && v != nil {
			if _, ok := v.(map[string]any); !ok {
				return fmt.Errorf("%s is not an object", field)
			}
		}
	}
	if person, ok := e["person"].(map[string]any); ok {
		for _, k := range []string{"set", "set_once"} {
			if v, ok := person[k]; ok && v != nil {
				if _, ok := v.(map[string]any); !ok {
					return fmt.Errorf("person.%s is not an object", k)
				}
			}
		}
	}
	if groups, ok := e["groups"].(map[string]any); ok {
		if len(groups) > 5 {
			return errors.New("more than 5 groups")
		}
		for k, v := range groups {
			s, ok := v.(string)
			if !ok || utf8.RuneCountInString(k) > 200 || utf8.RuneCountInString(s) > 200 {
				return errors.New("bad group")
			}
		}
	}
	return nil
}

func readFixtures(t *testing.T, kind string) map[string]batchBody {
	t.Helper()
	dir := filepath.Join("..", "schema", "fixtures", kind)
	files, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no fixtures in %s: %v", dir, err)
	}
	out := map[string]batchBody{}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var body batchBody
		if err := json.Unmarshal(raw, &body); err != nil {
			// properties-not-object.json etc. still decode; anything else is a broken fixture.
			t.Fatalf("%s: %v", f, err)
		}
		out[filepath.Base(f)] = body
	}
	return out
}

func TestEventsFollowTheSchemaFixtures(t *testing.T) {
	// The rules above accept every valid fixture and reject every invalid one...
	keys := map[string]bool{}
	for name, body := range readFixtures(t, "valid") {
		for i, e := range body.Batch {
			if err := fixtureRules(e); err != nil {
				t.Errorf("valid/%s event %d: %v", name, i, err)
			}
			for k := range e {
				keys[k] = true
			}
		}
	}
	for name, body := range readFixtures(t, "invalid") {
		var failed bool
		for _, e := range body.Batch {
			failed = failed || fixtureRules(e) != nil
		}
		if !failed {
			t.Errorf("invalid/%s passes the rules", name)
		}
	}

	// ...and every kind of event the SDK sends passes them, using only fields the fixtures use.
	s := newServer(t)
	c, _ := newClient(t, s, Config{Release: "1.0.0"})
	must(t, c.Capture(Event{DistinctID: "a", Event: "e", Groups: map[string]string{"g": "k"}, Set: Properties{"a": 1}, SetOnce: Properties{"b": 2}}))
	must(t, c.Identify("a", Properties{"plan": "pro"}, nil))
	must(t, c.Alias("a", "anon"))
	must(t, c.GroupIdentify("company", "acme", nil))
	must(t, c.CaptureException("a", errors.New("boom"), Properties{"route": "/"}))
	_, _ = c.IsFeatureEnabled(context.Background(), "x", FlagRequest{DistinctID: "a"})
	flush(t, c)
	events := s.events()
	if len(events) != 6 {
		t.Fatalf("got %d events, want 6", len(events))
	}
	for _, e := range events {
		if err := fixtureRules(e); err != nil {
			t.Errorf("%v: %v", e["event"], err)
		}
		for k := range e {
			if !keys[k] {
				t.Errorf("%v sends field %q, which no valid fixture uses", e["event"], k)
			}
		}
	}
}

func TestCaptureRejectsEventsIngestWouldRefuse(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	groups := map[string]string{}
	for i := range 6 {
		groups[fmt.Sprint("t", i)] = "k"
	}
	for name, e := range map[string]Event{
		"no distinct id":   {Event: "x"},
		"no event":         {DistinctID: "a"},
		"long event":       {DistinctID: "a", Event: strings.Repeat("a", 201)},
		"long distinct id": {DistinctID: strings.Repeat("é", 201), Event: "x"},
		"six groups":       {DistinctID: "a", Event: "x", Groups: groups},
		"long group key":   {DistinctID: "a", Event: "x", Groups: map[string]string{"g": strings.Repeat("k", 201)}},
		"year 1800":        {DistinctID: "a", Event: "x", Timestamp: time.Date(1800, 1, 1, 0, 0, 0, 0, time.UTC)},
		"not JSON":         {DistinctID: "a", Event: "x", Properties: Properties{"f": func() {}}},
	} {
		if err := c.Capture(e); err == nil {
			t.Errorf("%s: Capture accepted it", name)
		}
	}
	// 200 characters, counted as characters rather than bytes, is fine.
	must(t, c.Capture(Event{DistinctID: strings.Repeat("é", 200), Event: strings.Repeat("a", 200)}))
	flush(t, c)
	if n := len(s.events()); n != 1 {
		t.Errorf("sent %d events, want 1", n)
	}
}

func TestCallerMayReuseMapsAfterCapture(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	props := Properties{"step": 1}
	must(t, c.Capture(Event{DistinctID: "a", Event: "x", Properties: props}))
	props["step"] = 2
	props["$lib"] = "mine"
	flush(t, c)
	got := s.events()[0]["properties"].(map[string]any)
	if fmt.Sprint(got["step"]) != "1" || got["$lib"] != "footprint-go" {
		t.Errorf("properties = %v", got)
	}
	// Properties may override $lib, as in the Node SDK.
	must(t, c.Capture(Event{DistinctID: "a", Event: "x", Properties: Properties{"$lib": "wrapper"}}))
	flush(t, c)
	if got := s.events()[1]["properties"].(map[string]any)["$lib"]; got != "wrapper" {
		t.Errorf("$lib = %v", got)
	}
}

func TestSendsOnceFlushAtEventsAreQueued(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{FlushAt: 2})
	must(t, c.Capture(Event{DistinctID: "a", Event: "one"}))
	time.Sleep(30 * time.Millisecond)
	if n := s.count(func(s *fakeServer) int { return len(s.batches) }); n != 0 {
		t.Fatalf("sent %d batches before FlushAt", n)
	}
	must(t, c.Capture(Event{DistinctID: "a", Event: "two"}))
	waitFor(t, "a batch", func() bool { return len(s.eventNames()) == 2 })
}

func TestSendsEveryFlushInterval(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{FlushInterval: 20 * time.Millisecond})
	must(t, c.Capture(Event{DistinctID: "a", Event: "tick"}))
	waitFor(t, "the interval flush", func() bool { return len(s.eventNames()) == 1 })
}

func TestSplitsBatchesAt1000Events(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{FlushAt: 5000})
	for i := range 2500 {
		must(t, c.Capture(Event{DistinctID: "a", Event: fmt.Sprint("e", i)}))
	}
	flush(t, c)
	var sizes []int
	for _, b := range s.batchList() {
		sizes = append(sizes, len(b.Batch))
	}
	if !reflect.DeepEqual(sizes, []int{1000, 1000, 500}) {
		t.Errorf("batch sizes = %v", sizes)
	}
	names := s.eventNames()
	if names[0] != "e0" || names[2499] != "e2499" {
		t.Errorf("events out of order: %s … %s", names[0], names[2499])
	}
}

func TestRetries503WithBackoff(t *testing.T) {
	s := newServer(t)
	s.eventStatus = []int{503, 503, 202}
	c, l := newClient(t, s, Config{})
	must(t, c.Capture(Event{DistinctID: "a", Event: "kept"}))
	flush(t, c)
	if s.attempts() != 3 {
		t.Errorf("made %d attempts, want 3", s.attempts())
	}
	if got := s.eventNames(); !reflect.DeepEqual(got, []string{"kept"}) {
		t.Errorf("sent %v", got)
	}
	if len(l.all()) != 0 {
		t.Errorf("logged %v", l.all())
	}
}

func TestHonorsRetryAfter(t *testing.T) {
	var mu sync.Mutex
	var times []time.Time
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		times = append(times, time.Now())
		if len(times) == 1 {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer srv.Close()
	c, err := New(Config{APIKey: "k", Host: srv.URL, RetryBackoff: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(context.Background())
	must(t, c.Capture(Event{DistinctID: "a", Event: "x"}))
	flush(t, c)
	if len(times) != 2 || times[1].Sub(times[0]) < 900*time.Millisecond {
		t.Errorf("retried after %v, want about 1s", times[len(times)-1].Sub(times[0]))
	}
}

func TestKeepsEventsQueuedWhenRetriesRunOut(t *testing.T) {
	s := newServer(t)
	s.eventStatus = []int{503}
	c, _ := newClient(t, s, Config{MaxRetries: 1})
	must(t, c.Capture(Event{DistinctID: "a", Event: "first"}))
	err := c.Flush(context.Background())
	if err == nil || !strings.Contains(err.Error(), "HTTP 503") {
		t.Fatalf("Flush = %v, want the 503", err)
	}
	if s.attempts() != 2 {
		t.Errorf("made %d attempts, want 2", s.attempts())
	}
	must(t, c.Capture(Event{DistinctID: "a", Event: "second"}))
	s.set(func(s *fakeServer) { s.eventStatus = nil })
	flush(t, c)
	if got := s.eventNames(); !reflect.DeepEqual(got, []string{"first", "second"}) {
		t.Errorf("sent %v", got)
	}
}

func TestRetriesNetworkErrors(t *testing.T) {
	s := newServer(t)
	var mu sync.Mutex
	failures := 1
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		fail := failures > 0
		failures--
		mu.Unlock()
		if fail {
			// Drop the connection without an answer.
			conn, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				conn.Close()
			}
			return
		}
		s.Config.Handler.ServeHTTP(w, r)
	}))
	defer proxy.Close()
	c, err := New(Config{APIKey: "fp_pub_test", Host: proxy.URL, RetryBackoff: time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(context.Background())
	must(t, c.Capture(Event{DistinctID: "a", Event: "x"}))
	flush(t, c)
	if got := s.eventNames(); !reflect.DeepEqual(got, []string{"x"}) {
		t.Errorf("sent %v", got)
	}
}

func TestDropsBatchesTheServerRejects(t *testing.T) {
	s := newServer(t)
	s.eventStatus = []int{400, 202}
	c, l := newClient(t, s, Config{})
	must(t, c.Capture(Event{DistinctID: "a", Event: "bad"}))
	flush(t, c)
	if s.attempts() != 1 {
		t.Errorf("a 400 was retried: %d attempts", s.attempts())
	}
	must(t, c.Capture(Event{DistinctID: "a", Event: "good"}))
	flush(t, c)
	if got := s.eventNames(); !reflect.DeepEqual(got, []string{"good"}) {
		t.Errorf("sent %v", got)
	}
	logged := l.all()
	if len(logged) != 1 || !strings.Contains(logged[0], "WARN") || !strings.Contains(logged[0], "status=400") {
		t.Errorf("logged %q", logged)
	}
}

func TestCapsTheQueueDroppingTheOldest(t *testing.T) {
	s := newServer(t)
	c, l := newClient(t, s, Config{MaxQueueSize: 2, FlushAt: 100})
	for _, e := range []string{"1", "2", "3"} {
		must(t, c.Capture(Event{DistinctID: "a", Event: e}))
	}
	flush(t, c)
	if got := s.eventNames(); !reflect.DeepEqual(got, []string{"2", "3"}) {
		t.Errorf("sent %v", got)
	}
	if logged := l.all(); len(logged) != 1 || !strings.Contains(logged[0], "dropped=1") {
		t.Errorf("logged %q", logged)
	}
}

func TestFlushStopsWhenTheContextEnds(t *testing.T) {
	s := newServer(t)
	s.eventStatus = []int{503}
	c, _ := newClient(t, s, Config{MaxRetries: 100, RetryBackoff: time.Hour})
	must(t, c.Capture(Event{DistinctID: "a", Event: "x"}))
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := c.Flush(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("Flush = %v, want the deadline", err)
	}
	s.set(func(s *fakeServer) { s.eventStatus = nil })
	flush(t, c)
	if got := s.eventNames(); !reflect.DeepEqual(got, []string{"x"}) {
		t.Errorf("sent %v", got)
	}
}

func TestCloseSendsWhatIsLeftAndNothingAfter(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	must(t, c.Capture(Event{DistinctID: "a", Event: "last"}))
	must(t, c.Close(context.Background()))
	if err := c.Capture(Event{DistinctID: "a", Event: "too late"}); !errors.Is(err, ErrClosed) {
		t.Errorf("Capture after Close = %v", err)
	}
	must(t, c.Close(context.Background()))
	if got := s.eventNames(); !reflect.DeepEqual(got, []string{"last"}) {
		t.Errorf("sent %v", got)
	}
}

func TestSendsUncompressedWithDisableGzip(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{DisableGzip: true})
	must(t, c.Capture(Event{DistinctID: "a", Event: "x"}))
	flush(t, c)
	if s.encodingList()[0] != "" || len(s.events()) != 1 {
		t.Errorf("encoding %q, %d events", s.encodingList()[0], len(s.events()))
	}
}

func TestConcurrentUse(t *testing.T) {
	s := newServer(t)
	s.definitions = []any{map[string]any{"key": "a", "active": true, "conditions": []any{map[string]any{"filters": []any{}, "rollout": 50}}}}
	c, _ := newClient(t, s, Config{FlushAt: 7, SecretKey: "fp_sec_test"})
	var wg sync.WaitGroup
	for g := range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range 100 {
				id := fmt.Sprint("user", g, "-", i%10)
				if err := c.Capture(Event{DistinctID: id, Event: "x"}); err != nil {
					t.Error(err)
				}
				if _, err := c.IsFeatureEnabled(context.Background(), "a", FlagRequest{DistinctID: id}); err != nil {
					t.Error(err)
				}
				if i%25 == 0 {
					_ = c.Flush(context.Background())
				}
			}
		}()
	}
	wg.Wait()
	must(t, c.Close(context.Background()))
	// 800 captures plus one exposure per person and value.
	if got := len(s.events()); got != 800+80 {
		t.Errorf("sent %d events, want 880", got)
	}
}

func TestDistinctIDFromCookie(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	for header, want := range map[string]string{
		`other=1; fp_fp_pub_test=%7B%22id%22%3A%22anon-1%22%7D`: "anon-1",
		`fp_fp_pub_test={"id":"plain"}`:                         "plain",
		`fp_fp_pub_test=%7Bbroken`:                              "",
		`fp_fp_pub_test=%7B%22id%22%3A5%7D`:                     "",
		`fp_other=%7B%22id%22%3A%22x%22%7D`:                     "",
		``:                                                      "",
	} {
		if got := c.DistinctIDFromCookie(header); got != want {
			t.Errorf("DistinctIDFromCookie(%q) = %q, want %q", header, got, want)
		}
	}
}

func TestUUIDv7IsOrdered(t *testing.T) {
	now := time.Now()
	prev := ""
	for range 5000 {
		id := newUUIDv7(now)
		if id <= prev {
			t.Fatalf("%s does not sort after %s", id, prev)
		}
		prev = id
	}
	uuidState.Lock()
	ms := fmt.Sprintf("%012x", uuidState.lastMs)
	uuidState.Unlock()
	if !regexp.MustCompile(`^` + ms[:8] + `-` + ms[8:] + `-7[0-9a-f]{3}-[89ab]`).MatchString(prev) {
		t.Errorf("%s doesn't hold the timestamp %s, version 7 and variant 10", prev, ms)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
