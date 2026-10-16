package footprint

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"strconv"
	"time"
)

const maxBackoff = 30 * time.Second

// rejectedError is a batch the server refused for good (a 4xx other than 429).
type rejectedError struct {
	status int
	body   string
}

func (e *rejectedError) Error() string {
	return fmt.Sprintf("footprint: events rejected with HTTP %d: %s", e.status, e.body)
}

// take removes the next batch from the front of the queue.
func (c *Client) take() []json.RawMessage {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.dropped > 0 {
		c.logger.Warn("footprint: queue full, dropped the oldest events", "dropped", c.dropped)
		c.dropped = 0
	}
	n := min(len(c.queue), maxBatch)
	if n == 0 {
		return nil
	}
	batch := c.queue[:n:n]
	c.queue = c.queue[n:]
	return batch
}

// putBack returns a batch that couldn't be sent to the front of the queue.
func (c *Client) putBack(batch []json.RawMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queue = append(append(make([]json.RawMessage, 0, len(batch)+len(c.queue)), batch...), c.queue...)
	c.trimLocked()
}

func (c *Client) drain(ctx context.Context) error {
	for {
		batch := c.take()
		if batch == nil {
			return nil
		}
		err := c.sendBatch(ctx, batch)
		var rejected *rejectedError
		switch {
		case err == nil:
		case errors.As(err, &rejected):
			// Sending it again would get the same answer.
			c.logger.Warn("footprint: dropped a batch the server rejected",
				"status", rejected.status, "events", len(batch), "body", rejected.body)
		default:
			c.putBack(batch)
			return err
		}
	}
}

func (c *Client) encodeBatch(batch []json.RawMessage) ([]byte, error) {
	var buf bytes.Buffer
	key, _ := json.Marshal(c.cfg.APIKey)
	buf.WriteString(`{"api_key":`)
	buf.Write(key)
	buf.WriteString(`,"sent_at":"`)
	buf.WriteString(time.Now().UTC().Format("2006-01-02T15:04:05.000Z"))
	buf.WriteString(`","batch":[`)
	for i, e := range batch {
		if i > 0 {
			buf.WriteByte(',')
		}
		buf.Write(e)
	}
	buf.WriteString("]}")
	if c.cfg.DisableGzip {
		return buf.Bytes(), nil
	}
	var zipped bytes.Buffer
	zw := gzip.NewWriter(&zipped)
	if _, err := zw.Write(buf.Bytes()); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return zipped.Bytes(), nil
}

// sendBatch posts one batch, retrying network errors, 5xx and 429 with exponential backoff.
func (c *Client) sendBatch(ctx context.Context, batch []json.RawMessage) error {
	for attempt := 0; ; attempt++ {
		// sent_at is set per attempt so the server's clock skew correction stays right.
		body, err := c.encodeBatch(batch)
		if err != nil {
			return err
		}
		headers := http.Header{"Content-Type": {"application/json"}}
		if !c.cfg.DisableGzip {
			headers.Set("Content-Encoding", "gzip")
		}
		res, err := c.do(ctx, http.MethodPost, "/e", headers, body)
		var wait time.Duration
		switch {
		case err != nil:
			err = fmt.Errorf("footprint: sending events: %w", err)
		case res.status < 400:
			return nil
		case res.status >= 500 || res.status == http.StatusTooManyRequests:
			err = fmt.Errorf("footprint: sending events failed with HTTP %d: %s", res.status, res.body)
			wait = retryAfter(res.header)
		default:
			return &rejectedError{res.status, string(res.body)}
		}
		if attempt >= c.cfg.MaxRetries || ctx.Err() != nil {
			return err
		}
		if wait == 0 {
			backoff := c.cfg.RetryBackoff << attempt
			if backoff <= 0 || backoff > maxBackoff {
				backoff = maxBackoff
			}
			// Up to 25% jitter so many clients don't retry in step.
			wait = backoff - time.Duration(rand.Int64N(int64(backoff/4)+1))
		}
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-ctx.Done():
			timer.Stop()
			return errors.Join(err, ctx.Err())
		}
	}
}

func retryAfter(h http.Header) time.Duration {
	secs, err := strconv.Atoi(h.Get("Retry-After"))
	if err != nil || secs <= 0 {
		return 0
	}
	return min(time.Duration(secs)*time.Second, maxBackoff)
}

type response struct {
	status int
	header http.Header
	body   []byte
}

// do sends one request with the configured timeout and reads its body (up to 1 MB for errors,
// 16 MB in all).
func (c *Client) do(ctx context.Context, method, path string, headers http.Header, body []byte) (*response, error) {
	ctx, cancel := context.WithTimeout(ctx, c.cfg.RequestTimeout)
	defer cancel()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.cfg.Host+path, reader)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header[k] = v
	}
	req.Header.Set("User-Agent", Lib+"/"+Version)
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	limit := int64(16 << 20)
	if res.StatusCode >= 400 {
		limit = 1 << 20
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, limit))
	if err != nil {
		return nil, err
	}
	return &response{res.StatusCode, res.Header, data}, nil
}
