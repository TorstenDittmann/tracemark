package tracemark

// A port of packages/flags (parse.ts and flags.ts). Every evaluator must pass the shared vectors
// in packages/flags/vectors.json, so keep this in step with the TypeScript one.

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

const (
	maxConditions = 20
	maxFilters    = 20
	maxVariants   = 20
)

var flagKeyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$`)

var operators = map[string]bool{
	"eq": true, "neq": true, "contains": true, "not_contains": true,
	"gt": true, "lt": true, "is_set": true, "is_not_set": true,
}

// flagFilter is one filter of a condition: a person or group property, or a cohort.
type flagFilter struct {
	Type      string // person, group or cohort
	GroupType string
	Property  string
	Operator  string
	Value     string
	Cohort    string
}

// MarshalJSON writes the filter in the canonical shape parseFlag returns.
func (f flagFilter) MarshalJSON() ([]byte, error) {
	out := map[string]any{"type": f.Type}
	if f.Type == "cohort" {
		out["cohort"] = f.Cohort
		return json.Marshal(out)
	}
	out["property"] = f.Property
	out["operator"] = f.Operator
	if f.Operator != "is_set" && f.Operator != "is_not_set" {
		out["value"] = f.Value
	}
	if f.Type == "group" {
		out["groupType"] = f.GroupType
	}
	return json.Marshal(out)
}

type flagCondition struct {
	Filters []flagFilter `json:"filters"`
	Rollout float64      `json:"rollout"`
	Variant string       `json:"variant,omitempty"`
}

type flagVariant struct {
	Key     string  `json:"key"`
	Rollout float64 `json:"rollout"`
}

// flagDefinition is a flag as GET /flags/definitions serves it, after parseFlag.
type flagDefinition struct {
	Key        string          `json:"key"`
	Active     bool            `json:"active"`
	GroupType  string          `json:"groupType,omitempty"`
	Conditions []flagCondition `json:"conditions"`
	Variants   []flagVariant   `json:"variants"`
	Payloads   map[string]any  `json:"payloads"`
}

// flagContext is what an evaluation knows about the person.
type flagContext struct {
	DistinctID       string
	PersonProperties map[string]any
	Groups           map[string]string
	GroupProperties  map[string]map[string]any
	// Cohorts the person is in; nil when unknown, which an SDK always is.
	Cohorts []string
}

// flagResult is one flag's answer for one person.
type flagResult struct {
	Key string
	// false when off; true or the variant key when on.
	Value     any
	Payload   any
	Reason    string // inactive, no_group, no_match, out_of_rollout or match
	Condition *int
}

// inconclusiveError means the context lacks something the flag needs; the server can decide.
type inconclusiveError struct {
	flag, detail string
}

func (e *inconclusiveError) Error() string {
	return fmt.Sprintf("can't evaluate %s locally: %s", e.flag, e.detail)
}

func isName(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && s != "" && utf16Len(s) <= 200
}

func isPercent(v any) (float64, bool) {
	n, ok := v.(float64)
	return n, ok && !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= 100
}

// utf16Len counts a string the way JavaScript's length does.
func utf16Len(s string) int {
	n := 0
	for _, r := range s {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}

func parseFilter(raw any, at string) (flagFilter, error) {
	obj, ok := raw.(map[string]any)
	if !ok {
		return flagFilter{}, fmt.Errorf("%s is not an object", at)
	}
	if obj["type"] == "cohort" {
		cohort, ok := isName(obj["cohort"])
		if !ok {
			return flagFilter{}, fmt.Errorf("%s needs a cohort", at)
		}
		return flagFilter{Type: "cohort", Cohort: cohort}, nil
	}
	typ, _ := obj["type"].(string)
	if typ != "person" && typ != "group" {
		return flagFilter{}, fmt.Errorf("%s has an unknown type", at)
	}
	property, ok := isName(obj["property"])
	if !ok {
		return flagFilter{}, fmt.Errorf("%s needs a property", at)
	}
	operator, _ := obj["operator"].(string)
	if !operators[operator] {
		return flagFilter{}, fmt.Errorf("%s has an unknown operator", at)
	}
	f := flagFilter{Type: "person", Property: property, Operator: operator}
	if operator != "is_set" && operator != "is_not_set" {
		value, ok := obj["value"].(string)
		if !ok || utf16Len(value) > 1000 {
			return flagFilter{}, fmt.Errorf("%s needs a value", at)
		}
		f.Value = value
	}
	if typ == "person" {
		return f, nil
	}
	groupType, ok := isName(obj["groupType"])
	if !ok {
		return flagFilter{}, fmt.Errorf("%s needs a group type", at)
	}
	f.Type = "group"
	f.GroupType = groupType
	return f, nil
}

// parseFlag checks a flag definition decoded from JSON (with encoding/json's generic types) and
// returns it in canonical shape, or an error saying what is wrong.
func parseFlag(input any) (flagDefinition, error) {
	obj, ok := input.(map[string]any)
	if !ok {
		return flagDefinition{}, errors.New("a flag must be an object")
	}
	key, ok := obj["key"].(string)
	if !ok || !flagKeyPattern.MatchString(key) {
		return flagDefinition{}, errors.New("a flag key is letters, digits, dots, dashes and underscores")
	}
	flag := flagDefinition{Key: key, Active: obj["active"] == true, Payloads: map[string]any{}}
	if raw, present := obj["groupType"]; present {
		groupType, ok := isName(raw)
		if !ok {
			return flagDefinition{}, fmt.Errorf("%s: the group type must be a name", key)
		}
		flag.GroupType = groupType
	}

	rawVariants, _ := obj["variants"].([]any)
	if len(rawVariants) > maxVariants {
		return flagDefinition{}, fmt.Errorf("%s: at most %d variants", key, maxVariants)
	}
	flag.Variants = make([]flagVariant, 0, len(rawVariants))
	seen := map[string]bool{}
	total := 0.0
	for i, raw := range rawVariants {
		v, ok := raw.(map[string]any)
		vkey, isString := v["key"].(string)
		if !ok || !isString || !flagKeyPattern.MatchString(vkey) {
			return flagDefinition{}, fmt.Errorf("%s: variant %d needs a key", key, i+1)
		}
		rollout, ok := isPercent(v["rollout"])
		if !ok {
			return flagDefinition{}, fmt.Errorf("%s: variant %s needs a percent", key, vkey)
		}
		flag.Variants = append(flag.Variants, flagVariant{Key: vkey, Rollout: rollout})
		seen[vkey] = true
		total += rollout
	}
	if len(seen) != len(flag.Variants) {
		return flagDefinition{}, fmt.Errorf("%s: variant keys must be unique", key)
	}
	if len(flag.Variants) > 0 && math.Abs(total-100) > 0.001 {
		return flagDefinition{}, fmt.Errorf("%s: variants must add up to 100%%", key)
	}

	rawConditions, _ := obj["conditions"].([]any)
	if len(rawConditions) > maxConditions {
		return flagDefinition{}, fmt.Errorf("%s: at most %d conditions", key, maxConditions)
	}
	flag.Conditions = make([]flagCondition, 0, len(rawConditions))
	for i, raw := range rawConditions {
		at := fmt.Sprintf("%s: condition %d", key, i+1)
		c, ok := raw.(map[string]any)
		if !ok {
			return flagDefinition{}, fmt.Errorf("%s is not an object", at)
		}
		rollout, ok := isPercent(c["rollout"])
		if !ok {
			return flagDefinition{}, fmt.Errorf("%s needs a rollout percent", at)
		}
		rawFilters, _ := c["filters"].([]any)
		if len(rawFilters) > maxFilters {
			return flagDefinition{}, fmt.Errorf("%s has more than %d filters", at, maxFilters)
		}
		condition := flagCondition{Filters: make([]flagFilter, 0, len(rawFilters)), Rollout: rollout}
		for j, rf := range rawFilters {
			f, err := parseFilter(rf, fmt.Sprintf("%s, filter %d", at, j+1))
			if err != nil {
				return flagDefinition{}, err
			}
			condition.Filters = append(condition.Filters, f)
		}
		if variant, present := c["variant"]; present && variant != nil && variant != "" {
			name, isString := variant.(string)
			if !isString || !seen[name] {
				return flagDefinition{}, fmt.Errorf("%s serves a variant the flag doesn't have", at)
			}
			condition.Variant = name
		}
		flag.Conditions = append(flag.Conditions, condition)
	}

	allowed := map[string]bool{"true": true}
	if len(flag.Variants) > 0 {
		allowed = seen
	}
	payloads, _ := obj["payloads"].(map[string]any)
	for name, value := range payloads {
		if !allowed[name] {
			return flagDefinition{}, fmt.Errorf("%s: a payload for %s has no value to go with", key, name)
		}
		flag.Payloads[name] = value
	}
	return flag, nil
}

// bucket is where an id falls for a flag, in [0, 1): the first 52 bits of SHA-1 of
// "<flag key>.<id><salt>".
func bucket(flagKey, id, salt string) float64 {
	sum := sha1.Sum([]byte(flagKey + "." + id + salt))
	n, _ := strconv.ParseUint(hex.EncodeToString(sum[:])[:13], 16, 64)
	return float64(n) / (1 << 52)
}

// propertyText reads a property value the way ClickHouse does: strings as is, the rest as JSON.
func propertyText(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return v
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(value); err != nil {
		return fmt.Sprint(value)
	}
	return strings.TrimSuffix(buf.String(), "\n")
}

var numberPattern = regexp.MustCompile(`^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$`)

// jsSpace is JavaScript's \s: Unicode white space except U+0085, plus the byte order mark.
func jsSpace(r rune) bool { return (unicode.IsSpace(r) && r != 0x85) || r == 0xFEFF }

func parseNumber(value string) (float64, bool) {
	trimmed := strings.TrimFunc(value, jsSpace)
	if !numberPattern.MatchString(trimmed) {
		return 0, false
	}
	// Out-of-range values come back as ±Inf, as Number() gives Infinity.
	n, err := strconv.ParseFloat(trimmed, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return 0, false
	}
	return n, true
}

// matches reports whether a property's text passes a filter's operator and value.
func matches(actual string, f flagFilter) bool {
	switch f.Operator {
	case "eq":
		return actual == f.Value
	case "neq":
		return actual != f.Value
	case "contains":
		return strings.Contains(strings.ToLower(actual), strings.ToLower(f.Value))
	case "not_contains":
		return !strings.Contains(strings.ToLower(actual), strings.ToLower(f.Value))
	case "gt", "lt":
		a, okA := parseNumber(actual)
		b, okB := parseNumber(f.Value)
		if !okA || !okB {
			return false
		}
		if f.Operator == "gt" {
			return a > b
		}
		return a < b
	case "is_set":
		return actual != ""
	case "is_not_set":
		return actual == ""
	}
	return false
}

func property(flag string, properties map[string]any, name string, inconclusive bool) (string, error) {
	if value, ok := properties[name]; ok {
		return propertyText(value), nil
	}
	if inconclusive {
		return "", &inconclusiveError{flag, "property " + name + " not given"}
	}
	return "", nil
}

func passes(flag *flagDefinition, f flagFilter, ctx *flagContext, inconclusive bool) (bool, error) {
	switch f.Type {
	case "person":
		actual, err := property(flag.Key, ctx.PersonProperties, f.Property, inconclusive)
		return err == nil && matches(actual, f), err
	case "group":
		actual, err := property(flag.Key, ctx.GroupProperties[f.GroupType], f.Property, inconclusive)
		return err == nil && matches(actual, f), err
	case "cohort":
		if ctx.Cohorts == nil {
			return false, &inconclusiveError{flag.Key, "cohort membership not known"}
		}
		for _, c := range ctx.Cohorts {
			if c == f.Cohort {
				return true, nil
			}
		}
		return false, nil
	}
	return false, nil
}

func variantFor(flag *flagDefinition, id string) string {
	at := bucket(flag.Key, id, ".variant")
	edge := 0.0
	for _, v := range flag.Variants {
		edge += v.Rollout / 100
		if at < edge {
			return v.Key
		}
	}
	return flag.Variants[len(flag.Variants)-1].Key
}

func makeResult(flag *flagDefinition, value any, reason string) flagResult {
	var payload any
	if value != false {
		payload = flag.Payloads[fmt.Sprint(value)]
	}
	return flagResult{Key: flag.Key, Value: value, Payload: payload, Reason: reason}
}

// evaluate decides one flag for one person (or group). It returns an *inconclusiveError when the
// context lacks cohort membership a condition needs or, with inconclusive set, a property.
func evaluate(flag *flagDefinition, ctx *flagContext, inconclusive bool) (flagResult, error) {
	if !flag.Active {
		return makeResult(flag, false, "inactive"), nil
	}
	id := ctx.DistinctID
	if flag.GroupType != "" {
		id = ctx.Groups[flag.GroupType]
	}
	if id == "" {
		return makeResult(flag, false, "no_group"), nil
	}
	reason := "no_match"
conditions:
	for index, condition := range flag.Conditions {
		for _, f := range condition.Filters {
			ok, err := passes(flag, f, ctx, inconclusive)
			if err != nil {
				return flagResult{}, err
			}
			if !ok {
				continue conditions
			}
		}
		if bucket(flag.Key, id, "") >= condition.Rollout/100 {
			reason = "out_of_rollout"
			continue
		}
		var value any = true
		if len(flag.Variants) > 0 {
			value = variantFor(flag, id)
			for _, v := range flag.Variants {
				if v.Key == condition.Variant {
					value = v.Key
				}
			}
		}
		result := makeResult(flag, value, "match")
		result.Condition = &index
		return result, nil
	}
	return makeResult(flag, false, reason), nil
}
