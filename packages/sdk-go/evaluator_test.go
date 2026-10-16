package footprint

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"
)

// The shared vectors every evaluator must pass, read from the monorepo.
const vectorsPath = "../flags/vectors.json"

type vectorCase struct {
	Context struct {
		DistinctID       string                    `json:"distinctId"`
		PersonProperties map[string]any            `json:"personProperties"`
		Groups           map[string]string         `json:"groups"`
		GroupProperties  map[string]map[string]any `json:"groupProperties"`
		Cohorts          []string                  `json:"cohorts"`
	} `json:"context"`
	Missing  string          `json:"missing"`
	Expected json.RawMessage `json:"expected"`
}

type vectorFile struct {
	Buckets []struct {
		Flag   string  `json:"flag"`
		ID     string  `json:"id"`
		Salt   string  `json:"salt"`
		Bucket float64 `json:"bucket"`
	} `json:"buckets"`
	Flags []struct {
		Name  string       `json:"name"`
		Flag  any          `json:"flag"`
		Cases []vectorCase `json:"cases"`
	} `json:"flags"`
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	raw, err := os.ReadFile(vectorsPath)
	if err != nil {
		t.Fatalf("the shared vectors must be readable at %s: %v", vectorsPath, err)
	}
	var v vectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if len(v.Buckets) == 0 || len(v.Flags) == 0 {
		t.Fatal("the vectors file is empty")
	}
	return v
}

func (c vectorCase) context() *flagContext {
	return &flagContext{
		DistinctID:       c.Context.DistinctID,
		PersonProperties: c.Context.PersonProperties,
		Groups:           c.Context.Groups,
		GroupProperties:  c.Context.GroupProperties,
		Cohorts:          c.Context.Cohorts,
	}
}

func TestVectorBuckets(t *testing.T) {
	for _, v := range loadVectors(t).Buckets {
		if got := bucket(v.Flag, v.ID, v.Salt); got != v.Bucket {
			t.Errorf("bucket(%q, %q, %q) = %v, want %v", v.Flag, v.ID, v.Salt, got, v.Bucket)
		}
	}
}

func TestVectorFlags(t *testing.T) {
	cases := 0
	for _, vf := range loadVectors(t).Flags {
		t.Run(vf.Name, func(t *testing.T) {
			flag, err := parseFlag(vf.Flag)
			if err != nil {
				t.Fatalf("parseFlag: %v", err)
			}
			// parseFlag returns the canonical shape, which the vectors are written in.
			if got, want := asJSON(t, flag), asJSON(t, vf.Flag); !reflect.DeepEqual(got, want) {
				t.Errorf("not canonical:\n got %s\nwant %s", mustJSON(t, got), mustJSON(t, want))
			}
			for i, c := range vf.Cases {
				cases++
				result, err := evaluate(&flag, c.context(), c.Missing == "inconclusive")
				if string(c.Expected) == `"inconclusive"` {
					var inc *inconclusiveError
					if err == nil || !errors.As(err, &inc) || !strings.Contains(err.Error(), "locally") {
						t.Errorf("case %d: want inconclusive, got %+v, %v", i, result, err)
					}
					continue
				}
				if err != nil {
					t.Errorf("case %d: %v", i, err)
					continue
				}
				got := map[string]any{"value": result.Value, "payload": result.Payload, "reason": result.Reason}
				if result.Condition != nil {
					got["condition"] = *result.Condition
				}
				var want any
				_ = json.Unmarshal(c.Expected, &want)
				if g, w := asJSON(t, got), asJSON(t, want); !reflect.DeepEqual(g, w) {
					t.Errorf("case %d (%s):\n got %s\nwant %s", i, mustJSON(t, c.Context), mustJSON(t, g), mustJSON(t, w))
				}
			}
		})
	}
	if cases == 0 {
		t.Fatal("no cases ran")
	}
}

func TestParseFlagRejectsInvalidDefinitions(t *testing.T) {
	bad := map[string]string{
		"not an object":       `[]`,
		"bad key":             `{"key": "-x"}`,
		"variants not 100":    `{"key": "a", "variants": [{"key": "x", "rollout": 60}]}`,
		"duplicate variant":   `{"key": "a", "variants": [{"key": "x", "rollout": 50}, {"key": "x", "rollout": 50}]}`,
		"rollout over 100":    `{"key": "a", "conditions": [{"filters": [], "rollout": 101}]}`,
		"unknown operator":    `{"key": "a", "conditions": [{"filters": [{"type": "person", "property": "p", "operator": "like", "value": "x"}], "rollout": 1}]}`,
		"missing value":       `{"key": "a", "conditions": [{"filters": [{"type": "person", "property": "p", "operator": "eq"}], "rollout": 1}]}`,
		"group without type":  `{"key": "a", "conditions": [{"filters": [{"type": "group", "property": "p", "operator": "is_set"}], "rollout": 1}]}`,
		"unknown variant":     `{"key": "a", "conditions": [{"filters": [], "rollout": 1, "variant": "x"}]}`,
		"payload for nothing": `{"key": "a", "payloads": {"x": 1}}`,
		"empty group type":    `{"key": "a", "groupType": ""}`,
	}
	for name, raw := range bad {
		var v any
		if err := json.Unmarshal([]byte(raw), &v); err != nil {
			t.Fatal(err)
		}
		if _, err := parseFlag(v); err == nil {
			t.Errorf("%s: parseFlag accepted %s", name, raw)
		}
	}
}

func TestMatchesReadsNumbersLikeJavaScript(t *testing.T) {
	gt := func(actual, value string) bool {
		return matches(actual, flagFilter{Operator: "gt", Value: value})
	}
	for _, c := range []struct {
		actual, value string
		want          bool
	}{
		{"12", "5", true}, {" 12.5 ", "12", true}, {"+3", "2", true}, {".5", "0.25", true},
		{"5.", "4", true}, {"1e3", "999", true}, {"1e400", "1", true}, {"many", "1", false},
		{"0x10", "1", false}, {"", "1", false}, {" 7　", "6", true}, {"\u00857", "6", false},
	} {
		if got := gt(c.actual, c.value); got != c.want {
			t.Errorf("%q gt %q = %v, want %v", c.actual, c.value, got, c.want)
		}
	}
	if !matches("Ada@Example.com", flagFilter{Operator: "contains", Value: "@EXAMPLE.COM"}) {
		t.Error("contains should ignore case")
	}
	if got := propertyText(map[string]any{"a": "<b>"}); got != `{"a":"<b>"}` {
		t.Errorf("propertyText = %s", got)
	}
	if got := propertyText(12.0); got != "12" {
		t.Errorf("propertyText(12) = %s", got)
	}
}
