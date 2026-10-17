package tracemark

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// FlagValue is a flag's value for a person: false when off, true when a boolean flag is on, or
// the variant key (a string) when a multivariate flag is on.
type FlagValue = any

// FlagRequest says who a flag is evaluated for.
type FlagRequest struct {
	DistinctID string
	// PersonProperties are the person's properties. Local evaluation only knows these; the server
	// also uses the properties it has stored.
	PersonProperties Properties
	// Groups maps group type to key, such as {"company": "acme"}.
	Groups map[string]string
	// GroupProperties maps group type to that group's properties.
	GroupProperties map[string]Properties
	// OnlyLocal never asks the server: flags that can't be decided locally come back off.
	OnlyLocal bool
	// DisableExposure skips the $feature_flag_called event.
	DisableExposure bool
}

// Flags are every flag's value and payload for one person.
type Flags struct {
	Flags    map[string]FlagValue
	Payloads map[string]any
}

// ReloadFlags fetches flag definitions for local evaluation now. It needs SecretKey. When it
// fails the last definitions are kept.
func (c *Client) ReloadFlags(ctx context.Context) error {
	if c.cfg.SecretKey == "" {
		return nil
	}
	res, err := c.do(ctx, http.MethodGet, "/flags/definitions",
		http.Header{"Authorization": {"Bearer " + c.cfg.SecretKey}}, nil)
	if err != nil {
		return fmt.Errorf("tracemark: loading flag definitions: %w", err)
	}
	if res.status < 200 || res.status >= 300 {
		return fmt.Errorf("tracemark: loading flag definitions failed with HTTP %d", res.status)
	}
	var body struct {
		Flags []any `json:"flags"`
	}
	if err := json.Unmarshal(res.body, &body); err != nil {
		return fmt.Errorf("tracemark: loading flag definitions: %w", err)
	}
	defs := make([]flagDefinition, 0, len(body.Flags))
	for _, raw := range body.Flags {
		def, err := parseFlag(raw)
		if err != nil {
			c.logger.Warn("tracemark: skipped an invalid flag definition", "error", err)
			continue
		}
		defs = append(defs, def)
	}
	c.defsMu.Lock()
	c.defs = defs
	c.defsMu.Unlock()
	return nil
}

func (c *Client) definitions() []flagDefinition {
	c.defsMu.RLock()
	defer c.defsMu.RUnlock()
	return c.defs
}

func (c *Client) pollLoop() {
	defer c.workers.Done()
	reload := func() {
		if err := c.ReloadFlags(c.bg); err != nil && c.bg.Err() == nil {
			c.logger.Warn("tracemark: refreshing flag definitions failed; keeping the last ones", "error", err)
		}
	}
	reload()
	c.defsOnce.Do(func() { close(c.defsReady) })
	ticker := time.NewTicker(c.cfg.FlagsPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-ticker.C:
			reload()
		}
	}
}

type remoteFlags struct {
	Flags    map[string]any `json:"flags"`
	Payloads map[string]any `json:"payloads"`
}

func (c *Client) remote(ctx context.Context, req FlagRequest) (*remoteFlags, error) {
	body, err := json.Marshal(struct {
		APIKey           string                `json:"api_key"`
		DistinctID       string                `json:"distinct_id"`
		PersonProperties Properties            `json:"person_properties,omitempty"`
		Groups           map[string]string     `json:"groups,omitempty"`
		GroupProperties  map[string]Properties `json:"group_properties,omitempty"`
	}{c.cfg.APIKey, req.DistinctID, req.PersonProperties, req.Groups, req.GroupProperties})
	if err != nil {
		return nil, fmt.Errorf("tracemark: encoding flag request: %w", err)
	}
	res, err := c.do(ctx, http.MethodPost, "/flags", http.Header{"Content-Type": {"application/json"}}, body)
	if err != nil {
		return nil, fmt.Errorf("tracemark: evaluating flags: %w", err)
	}
	if res.status < 200 || res.status >= 300 {
		return nil, fmt.Errorf("tracemark: evaluating flags failed with HTTP %d", res.status)
	}
	var out remoteFlags
	if err := json.Unmarshal(res.body, &out); err != nil {
		return nil, fmt.Errorf("tracemark: evaluating flags: %w", err)
	}
	return &out, nil
}

// flagValueOf keeps the values a flag can have and reports whether v is one.
func flagValueOf(v any) (FlagValue, bool) {
	switch v.(type) {
	case bool, string:
		return v, true
	}
	return nil, false
}

// decide evaluates every flag, or only the one named by only, locally where it can and in one
// server request otherwise. The flags it could decide are returned even with an error.
func (c *Client) decide(ctx context.Context, req FlagRequest, only *string) (Flags, error) {
	out := Flags{Flags: map[string]FlagValue{}, Payloads: map[string]any{}}
	if req.DistinctID == "" {
		return out, errors.New("tracemark: FlagRequest needs a DistinctID")
	}
	select {
	case <-c.defsReady:
	case <-ctx.Done():
		return out, ctx.Err()
	}
	defs := c.definitions()
	needServer := defs == nil
	if defs != nil {
		fctx := &flagContext{
			DistinctID:       req.DistinctID,
			PersonProperties: req.PersonProperties,
			Groups:           req.Groups,
			GroupProperties:  req.GroupProperties,
		}
		for i := range defs {
			flag := &defs[i]
			if only != nil && flag.Key != *only {
				continue
			}
			result, err := evaluate(flag, fctx, true)
			if err != nil {
				needServer = true
				continue
			}
			out.Flags[flag.Key] = result.Value
			if result.Payload != nil {
				out.Payloads[flag.Key] = result.Payload
			}
		}
	}
	if !needServer || req.OnlyLocal {
		return out, nil
	}
	remote, err := c.remote(ctx, req)
	if err != nil {
		return out, err
	}
	// Locally decided values agree with the server's; the server fills in the rest.
	for key, raw := range remote.Flags {
		if _, ok := out.Flags[key]; ok {
			continue
		}
		if value, ok := flagValueOf(raw); ok {
			out.Flags[key] = value
		}
	}
	for key, payload := range remote.Payloads {
		if _, ok := out.Payloads[key]; ok || payload == nil {
			continue
		}
		if local, ok := out.Flags[key]; ok && local == remote.Flags[key] {
			out.Payloads[key] = payload
		}
	}
	return out, nil
}

// GetAllFlagsAndPayloads returns every flag's value and payload for a person, deciding flags
// locally when possible and asking the server for the rest in one request. It never records an
// exposure. On error, the flags decided before it are returned too.
func (c *Client) GetAllFlagsAndPayloads(ctx context.Context, req FlagRequest) (Flags, error) {
	return c.decide(ctx, req, nil)
}

// GetAllFlags returns every flag's value for a person, without recording exposures.
func (c *Client) GetAllFlags(ctx context.Context, req FlagRequest) (map[string]FlagValue, error) {
	all, err := c.decide(ctx, req, nil)
	return all.Flags, err
}

// GetFeatureFlag returns a flag's value for a person: false when off, true or the variant key
// when on. The first time a person gets each value it captures $feature_flag_called, unless
// req.DisableExposure is set. On error the value is false and no exposure is captured.
func (c *Client) GetFeatureFlag(ctx context.Context, key string, req FlagRequest) (FlagValue, error) {
	value, _, err := c.flag(ctx, key, req)
	return value, err
}

// IsFeatureEnabled reports whether a flag is on for a person. See GetFeatureFlag.
func (c *Client) IsFeatureEnabled(ctx context.Context, key string, req FlagRequest) (bool, error) {
	value, _, err := c.flag(ctx, key, req)
	return value != false, err
}

// GetFeatureFlagPayload returns the JSON payload (decoded with encoding/json) served with a flag's
// current value for a person, or nil when the flag is off or has none. See GetFeatureFlag.
func (c *Client) GetFeatureFlagPayload(ctx context.Context, key string, req FlagRequest) (any, error) {
	_, payload, err := c.flag(ctx, key, req)
	return payload, err
}

func (c *Client) flag(ctx context.Context, key string, req FlagRequest) (FlagValue, any, error) {
	all, err := c.decide(ctx, req, &key)
	if err != nil {
		return false, nil, err
	}
	value, ok := all.Flags[key]
	if !ok {
		value = false
	}
	if !req.DisableExposure {
		c.expose(key, value, req)
	}
	if value == false {
		return false, nil, nil
	}
	return value, all.Payloads[key], nil
}

// expose captures $feature_flag_called the first time a person gets a flag's value.
func (c *Client) expose(key string, value FlagValue, req FlagRequest) {
	seen := req.DistinctID + "\x00" + key + "\x00" + fmt.Sprint(value)
	c.exposedMu.Lock()
	if _, ok := c.exposed[seen]; ok {
		c.exposedMu.Unlock()
		return
	}
	if len(c.exposed) >= maxExposures {
		clear(c.exposed)
	}
	c.exposed[seen] = struct{}{}
	c.exposedMu.Unlock()
	err := c.Capture(Event{
		DistinctID: req.DistinctID,
		Event:      "$feature_flag_called",
		Properties: Properties{"$feature_flag": key, "$feature_flag_response": value},
		Groups:     req.Groups,
	})
	if err != nil && !errors.Is(err, ErrClosed) {
		c.logger.Warn("tracemark: capturing a flag exposure failed", "error", err)
	}
}
