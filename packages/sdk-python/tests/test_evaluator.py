"""The flag evaluator against the shared vectors in packages/flags/vectors.json."""

from __future__ import annotations

import unittest
from typing import Any, Dict

from _support import VECTORS, load_json

from footprint.flags import (
    FlagContext,
    InconclusiveError,
    _text,
    bucket,
    evaluate,
    evaluate_all,
    parse_flag,
)

VECTOR_DATA = load_json(VECTORS)


def context_from(raw: Dict[str, Any]) -> FlagContext:
    return FlagContext(
        distinct_id=raw["distinctId"],
        person_properties=raw.get("personProperties"),
        groups=raw.get("groups"),
        group_properties=raw.get("groupProperties"),
        cohorts=raw.get("cohorts"),
    )


class BucketVectors(unittest.TestCase):
    def test_every_bucket_vector(self) -> None:
        self.assertGreater(len(VECTOR_DATA["buckets"]), 0)
        for case in VECTOR_DATA["buckets"]:
            with self.subTest(**case):
                self.assertEqual(bucket(case["flag"], case["id"], case["salt"]), case["bucket"])


class FlagVectors(unittest.TestCase):
    def test_every_flag_case(self) -> None:
        count = 0
        for group in VECTOR_DATA["flags"]:
            flag = parse_flag(group["flag"])
            for i, case in enumerate(group["cases"]):
                count += 1
                with self.subTest(flag=group["name"], case=i):
                    context = context_from(case["context"])
                    missing = case.get("missing", "empty")
                    expected = case["expected"]
                    if expected == "inconclusive":
                        with self.assertRaises(InconclusiveError):
                            evaluate(flag, context, missing)
                        continue
                    result = evaluate(flag, context, missing)
                    self.assertEqual(result.key, flag.key)
                    self.assertIs(type(result.value), type(expected["value"]))
                    self.assertEqual(result.value, expected["value"])
                    self.assertEqual(result.payload, expected["payload"])
                    self.assertEqual(result.reason, expected["reason"])
                    self.assertEqual(result.condition, expected.get("condition"))
        self.assertEqual(count, sum(len(g["cases"]) for g in VECTOR_DATA["flags"]))

    def test_evaluate_all_reports_inconclusive_keys(self) -> None:
        flags = [parse_flag(g["flag"]) for g in VECTOR_DATA["flags"]]
        results, inconclusive = evaluate_all(flags, FlagContext(distinct_id="eve"), "inconclusive")
        self.assertIn("vip", inconclusive)  # cohort membership unknown
        self.assertIn("pricing", inconclusive)  # email not given
        self.assertIs(results["new-checkout"].value, True)
        self.assertEqual(results["off"].reason, "inactive")


class Parsing(unittest.TestCase):
    def test_vector_flags_parse_to_canonical_shape(self) -> None:
        beta = next(g["flag"] for g in VECTOR_DATA["flags"] if g["flag"]["key"] == "beta")
        flag = parse_flag(beta)
        self.assertEqual(flag.group_type, "company")
        self.assertEqual(flag.conditions[0].filters[0].group_type, "company")
        self.assertEqual(flag.conditions[0].filters[0].type, "group")

    def test_rejects_invalid_definitions(self) -> None:
        bad = [
            "nope",
            {"key": "-starts-with-dash", "active": True},
            {"key": "x", "variants": [{"key": "a", "rollout": 60}, {"key": "b", "rollout": 30}]},
            {"key": "x", "variants": [{"key": "a", "rollout": 50}, {"key": "a", "rollout": 50}]},
            {"key": "x", "conditions": [{"rollout": 101}]},
            {"key": "x", "conditions": [{"rollout": True}]},
            {"key": "x", "conditions": [{"rollout": 50, "filters": [{"type": "person", "property": "p", "operator": "like", "value": "v"}]}]},
            {"key": "x", "conditions": [{"rollout": 50, "filters": [{"type": "person", "property": "p", "operator": "eq"}]}]},
            {"key": "x", "conditions": [{"rollout": 50, "filters": [{"type": "group", "property": "p", "operator": "is_set"}]}]},
            {"key": "x", "conditions": [{"rollout": 50, "variant": "nope"}]},
            {"key": "x", "payloads": {"control": 1}},
            {"key": "x", "groupType": ""},
        ]
        for raw in bad:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    parse_flag(raw)

    def test_property_text_matches_javascript(self) -> None:
        self.assertEqual(_text(12), "12")
        self.assertEqual(_text(12.0), "12")
        self.assertEqual(_text(12.5), "12.5")
        self.assertEqual(_text(True), "true")
        self.assertEqual(_text(None), "")
        self.assertEqual(_text(1e21), "1e+21")
        self.assertEqual(_text(1e-7), "1e-7")
        self.assertEqual(_text({"a": [1, 2.0, None]}), '{"a":[1,2,null]}')


if __name__ == "__main__":
    unittest.main()
