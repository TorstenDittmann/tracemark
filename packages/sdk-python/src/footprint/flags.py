"""The feature flag evaluator, ported from ``packages/flags`` (``flags.ts`` and ``parse.ts``).

Every evaluator, this one included, must pass the shared vectors in
``packages/flags/vectors.json``, so a person gets the same answer from the SDK as from the server.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple, Union, cast

__all__ = [
    "OPERATORS",
    "FlagValue",
    "FlagFilter",
    "FlagCondition",
    "FlagVariant",
    "FlagDefinition",
    "FlagContext",
    "FlagResult",
    "InconclusiveError",
    "bucket",
    "matches",
    "evaluate",
    "evaluate_all",
    "parse_flag",
]

FlagValue = Union[bool, str]
"""``False`` when a flag is off; ``True`` or the variant key when it is on."""

OPERATORS: Tuple[str, ...] = (
    "eq",
    "neq",
    "contains",
    "not_contains",
    "gt",
    "lt",
    "is_set",
    "is_not_set",
)

KEY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}")
MAX_CONDITIONS = 20
MAX_FILTERS = 20
MAX_VARIANTS = 20

MISSING_EMPTY = "empty"
MISSING_INCONCLUSIVE = "inconclusive"


@dataclass
class FlagFilter:
    """A person or group property compared to a value, or a cohort the person must be in.

    ``type`` is ``person``, ``group`` or ``cohort``. ``is_set`` and ``is_not_set`` take no value.
    """

    type: str
    property: str = ""
    operator: str = ""
    value: Optional[str] = None
    group_type: Optional[str] = None
    cohort: Optional[str] = None


@dataclass
class FlagCondition:
    """Who a condition matches (every filter) and what share of them get the flag."""

    filters: List[FlagFilter]
    rollout: float
    """Percent of matching ids that get the flag, 0 to 100."""
    variant: Optional[str] = None
    """Serve this variant to everyone the condition lets in, instead of splitting by weight."""


@dataclass
class FlagVariant:
    key: str
    rollout: float
    """Percent of enabled ids served this variant; a flag's variants add up to 100."""


@dataclass
class FlagDefinition:
    key: str
    active: bool
    conditions: List[FlagCondition]
    """Matched in order; the first one an id matches decides."""
    variants: List[FlagVariant]
    """Empty for a boolean flag."""
    payloads: Dict[str, Any]
    """JSON served with a value: keyed by variant, or by ``"true"`` for a boolean flag."""
    group_type: Optional[str] = None
    """Bucket by this group's key instead of the person, so a whole company gets one answer."""


@dataclass
class FlagContext:
    distinct_id: str
    person_properties: Optional[Mapping[str, Any]] = None
    groups: Optional[Mapping[str, str]] = None
    """Group type to group key, such as ``{"company": "acme"}``."""
    group_properties: Optional[Mapping[str, Mapping[str, Any]]] = None
    """Group type to that group's properties."""
    cohorts: Optional[Sequence[str]] = None
    """Ids of the cohorts the person is in. Leave out when unknown."""


@dataclass
class FlagResult:
    key: str
    value: FlagValue
    payload: Any
    reason: str
    """``inactive``, ``no_group``, ``no_match``, ``out_of_rollout`` or ``match``."""
    condition: Optional[int] = None
    """Index of the condition that matched."""


class InconclusiveError(Exception):
    """Raised when the context lacks something a flag needs; the server can still evaluate it."""

    def __init__(self, flag: str, detail: str) -> None:
        super().__init__(f"Can't evaluate {flag} locally: {detail}")
        self.flag = flag


_SCALE = float(2**52)


def bucket(flag_key: str, id: str, salt: str = "") -> float:
    """Where an id falls for a flag, in [0, 1): the first 52 bits of SHA-1 of
    ``<flag key>.<id><salt>``. The same on every platform, which the shared vectors check."""
    digest = hashlib.sha1(f"{flag_key}.{id}{salt}".encode("utf-8")).hexdigest()
    return int(digest[:13], 16) / _SCALE


def _js_number(value: float) -> str:
    """A number formatted the way JavaScript's ``String(number)`` does."""
    if math.isnan(value) or math.isinf(value):
        return "null"  # JSON.stringify writes non-finite numbers as null
    if value == 0:
        return "0"
    sign = "-" if value < 0 else ""
    # repr() gives the shortest digits that round-trip, as JavaScript does; only the layout differs.
    parsed = Decimal(repr(abs(value))).normalize().as_tuple()
    digits = "".join(str(d) for d in parsed.digits)
    k = len(digits)
    n = k + int(parsed.exponent)  # value = 0.<digits> * 10^n
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def _js_json(value: Any) -> str:
    """``JSON.stringify`` for JSON-like Python values."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return _js_number(float(value)) if abs(value) >= 2**53 else str(value)
    if isinstance(value, float):
        return _js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, Mapping):
        entries = cast(Mapping[Any, Any], value).items()
        return "{" + ",".join(f"{json.dumps(str(k), ensure_ascii=False)}:{_js_json(v)}" for k, v in entries) + "}"
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_js_json(v) for v in cast(Sequence[Any], value)) + "]"
    return json.dumps(str(value), ensure_ascii=False)


def _text(value: Any) -> str:
    """A property value as text, the way ClickHouse reads it: strings as is, the rest as JSON."""
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return _js_json(value)


_NUMBER = re.compile(r"\s*[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?\s*")


def _number(value: str) -> Optional[float]:
    if not _NUMBER.fullmatch(value):
        return None
    try:
        return float(value)
    except ValueError:  # pragma: no cover - the pattern only lets numbers through
        return None


def matches(actual: str, match: FlagFilter) -> bool:
    """Whether ``actual`` passes ``match``, with the same meaning as the insight and cohort filters."""
    op = match.operator
    expected = match.value or ""
    if op == "eq":
        return actual == expected
    if op == "neq":
        return actual != expected
    if op == "contains":
        return expected.lower() in actual.lower()
    if op == "not_contains":
        return expected.lower() not in actual.lower()
    if op in ("gt", "lt"):
        a = _number(actual)
        b = _number(expected)
        if a is None or b is None:
            return False
        return a > b if op == "gt" else a < b
    if op == "is_set":
        return actual != ""
    if op == "is_not_set":
        return actual == ""
    return False


def _property(flag: str, properties: Optional[Mapping[str, Any]], name: str, missing: str) -> str:
    if properties is not None and name in properties:
        return _text(properties[name])
    if missing == MISSING_INCONCLUSIVE:
        raise InconclusiveError(flag, f"property {name} not given")
    return ""


def _passes(flag: FlagDefinition, filter: FlagFilter, context: FlagContext, missing: str) -> bool:
    if filter.type == "person":
        return matches(_property(flag.key, context.person_properties, filter.property, missing), filter)
    if filter.type == "group":
        group_props = (context.group_properties or {}).get(filter.group_type or "")
        return matches(_property(flag.key, group_props, filter.property, missing), filter)
    if filter.type == "cohort":
        if context.cohorts is None:
            raise InconclusiveError(flag.key, "cohort membership not known")
        return filter.cohort in context.cohorts
    return False


def _variant_for(flag: FlagDefinition, id: str) -> Optional[str]:
    at = bucket(flag.key, id, ".variant")
    edge = 0.0
    for variant in flag.variants:
        edge += variant.rollout / 100
        if at < edge:
            return variant.key
    return flag.variants[-1].key if flag.variants else None


def _key_of(value: FlagValue) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    return str(value)


def _result(flag: FlagDefinition, value: FlagValue, reason: str) -> FlagResult:
    payload = None if value is False else flag.payloads.get(_key_of(value))
    return FlagResult(key=flag.key, value=value, payload=payload, reason=reason)


def evaluate(flag: FlagDefinition, context: FlagContext, missing: str = MISSING_EMPTY) -> FlagResult:
    """Evaluates one flag for one person (or group).

    Raises :class:`InconclusiveError` when the context lacks cohort membership a condition needs,
    or, with ``missing="inconclusive"``, a property.
    """
    if not flag.active:
        return _result(flag, False, "inactive")
    id = (context.groups or {}).get(flag.group_type) if flag.group_type else context.distinct_id
    if not id:
        return _result(flag, False, "no_group")
    reason = "no_match"
    for index, condition in enumerate(flag.conditions):
        if not all(_passes(flag, f, context, missing) for f in condition.filters):
            continue
        if bucket(flag.key, id) >= condition.rollout / 100:
            reason = "out_of_rollout"
            continue
        value: Optional[FlagValue]
        if flag.variants:
            served = next((v.key for v in flag.variants if v.key == condition.variant), None)
            value = served if served is not None else _variant_for(flag, id)
        else:
            value = True
        result = _result(flag, value if value is not None else False, "match")
        result.condition = index
        return result
    return _result(flag, False, reason)


def evaluate_all(
    flags: Sequence[FlagDefinition], context: FlagContext, missing: str = MISSING_EMPTY
) -> Tuple[Dict[str, FlagResult], List[str]]:
    """Evaluates every flag, skipping ones that can't be decided from the context; their keys
    come back second so a caller evaluating locally knows to ask the server."""
    results: Dict[str, FlagResult] = {}
    inconclusive: List[str] = []
    for flag in flags:
        try:
            results[flag.key] = evaluate(flag, context, missing)
        except InconclusiveError:
            inconclusive.append(flag.key)
    return results, inconclusive


# --- parsing ---------------------------------------------------------------------------------


def _is_name(value: Any) -> bool:
    return isinstance(value, str) and 0 < len(value) <= 200


def _is_percent(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and 0 <= value <= 100
    )


def record(value: Any) -> Optional[Dict[str, Any]]:
    """``value`` as a JSON object, or ``None`` when it is something else."""
    return cast(Dict[str, Any], value) if isinstance(value, dict) else None


def items(value: Any) -> List[Any]:
    """``value`` as a JSON array; anything else reads as empty."""
    return cast(List[Any], value) if isinstance(value, list) else []


def _parse_filter(value: Any, at: str) -> FlagFilter:
    raw = record(value)
    if raw is None:
        raise ValueError(f"{at} is not an object")
    kind = raw.get("type")
    if kind == "cohort":
        cohort = raw.get("cohort")
        if not isinstance(cohort, str) or not _is_name(cohort):
            raise ValueError(f"{at} needs a cohort")
        return FlagFilter(type="cohort", cohort=cohort)
    if kind not in ("person", "group"):
        raise ValueError(f"{at} has an unknown type")
    prop = raw.get("property")
    if not isinstance(prop, str) or not _is_name(prop):
        raise ValueError(f"{at} needs a property")
    operator = raw.get("operator")
    if not isinstance(operator, str) or operator not in OPERATORS:
        raise ValueError(f"{at} has an unknown operator")
    value_text: Optional[str] = None
    if operator not in ("is_set", "is_not_set"):
        raw_value = raw.get("value")
        if not isinstance(raw_value, str) or len(raw_value) > 1000:
            raise ValueError(f"{at} needs a value")
        value_text = raw_value
    if kind == "person":
        return FlagFilter(type="person", property=prop, operator=operator, value=value_text)
    group_type = raw.get("groupType")
    if not isinstance(group_type, str) or not _is_name(group_type):
        raise ValueError(f"{at} needs a group type")
    return FlagFilter(type="group", property=prop, operator=operator, value=value_text, group_type=group_type)


def parse_flag(value: Any) -> FlagDefinition:
    """Checks a flag definition from an untrusted source (such as ``GET /flags/definitions``) and
    returns it in canonical shape. Raises ``ValueError`` with a readable message when it isn't valid."""
    input = record(value)
    if input is None:
        raise ValueError("A flag must be an object")
    key = input.get("key")
    if not isinstance(key, str) or not KEY.fullmatch(key):
        raise ValueError("A flag key is letters, digits, dots, dashes and underscores")
    group_type: Optional[str] = None
    if "groupType" in input:
        raw_group_type = input["groupType"]
        if not isinstance(raw_group_type, str) or not _is_name(raw_group_type):
            raise ValueError(f"{key}: the group type must be a name")
        group_type = raw_group_type

    raw_variants = items(input.get("variants"))
    if len(raw_variants) > MAX_VARIANTS:
        raise ValueError(f"{key}: at most {MAX_VARIANTS} variants")
    variants: List[FlagVariant] = []
    for i, item in enumerate(raw_variants):
        raw = record(item)
        variant_key = raw.get("key") if raw is not None else None
        if raw is None or not isinstance(variant_key, str) or not KEY.fullmatch(variant_key):
            raise ValueError(f"{key}: variant {i + 1} needs a key")
        rollout = raw.get("rollout")
        if not _is_percent(rollout):
            raise ValueError(f"{key}: variant {variant_key} needs a percent")
        variants.append(FlagVariant(key=variant_key, rollout=cast(float, rollout)))
    if len({v.key for v in variants}) != len(variants):
        raise ValueError(f"{key}: variant keys must be unique")
    if variants:
        total = 0.0
        for v in variants:
            total += v.rollout
        if abs(total - 100) > 0.001:
            raise ValueError(f"{key}: variants must add up to 100%")

    raw_conditions = items(input.get("conditions"))
    if len(raw_conditions) > MAX_CONDITIONS:
        raise ValueError(f"{key}: at most {MAX_CONDITIONS} conditions")
    conditions: List[FlagCondition] = []
    for i, item in enumerate(raw_conditions):
        at = f"{key}: condition {i + 1}"
        raw = record(item)
        if raw is None:
            raise ValueError(f"{at} is not an object")
        rollout = raw.get("rollout")
        if not _is_percent(rollout):
            raise ValueError(f"{at} needs a rollout percent")
        raw_filters = items(raw.get("filters"))
        if len(raw_filters) > MAX_FILTERS:
            raise ValueError(f"{at} has more than {MAX_FILTERS} filters")
        condition = FlagCondition(
            filters=[_parse_filter(f, f"{at}, filter {j + 1}") for j, f in enumerate(raw_filters)],
            rollout=cast(float, rollout),
        )
        variant = raw.get("variant")
        if variant is not None and variant != "":
            if not isinstance(variant, str) or not any(v.key == variant for v in variants):
                raise ValueError(f"{at} serves a variant the flag doesn't have")
            condition.variant = variant
        conditions.append(condition)

    payloads: Dict[str, Any] = {}
    allowed = [v.key for v in variants] if variants else ["true"]
    for name, payload in (record(input.get("payloads")) or {}).items():
        if name not in allowed:
            raise ValueError(f"{key}: a payload for {name} has no value to go with")
        payloads[name] = payload

    return FlagDefinition(
        key=key,
        active=input.get("active") is True,
        conditions=conditions,
        variants=variants,
        payloads=payloads,
        group_type=group_type,
    )
