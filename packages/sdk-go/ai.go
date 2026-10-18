package tracemark

import (
	"errors"
	"math"
)

// AIScore is a score or piece of feedback on an AI trace, see docs/ai.md.
type AIScore struct {
	// DistinctID is who gave the score. Default "$server".
	DistinctID string
	// TraceID is the trace the score is for. Required.
	TraceID string
	// SpanID narrows the score to one step of the trace, such as a generation.
	SpanID string
	// Name is what is scored, such as "helpful", "thumbs" or "accuracy". Required.
	Name string
	// Value is the score; thumbs up and down are 1 and 0.
	Value      float64
	Comment    string
	Properties Properties
}

// CaptureAIScore records s as a $ai_score event.
func (c *Client) CaptureAIScore(s AIScore) error {
	if s.TraceID == "" || s.Name == "" {
		return errors.New("tracemark: an AI score needs a trace id and a name")
	}
	if math.IsNaN(s.Value) || math.IsInf(s.Value, 0) {
		return errors.New("tracemark: an AI score's value must be a finite number")
	}
	props := make(Properties, len(s.Properties)+5)
	for k, v := range s.Properties {
		props[k] = v
	}
	props["$ai_trace_id"] = s.TraceID
	props["$ai_score_name"] = s.Name
	props["$ai_score_value"] = s.Value
	if s.SpanID != "" {
		props["$ai_span_id"] = s.SpanID
	}
	if s.Comment != "" {
		props["$ai_score_comment"] = s.Comment
	}
	distinctID := s.DistinctID
	if distinctID == "" {
		distinctID = "$server"
	}
	return c.Capture(Event{DistinctID: distinctID, Event: "$ai_score", Properties: props})
}
