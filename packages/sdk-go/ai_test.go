package tracemark

import (
	"fmt"
	"math"
	"testing"
)

func TestCaptureAIScore(t *testing.T) {
	s := newServer(t)
	c, _ := newClient(t, s, Config{})
	must(t, c.CaptureAIScore(AIScore{DistinctID: "ada", TraceID: "t1", Name: "thumbs", Value: 1}))
	must(t, c.CaptureAIScore(AIScore{
		TraceID: "t1", SpanID: "g1", Name: "accuracy", Value: 0.5, Comment: "Half right",
	}))
	for _, bad := range []AIScore{
		{Name: "thumbs", Value: 1},
		{TraceID: "t1", Value: 1},
		{TraceID: "t1", Name: "thumbs", Value: math.NaN()},
	} {
		if c.CaptureAIScore(bad) == nil {
			t.Errorf("CaptureAIScore accepted %+v", bad)
		}
	}
	flush(t, c)

	events := s.events()
	if len(events) != 2 {
		t.Fatalf("got %d events", len(events))
	}
	thumbs, accuracy := events[0], events[1]
	props := thumbs["properties"].(map[string]any)
	if thumbs["event"] != "$ai_score" || thumbs["distinct_id"] != "ada" ||
		props["$ai_trace_id"] != "t1" || props["$ai_score_name"] != "thumbs" ||
		fmt.Sprint(props["$ai_score_value"]) != "1" {
		t.Errorf("thumbs = %+v", thumbs)
	}
	if _, ok := props["$ai_span_id"]; ok {
		t.Errorf("thumbs has a span id: %+v", props)
	}
	props = accuracy["properties"].(map[string]any)
	if accuracy["distinct_id"] != "$server" || props["$ai_span_id"] != "g1" ||
		fmt.Sprint(props["$ai_score_value"]) != "0.5" || props["$ai_score_comment"] != "Half right" {
		t.Errorf("accuracy = %+v", accuracy)
	}
}
