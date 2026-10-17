package tracemark

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type batchBody struct {
	APIKey string           `json:"api_key"`
	SentAt string           `json:"sent_at"`
	Batch  []map[string]any `json:"batch"`
}

// fakeServer is a tracemark instance that records what it was sent.
type fakeServer struct {
	*httptest.Server
	t *testing.T

	mu sync.Mutex
	// eventStatus answers POST /e: one status per request, the last one repeating. Default 202.
	eventStatus     []int
	eventAttempts   int
	batches         []batchBody
	encodings       []string
	definitions     []any // nil answers 401
	definitionsAuth []string
	flagRequests    []map[string]any
	flags           func(body map[string]any) any
	flagsStatus     int // answers POST /flags with this error status when set
}

func newServer(t *testing.T) *fakeServer {
	t.Helper()
	s := &fakeServer{t: t, definitions: []any{}}
	s.Server = httptest.NewServer(http.HandlerFunc(s.handle))
	t.Cleanup(s.Close)
	return s
}

func (s *fakeServer) handle(w http.ResponseWriter, r *http.Request) {
	reply := func(status int, body any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(body)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/e":
		var reader io.Reader = r.Body
		if r.Header.Get("Content-Encoding") == "gzip" {
			zr, err := gzip.NewReader(r.Body)
			if err != nil {
				s.t.Errorf("bad gzip: %v", err)
				reply(400, map[string]any{"error": "invalid_batch"})
				return
			}
			reader = zr
		}
		raw, _ := io.ReadAll(reader)
		status := 202
		if len(s.eventStatus) > 0 {
			i := min(s.eventAttempts, len(s.eventStatus)-1)
			status = s.eventStatus[i]
		}
		s.eventAttempts++
		if status == 202 {
			var body batchBody
			dec := json.NewDecoder(bytes.NewReader(raw))
			dec.UseNumber()
			if err := dec.Decode(&body); err != nil {
				s.t.Errorf("bad batch JSON: %v", err)
			}
			s.batches = append(s.batches, body)
			s.encodings = append(s.encodings, r.Header.Get("Content-Encoding"))
			reply(202, map[string]any{"accepted": len(body.Batch)})
			return
		}
		reply(status, map[string]any{"error": "status " + http.StatusText(status)})
	case r.Method == http.MethodGet && r.URL.Path == "/flags/definitions":
		s.definitionsAuth = append(s.definitionsAuth, r.Header.Get("Authorization"))
		if s.definitions == nil {
			reply(401, map[string]any{"error": "invalid_secret_key"})
			return
		}
		reply(200, map[string]any{"flags": s.definitions})
	case r.Method == http.MethodPost && r.URL.Path == "/flags":
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.flagRequests = append(s.flagRequests, body)
		if s.flagsStatus != 0 {
			reply(s.flagsStatus, map[string]any{"error": "failed"})
			return
		}
		if s.flags == nil {
			reply(200, map[string]any{"flags": map[string]any{}, "payloads": map[string]any{}})
			return
		}
		reply(200, s.flags(body))
	default:
		reply(404, map[string]any{})
	}
}

func (s *fakeServer) set(f func(s *fakeServer)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f(s)
}

// events are every event the server accepted, in order.
func (s *fakeServer) events() []map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []map[string]any
	for _, b := range s.batches {
		out = append(out, b.Batch...)
	}
	return out
}

func (s *fakeServer) eventNames() []string {
	var names []string
	for _, e := range s.events() {
		names = append(names, e["event"].(string))
	}
	return names
}

func (s *fakeServer) count(f func(s *fakeServer) int) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return f(s)
}

// logs collects what a client logs.
type logs struct {
	mu      sync.Mutex
	records []string
}

func (l *logs) Enabled(context.Context, slog.Level) bool { return true }
func (l *logs) Handle(_ context.Context, r slog.Record) error {
	var b strings.Builder
	b.WriteString(r.Level.String() + " " + r.Message)
	r.Attrs(func(a slog.Attr) bool {
		b.WriteString(" " + a.String())
		return true
	})
	l.mu.Lock()
	l.records = append(l.records, b.String())
	l.mu.Unlock()
	return nil
}
func (l *logs) WithAttrs([]slog.Attr) slog.Handler { return l }
func (l *logs) WithGroup(string) slog.Handler      { return l }

func (l *logs) all() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.records...)
}

// newClient makes a client for s that tests can't accidentally leave running.
func newClient(t *testing.T, s *fakeServer, cfg Config) (*Client, *logs) {
	t.Helper()
	l := &logs{}
	cfg.APIKey = "fp_pub_test"
	cfg.Host = s.URL + "/"
	if cfg.Logger == nil {
		cfg.Logger = slog.New(l)
	}
	if cfg.RetryBackoff == 0 {
		cfg.RetryBackoff = time.Millisecond
	}
	if cfg.FlushInterval == 0 {
		// Long enough that tests decide when events go out.
		cfg.FlushInterval = time.Hour
	}
	c, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close(context.Background()) })
	return c, l
}

func flush(t *testing.T, c *Client) {
	t.Helper()
	if err := c.Flush(context.Background()); err != nil {
		t.Fatalf("flush: %v", err)
	}
}

// waitFor polls cond for up to two seconds.
func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// asJSON round-trips v through JSON so it compares with decoded request bodies.
func asJSON(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var out any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func (s *fakeServer) attempts() int {
	return s.count(func(s *fakeServer) int { return s.eventAttempts })
}

func (s *fakeServer) batchList() []batchBody {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]batchBody(nil), s.batches...)
}

func (s *fakeServer) encodingList() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.encodings...)
}

func jsonRoundTrip(in, out any) error {
	raw, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, out)
}
