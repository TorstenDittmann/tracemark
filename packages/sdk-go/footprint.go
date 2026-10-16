// Package footprint is the Go server SDK for footprint, self-hosted product analytics.
//
// A Client queues events and sends them to POST /e in gzipped batches from a background
// goroutine, and evaluates feature flags, in-process when it has the project's secret key.
// Create one Client per process and call Close before the process exits.
package footprint

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Version is the SDK version, sent with every event as $lib_version.
const Version = "0.1.0"

// Lib is sent with every event as $lib.
const Lib = "footprint-go"

const (
	maxBatch     = 1000
	maxExposures = 50_000
)

// Properties are event, person or group properties. Values must encode to JSON.
type Properties = map[string]any

// ErrClosed is returned by Capture and friends after Close.
var ErrClosed = errors.New("footprint: client is closed")

// Config configures a Client. APIKey and Host are required; everything else has a default.
type Config struct {
	// APIKey is the public project key (fp_pub_…), used to send events and to ask the server for
	// flags.
	APIKey string
	// Host is the base URL of your footprint instance. Events go to Host+"/e", flags to
	// Host+"/flags".
	Host string
	// SecretKey is the secret project key (fp_sec_…). With it, flag definitions are fetched every
	// FlagsPollInterval and flags are evaluated in-process, without a request per check.
	SecretKey string

	// FlushAt sends once this many events are queued. Default 20.
	FlushAt int
	// FlushInterval sends queued events at least this often. Default 10s.
	FlushInterval time.Duration
	// FlagsPollInterval is how often flag definitions are refreshed. Default 30s.
	FlagsPollInterval time.Duration
	// MaxQueueSize is the most events kept while the server can't be reached; the oldest are
	// dropped. Default 10000.
	MaxQueueSize int
	// RequestTimeout bounds each HTTP request. Default 10s.
	RequestTimeout time.Duration
	// MaxRetries is how often a batch is retried within one flush after a network error, a 5xx
	// or a 429, with exponential backoff. Default 3; a negative value disables retries. A batch
	// that still fails stays queued for the next flush.
	MaxRetries int
	// RetryBackoff is the first retry's delay; each further retry waits twice as long, up to
	// 30s. A Retry-After header is honored up to the same cap. Default 500ms.
	RetryBackoff time.Duration
	// DisableGzip sends event batches uncompressed.
	DisableGzip bool

	// HTTPClient sends the requests. Default: a new http.Client.
	HTTPClient *http.Client
	// Logger receives warnings that would otherwise be swallowed, such as a rejected batch or a
	// failed refresh of flag definitions. Default slog.Default().
	Logger *slog.Logger
	// Release is your app's version, sent as $release with exceptions.
	Release string
}

// Client sends events and evaluates feature flags. It is safe for concurrent use.
type Client struct {
	cfg    Config
	http   *http.Client
	logger *slog.Logger

	mu      sync.Mutex
	queue   []json.RawMessage
	dropped int
	closed  bool

	sending chan struct{} // a one-slot semaphore: one drain at a time
	wake    chan struct{}
	stop    chan struct{}
	bg      context.Context
	cancel  context.CancelFunc
	workers sync.WaitGroup
	once    sync.Once

	defsMu    sync.RWMutex
	defs      []flagDefinition // nil until the first successful load
	defsReady chan struct{}    // closed once the first load finished, either way
	defsOnce  sync.Once

	exposedMu sync.Mutex
	exposed   map[string]struct{}
}

// New creates a Client and starts its background goroutines.
func New(cfg Config) (*Client, error) {
	if cfg.APIKey == "" || cfg.Host == "" {
		return nil, errors.New("footprint: Config needs APIKey and Host")
	}
	if _, err := url.Parse(cfg.Host); err != nil {
		return nil, fmt.Errorf("footprint: invalid Host: %w", err)
	}
	cfg.Host = strings.TrimRight(cfg.Host, "/")
	if cfg.FlushAt <= 0 {
		cfg.FlushAt = 20
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = 10 * time.Second
	}
	if cfg.FlagsPollInterval <= 0 {
		cfg.FlagsPollInterval = 30 * time.Second
	}
	if cfg.MaxQueueSize <= 0 {
		cfg.MaxQueueSize = 10_000
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = 10 * time.Second
	}
	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 3
	} else if cfg.MaxRetries < 0 {
		cfg.MaxRetries = 0
	}
	if cfg.RetryBackoff <= 0 {
		cfg.RetryBackoff = 500 * time.Millisecond
	}
	c := &Client{
		cfg:       cfg,
		http:      cfg.HTTPClient,
		logger:    cfg.Logger,
		sending:   make(chan struct{}, 1),
		wake:      make(chan struct{}, 1),
		stop:      make(chan struct{}),
		defsReady: make(chan struct{}),
		exposed:   map[string]struct{}{},
	}
	if c.http == nil {
		c.http = &http.Client{}
	}
	if c.logger == nil {
		c.logger = slog.Default()
	}
	c.bg, c.cancel = context.WithCancel(context.Background())
	c.workers.Add(1)
	go c.flushLoop()
	if cfg.SecretKey != "" {
		c.workers.Add(1)
		go c.pollLoop()
	} else {
		close(c.defsReady)
	}
	return c, nil
}

// Event is one event to capture.
type Event struct {
	DistinctID string
	Event      string
	Properties Properties
	// Groups maps group type to key, such as {"company": "acme"}. At most 5.
	Groups map[string]string
	// Set and SetOnce update the person's properties with this event.
	Set     Properties
	SetOnce Properties
	// Timestamp defaults to now.
	Timestamp time.Time
	// UUID is the dedup id; a UUIDv7 is generated when empty.
	UUID string
}

type wirePerson struct {
	Set     Properties `json:"set,omitempty"`
	SetOnce Properties `json:"set_once,omitempty"`
}

type wireEvent struct {
	UUID       string            `json:"uuid"`
	Event      string            `json:"event"`
	DistinctID string            `json:"distinct_id"`
	Timestamp  string            `json:"timestamp"`
	Properties Properties        `json:"properties"`
	Person     *wirePerson       `json:"person,omitempty"`
	Groups     map[string]string `json:"groups,omitempty"`
}

func validName(what, s string) error {
	if n := utf8.RuneCountInString(s); n == 0 || n > 200 {
		return fmt.Errorf("footprint: %s must be 1 to 200 characters, got %q", what, s)
	}
	return nil
}

// Capture queues an event. Events are sent in batches from a background goroutine; Flush sends
// what is queued now. It returns an error, and queues nothing, when the event would make ingest
// reject its whole batch, when a property can't be encoded as JSON, or after Close.
func (c *Client) Capture(e Event) error {
	if err := validName("distinct id", e.DistinctID); err != nil {
		return err
	}
	if err := validName("event name", e.Event); err != nil {
		return err
	}
	if len(e.Groups) > 5 {
		return fmt.Errorf("footprint: at most 5 groups per event, got %d", len(e.Groups))
	}
	for t, k := range e.Groups {
		if utf8.RuneCountInString(t) > 200 || utf8.RuneCountInString(k) > 200 {
			return fmt.Errorf("footprint: group type and key must be at most 200 characters")
		}
	}
	ts := e.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}
	ts = ts.UTC()
	if ts.Year() < 1900 || ts.Year() > 2299 {
		return fmt.Errorf("footprint: timestamp %s is out of range", ts)
	}
	if e.UUID == "" {
		e.UUID = newUUIDv7(ts)
	}
	props := make(Properties, len(e.Properties)+2)
	props["$lib"] = Lib
	props["$lib_version"] = Version
	for k, v := range e.Properties {
		props[k] = v
	}
	wire := wireEvent{
		UUID:       e.UUID,
		Event:      e.Event,
		DistinctID: e.DistinctID,
		Timestamp:  ts.Format("2006-01-02T15:04:05.000Z"),
		Properties: props,
	}
	if e.Set != nil || e.SetOnce != nil {
		wire.Person = &wirePerson{Set: e.Set, SetOnce: e.SetOnce}
	}
	if len(e.Groups) > 0 {
		wire.Groups = e.Groups
	}
	// Encoding now freezes the event, so callers may reuse their maps right away.
	raw, err := json.Marshal(wire)
	if err != nil {
		return fmt.Errorf("footprint: encoding %s: %w", e.Event, err)
	}

	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return ErrClosed
	}
	c.queue = append(c.queue, raw)
	c.trimLocked()
	full := len(c.queue) >= c.cfg.FlushAt
	c.mu.Unlock()
	if full {
		select {
		case c.wake <- struct{}{}:
		default:
		}
	}
	return nil
}

// trimLocked drops the oldest events beyond MaxQueueSize.
func (c *Client) trimLocked() {
	if over := len(c.queue) - c.cfg.MaxQueueSize; over > 0 {
		c.queue = append(c.queue[:0:0], c.queue[over:]...)
		c.dropped += over
	}
}

// Identify sets person properties: Set overwrites, SetOnce only fills in keys never set.
func (c *Client) Identify(distinctID string, set, setOnce Properties) error {
	return c.Capture(Event{DistinctID: distinctID, Event: "$set", Set: set, SetOnce: setOnce})
}

// Alias merges an earlier id, such as an anonymous browser id, into distinctID's person.
func (c *Client) Alias(distinctID, alias string) error {
	return c.Capture(Event{
		DistinctID: distinctID,
		Event:      "$identify",
		Properties: Properties{"$anon_distinct_id": alias},
	})
}

// GroupIdentify sets a group's properties. The event is attributed to "$<type>_<key>".
func (c *Client) GroupIdentify(groupType, groupKey string, props Properties) error {
	return c.GroupIdentifyAs("$"+groupType+"_"+groupKey, groupType, groupKey, props)
}

// GroupIdentifyAs is GroupIdentify attributed to distinctID.
func (c *Client) GroupIdentifyAs(distinctID, groupType, groupKey string, props Properties) error {
	if props == nil {
		props = Properties{}
	}
	return c.Capture(Event{
		DistinctID: distinctID,
		Event:      "$groupidentify",
		Properties: Properties{"$group_type": groupType, "$group_key": groupKey, "$group_set": props},
		Groups:     map[string]string{groupType: groupKey},
	})
}

// Flush sends everything queued now and waits for it. Batches the server rejects (4xx) are
// dropped with a logged warning. When the server can't be reached after the retries, or ctx ends
// first, the remaining events stay queued and the error is returned.
func (c *Client) Flush(ctx context.Context) error {
	select {
	case c.sending <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	defer func() { <-c.sending }()
	return c.drain(ctx)
}

// Close stops the background goroutines and sends what is queued. Call it before the process
// exits. Capture returns ErrClosed afterwards; flags keep working, without refreshes.
func (c *Client) Close(ctx context.Context) error {
	c.once.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		close(c.stop)
		c.cancel()
	})
	done := make(chan struct{})
	go func() {
		c.workers.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		return ctx.Err()
	}
	return c.Flush(ctx)
}

func (c *Client) flushLoop() {
	defer c.workers.Done()
	ticker := time.NewTicker(c.cfg.FlushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-ticker.C:
		case <-c.wake:
		}
		if err := c.Flush(c.bg); err != nil && c.bg.Err() == nil {
			c.logger.Warn("footprint: sending events failed; they stay queued", "error", err)
		}
	}
}

// DistinctIDFromCookie returns the distinct id the browser SDK keeps in its cookie (with
// persistence "cookie"), read from a request's Cookie header, or "" when there is none.
func (c *Client) DistinctIDFromCookie(cookieHeader string) string {
	name := "fp_" + c.cfg.APIKey
	for _, part := range strings.Split(cookieHeader, ";") {
		k, v, ok := strings.Cut(part, "=")
		if !ok || strings.TrimSpace(k) != name {
			continue
		}
		decoded, err := url.PathUnescape(strings.TrimSpace(v))
		if err != nil {
			return ""
		}
		var state struct {
			ID any `json:"id"`
		}
		if json.Unmarshal([]byte(decoded), &state) != nil {
			return ""
		}
		id, _ := state.ID.(string)
		return id
	}
	return ""
}
