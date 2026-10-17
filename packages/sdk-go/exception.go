package tracemark

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"runtime"
	"strings"
)

const (
	maxFrames = 50
	// maxCauses is how many wrapped errors are kept after the first.
	maxCauses = 4
	maxValue  = 2000
)

// ExceptionOptions describe a captured error.
type ExceptionOptions struct {
	// DistinctID is who ran into it. Default "$server", so errors outside a request count as one
	// person.
	DistinctID string
	Properties Properties
	Groups     map[string]string
	// Mechanism is what caught it. Default "manual".
	Mechanism string
	// Unhandled marks errors nothing handled; they are sent with level "fatal".
	Unhandled bool
}

// stackFrame is one frame of $exception_list[].stacktrace.frames, innermost first.
type stackFrame struct {
	Filename string `json:"filename,omitempty"`
	Function string `json:"function,omitempty"`
	Lineno   int    `json:"lineno,omitempty"`
	// InApp is false for the standard library, the module cache and vendored code.
	InApp bool `json:"in_app"`
}

type exceptionMechanism struct {
	Type    string `json:"type"`
	Handled bool   `json:"handled"`
}

type exceptionStacktrace struct {
	Frames []stackFrame `json:"frames"`
}

// exceptionEntry is one entry of $exception_list: the error, then each error it wraps.
type exceptionEntry struct {
	Type       string               `json:"type"`
	Value      string               `json:"value"`
	Mechanism  exceptionMechanism   `json:"mechanism"`
	Stacktrace *exceptionStacktrace `json:"stacktrace,omitempty"`
}

// CaptureException captures err as an $exception event with the calling goroutine's stack. An
// empty distinctID attributes it to "$server".
func (c *Client) CaptureException(distinctID string, err error, props Properties) error {
	return c.exception(err, ExceptionOptions{DistinctID: distinctID, Properties: props}, stackFrames())
}

// CaptureExceptionWith is CaptureException with every option.
func (c *Client) CaptureExceptionWith(err error, opts ExceptionOptions) error {
	return c.exception(err, opts, stackFrames())
}

// CapturePanic captures a panic as a fatal $exception, sends what is queued (waiting at most
// RequestTimeout), then panics again with the same value. Defer it directly:
//
//	defer client.CapturePanic("user_123")
func (c *Client) CapturePanic(distinctID string) {
	r := recover()
	if r == nil {
		return
	}
	err, ok := r.(error)
	if !ok {
		err = panicValue{r}
	}
	_ = c.exception(err, ExceptionOptions{DistinctID: distinctID, Mechanism: "panic", Unhandled: true}, stackFrames())
	ctx, cancel := context.WithTimeout(context.Background(), c.cfg.RequestTimeout)
	_ = c.Flush(ctx)
	cancel()
	panic(r)
}

// panicValue is a recovered value that isn't an error.
type panicValue struct{ value any }

func (p panicValue) Error() string { return fmt.Sprint(p.value) }

func (c *Client) exception(err error, opts ExceptionOptions, frames []stackFrame) error {
	if err == nil {
		return errors.New("tracemark: CaptureException needs an error")
	}
	if opts.DistinctID == "" {
		opts.DistinctID = "$server"
	}
	if opts.Mechanism == "" {
		opts.Mechanism = "manual"
	}
	props := make(Properties, len(opts.Properties)+3)
	for k, v := range opts.Properties {
		props[k] = v
	}
	props["$exception_list"] = exceptionList(err, opts.Mechanism, !opts.Unhandled, frames)
	props["$exception_level"] = "error"
	if opts.Unhandled {
		props["$exception_level"] = "fatal"
	}
	if c.cfg.Release != "" {
		props["$release"] = c.cfg.Release
	}
	return c.Capture(Event{
		DistinctID: opts.DistinctID,
		Event:      "$exception",
		Properties: props,
		Groups:     opts.Groups,
	})
}

// errorType names an error's type, such as "fs.PathError".
func errorType(err error) string {
	if _, ok := err.(panicValue); ok {
		return "panic"
	}
	return strings.TrimLeft(reflect.TypeOf(err).String(), "*")
}

func unwrap(err error) error {
	switch e := err.(type) {
	case interface{ Unwrap() error }:
		return e.Unwrap()
	case interface{ Unwrap() []error }:
		if errs := e.Unwrap(); len(errs) > 0 {
			return errs[0]
		}
	}
	return nil
}

func truncate(s string, n int) string {
	for i := range s {
		if n == 0 {
			return s[:i]
		}
		n--
	}
	return s
}

// exceptionList is the $exception_list for err: err itself, then what it wraps. Only the first
// entry gets the stack, which is where it was captured.
func exceptionList(err error, mechanism string, handled bool, frames []stackFrame) []exceptionEntry {
	m := exceptionMechanism{Type: mechanism, Handled: handled}
	var list []exceptionEntry
	for current := err; current != nil && len(list) <= maxCauses; current = unwrap(current) {
		entry := exceptionEntry{Type: errorType(current), Value: truncate(current.Error(), maxValue), Mechanism: m}
		if len(list) == 0 && len(frames) > 0 {
			entry.Stacktrace = &exceptionStacktrace{Frames: frames}
		}
		list = append(list, entry)
	}
	return list
}

var (
	// moduleVersion finds module paths with -trimpath, such as example.com/lib@v1.2.3/file.go.
	moduleVersion = regexp.MustCompile(`@v\d`)
	sdkPackage    = reflect.TypeOf(Client{}).PkgPath()
	gorootSrc     = func() string {
		// Where the standard library's files live, found from one of its functions. Empty when
		// the binary was built with -trimpath.
		file, _ := runtime.FuncForPC(reflect.ValueOf(fmt.Sprint).Pointer()).FileLine(reflect.ValueOf(fmt.Sprint).Pointer())
		if i := strings.LastIndex(file, "/fmt/"); i > 0 && strings.HasPrefix(file, "/") {
			return file[:i+1]
		}
		return ""
	}()
)

// inApp reports whether a frame is the app's own code rather than the standard library or a
// dependency.
func inApp(frame runtime.Frame) bool {
	file := frame.File
	if strings.Contains(file, "/pkg/mod/") || strings.Contains(file, "/vendor/") || moduleVersion.MatchString(file) {
		return false
	}
	if gorootSrc != "" {
		return !strings.HasPrefix(file, gorootSrc)
	}
	// Built with -trimpath: standard library packages have no dot in their first path element.
	pkg := frame.Function
	if i := strings.Index(pkg, "/"); i >= 0 {
		pkg = pkg[:i]
	} else if i := strings.Index(pkg, "."); i >= 0 {
		pkg = pkg[:i]
	}
	return pkg == "main" || strings.Contains(pkg, ".")
}

// stackFrames is the calling goroutine's stack, innermost first, starting at the code that called
// into the SDK (or, for a panic, the code that panicked).
func stackFrames() []stackFrame {
	pcs := make([]uintptr, maxFrames+16)
	n := runtime.Callers(2, pcs)
	iter := runtime.CallersFrames(pcs[:n])
	var frames []stackFrame
	leading := true
	for {
		frame, more := iter.Next()
		sdk := strings.HasPrefix(frame.Function, sdkPackage+".(*Client).")
		if leading && (sdk || strings.HasPrefix(frame.Function, "runtime.")) {
			if !more {
				break
			}
			continue
		}
		leading = false
		if frame.Function == "runtime.goexit" || frame.Function == "runtime.main" {
			break
		}
		frames = append(frames, stackFrame{
			Filename: frame.File,
			Function: frame.Function,
			Lineno:   frame.Line,
			InApp:    inApp(frame),
		})
		if len(frames) == maxFrames || !more {
			break
		}
	}
	return frames
}
