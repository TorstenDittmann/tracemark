package tracemark

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"runtime"
	"strings"
	"testing"
)

type exceptionEvent struct {
	DistinctID string `json:"distinct_id"`
	Event      string `json:"event"`
	Properties struct {
		Route         string           `json:"route"`
		Release       string           `json:"$release"`
		Level         string           `json:"$exception_level"`
		ExceptionList []exceptionEntry `json:"$exception_list"`
	} `json:"properties"`
}

func exceptionEvents(t *testing.T, s *fakeServer) []exceptionEvent {
	t.Helper()
	var out []exceptionEvent
	for _, e := range s.events() {
		var ev exceptionEvent
		if err := jsonRoundTrip(e, &ev); err != nil {
			t.Fatal(err)
		}
		out = append(out, ev)
	}
	return out
}

func TestCaptureExceptionSendsTheChainAndTheStack(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{Release: "2.0.0"})
	_, statErr := os.Stat("/definitely/not/here")
	err := fmt.Errorf("loading config: %w", statErr)
	must(t, c.CaptureException("ada", err, Properties{"route": "/checkout"}))
	must(t, c.CaptureException("", errors.New("plain"), nil))
	if c.CaptureException("ada", nil, nil) == nil {
		t.Error("CaptureException accepted a nil error")
	}
	flush(t, c)

	events := exceptionEvents(t, s)
	if len(events) != 2 {
		t.Fatalf("got %d events", len(events))
	}
	first := events[0]
	if first.Event != "$exception" || first.DistinctID != "ada" || first.Properties.Route != "/checkout" ||
		first.Properties.Release != "2.0.0" || first.Properties.Level != "error" {
		t.Errorf("event = %+v", first)
	}
	list := first.Properties.ExceptionList
	if len(list) != 3 {
		t.Fatalf("$exception_list has %d entries, want 3: %+v", len(list), list)
	}
	wantTypes := []string{"fmt.wrapError", "fs.PathError", "syscall.Errno"}
	for i, e := range list {
		if e.Type != wantTypes[i] {
			t.Errorf("entry %d type = %q, want %q", i, e.Type, wantTypes[i])
		}
		if e.Mechanism != (exceptionMechanism{Type: "manual", Handled: true}) {
			t.Errorf("entry %d mechanism = %+v", i, e.Mechanism)
		}
		if i > 0 && e.Stacktrace != nil {
			t.Errorf("entry %d has a stack; only the first should", i)
		}
	}
	if list[0].Value != err.Error() || list[2].Value != "no such file or directory" {
		t.Errorf("values = %q, %q", list[0].Value, list[2].Value)
	}
	frames := list[0].Stacktrace.Frames
	if len(frames) == 0 {
		t.Fatal("no frames")
	}
	top := frames[0]
	if !strings.HasSuffix(top.Function, ".TestCaptureExceptionSendsTheChainAndTheStack") ||
		!strings.HasSuffix(top.Filename, "exception_test.go") || top.Lineno == 0 || !top.InApp {
		t.Errorf("top frame = %+v", top)
	}
	last := frames[len(frames)-1]
	if !strings.HasPrefix(last.Function, "testing.") || last.InApp {
		t.Errorf("the testing package's frame should not be in-app: %+v", last)
	}

	if events[1].DistinctID != "$server" || events[1].Properties.ExceptionList[0].Type != "errors.errorString" {
		t.Errorf("second event = %+v", events[1])
	}
}

func TestCaptureExceptionWithOptions(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	long := errors.New(strings.Repeat("é", 3000))
	must(t, c.CaptureExceptionWith(errors.Join(long, errors.New("second")), ExceptionOptions{
		DistinctID: "ada",
		Groups:     map[string]string{"company": "acme"},
		Mechanism:  "http",
		Unhandled:  true,
	}))
	// A chain longer than the limit keeps the error and four causes.
	var chain error = errors.New("root")
	for i := range 10 {
		chain = fmt.Errorf("level %d: %w", i, chain)
	}
	must(t, c.CaptureException("ada", chain, nil))
	flush(t, c)
	events := exceptionEvents(t, s)
	list := events[0].Properties.ExceptionList
	if events[0].Properties.Level != "fatal" || list[0].Mechanism != (exceptionMechanism{"http", false}) {
		t.Errorf("event = %+v", events[0])
	}
	if len(list) != 2 || list[1].Type != "errors.errorString" || len([]rune(list[1].Value)) != 2000 {
		t.Errorf("joined errors: %d entries, %q", len(list), list[len(list)-1].Type)
	}
	if mustJSON(t, s.events()[0]["groups"]) != `{"company":"acme"}` {
		t.Errorf("groups = %v", s.events()[0]["groups"])
	}
	if n := len(events[1].Properties.ExceptionList); n != 1+maxCauses {
		t.Errorf("long chain kept %d entries, want %d", n, 1+maxCauses)
	}
}

func panics() {
	var m map[string]int
	m["boom"]++ // assignment to entry in nil map
}

func TestCapturePanicSendsAFatalExceptionAndPanicsAgain(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	recovered := func() (r any) {
		defer func() { r = recover() }()
		defer c.CapturePanic("ada")
		panics()
		return nil
	}()
	if recovered == nil {
		t.Fatal("CapturePanic swallowed the panic")
	}
	func() {
		defer func() { _ = recover() }()
		defer c.CapturePanic("")
		panic("plain value")
	}()
	func() {
		defer c.CapturePanic("") // no panic: does nothing
	}()

	// CapturePanic flushed already.
	events := exceptionEvents(t, s)
	if len(events) != 2 {
		t.Fatalf("got %d events", len(events))
	}
	e := events[0]
	entry := e.Properties.ExceptionList[0]
	if e.DistinctID != "ada" || e.Properties.Level != "fatal" ||
		entry.Mechanism != (exceptionMechanism{"panic", false}) || !strings.Contains(entry.Value, "nil map") {
		t.Errorf("event = %+v", e)
	}
	if top := entry.Stacktrace.Frames[0]; !strings.HasSuffix(top.Function, ".panics") || !top.InApp {
		t.Errorf("top frame = %+v, want the function that panicked", top)
	}
	if plain := events[1].Properties.ExceptionList[0]; plain.Type != "panic" || plain.Value != "plain value" {
		t.Errorf("plain panic = %+v", plain)
	}
}

func TestInAppLeavesOutTheStandardLibraryAndDependencies(t *testing.T) {
	frames := func() []stackFrame {
		var out []stackFrame
		_ = fs.WalkDir(os.DirFS("."), ".", func(string, fs.DirEntry, error) error {
			out = stackFrames()
			return fs.SkipAll
		})
		return out
	}()
	var sawStd bool
	for _, f := range frames {
		if strings.HasPrefix(f.Function, "io/fs.") {
			sawStd = true
			if f.InApp {
				t.Errorf("%s is in-app", f.Function)
			}
		}
	}
	if !sawStd {
		t.Errorf("no io/fs frame in %+v", frames)
	}
	for file, want := range map[string]bool{
		"/home/me/go/pkg/mod/github.com/lib/pq@v1.10.9/conn.go": false,
		"/srv/app/vendor/github.com/lib/pq/conn.go":             false,
		"github.com/lib/pq@v1.10.9/conn.go":                     false,
		"/srv/app/internal/billing/invoice.go":                  true,
	} {
		if got := inApp(runtime.Frame{File: file, Function: "github.com/me/app.F"}); got != want {
			t.Errorf("inApp(%s) = %v", file, got)
		}
	}
}
