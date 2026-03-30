"""
Accuracy metrics and DSL parser for the Monitor DSL.

Provides:
  - parse_monitor_dsl: Python regex-based parser (mirrors the peggy grammar)
  - compute_parse_accuracy: fraction of outputs that successfully parse
  - compute_semantic_accuracy: fraction of parsed outputs matching expected reports
"""

from __future__ import annotations

import re
from typing import Any, Callable


# ── Valid values ────────────────────────────────────────────────

VALID_ANOMALY_TYPES = {"low-confidence", "unexpected-result", "compound"}
VALID_REPLAN_VALUES = {"yes": True, "no": False}


# ── DSL Parser ─────────────────────────────────────────────────


class ParseError(Exception):
    """Raised when a DSL string cannot be parsed."""
    pass


def parse_monitor_dsl(dsl: str) -> dict[str, Any] | None:
    """
    Parse a Monitor DSL string into a structured dict.

    Mirrors the peggy grammar. Returns None if parsing fails.

    Expected format:
        ANOMALIES: none
        -- or --
        ANOMALIES:
        @module type "detail"
        ...
        ESCALATE: none | ESCALATE: "message"
        RESTRICT: none | RESTRICT: action1, action2
        REPLAN: yes | no

    Returns:
        Dict with keys: anomalies, escalation, restrictedActions, forceReplan.
        Returns None on parse failure.
    """
    try:
        return _parse_dsl_strict(dsl)
    except ParseError:
        return None


def _parse_dsl_strict(dsl: str) -> dict[str, Any]:
    """Parse DSL string strictly; raises ParseError on failure."""
    lines = dsl.strip().split("\n")
    idx = 0

    # ── ANOMALIES section
    if idx >= len(lines):
        raise ParseError("Missing ANOMALIES section")

    line = lines[idx].strip()
    if line == "ANOMALIES: none":
        anomalies: list[dict[str, str]] = []
        idx += 1
    elif line == "ANOMALIES:":
        idx += 1
        anomalies = []
        while idx < len(lines) and lines[idx].strip().startswith("@"):
            anomaly = _parse_anomaly_line(lines[idx].strip())
            anomalies.append(anomaly)
            idx += 1
        if len(anomalies) == 0:
            raise ParseError("ANOMALIES: header with no entries")
    else:
        raise ParseError(f"Expected 'ANOMALIES:' but got: {line!r}")

    # ── ESCALATE section
    if idx >= len(lines):
        raise ParseError("Missing ESCALATE section")

    line = lines[idx].strip()
    if line == "ESCALATE: none":
        escalation: str | None = None
        idx += 1
    elif line.startswith("ESCALATE: "):
        rest = line[len("ESCALATE: "):]
        escalation = _parse_quoted_string(rest)
        idx += 1
    else:
        raise ParseError(f"Expected 'ESCALATE:' but got: {line!r}")

    # ── RESTRICT section
    if idx >= len(lines):
        raise ParseError("Missing RESTRICT section")

    line = lines[idx].strip()
    if line == "RESTRICT: none":
        restricted_actions: list[str] = []
        idx += 1
    elif line.startswith("RESTRICT: "):
        rest = line[len("RESTRICT: "):]
        restricted_actions = [s.strip() for s in rest.split(",")]
        idx += 1
    else:
        raise ParseError(f"Expected 'RESTRICT:' but got: {line!r}")

    # ── REPLAN section
    if idx >= len(lines):
        raise ParseError("Missing REPLAN section")

    line = lines[idx].strip()
    if line.startswith("REPLAN: "):
        value = line[len("REPLAN: "):]
        if value not in VALID_REPLAN_VALUES:
            raise ParseError(f"Invalid REPLAN value: {value!r}")
        force_replan = VALID_REPLAN_VALUES[value]
        idx += 1
    else:
        raise ParseError(f"Expected 'REPLAN:' but got: {line!r}")

    return {
        "anomalies": anomalies,
        "escalation": escalation,
        "restrictedActions": restricted_actions,
        "forceReplan": force_replan,
    }


def _parse_anomaly_line(line: str) -> dict[str, str]:
    """Parse a line like: @reasoner low-confidence "detail text" """
    m = re.match(
        r'^@([a-zA-Z0-9_-]+)\s+(low-confidence|unexpected-result|compound)\s+"((?:[^"\\]|\\.)*)"$',
        line,
    )
    if not m:
        raise ParseError(f"Invalid anomaly line: {line!r}")

    module_id = m.group(1)
    anomaly_type = m.group(2)
    detail = m.group(3).replace('\\"', '"').replace('\\\\', '\\')

    return {
        "moduleId": module_id,
        "type": anomaly_type,
        "detail": detail,
    }


def _parse_quoted_string(s: str) -> str:
    """Parse a quoted string like '"hello world"' and return unquoted content."""
    s = s.strip()
    if not s.startswith('"') or not s.endswith('"'):
        raise ParseError(f"Expected quoted string but got: {s!r}")
    inner = s[1:-1]
    return inner.replace('\\"', '"').replace('\\\\', '\\')


def _parse_note(value: str) -> str | None:
    """Parse a NOTE value — either 'none' or a quoted string."""
    value = value.strip()
    if value == "none":
        return None
    if value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    return value  # tolerate unquoted notes


# ── Evaluator DSL Parser ─────────────────────────────────────


VALID_PROGRESS = {"on-track", "stagnant", "regressing"}
VALID_ACTION = {"continue", "replan", "escalate"}


def parse_evaluator_dsl(dsl: str) -> dict[str, Any] | None:
    """
    Parse an Evaluator DSL string into a structured dict.

    Expected format:
        PROGRESS: on-track | stagnant | regressing
        CONFIDENCE: <float 0-1>
        ACTION: continue | replan | escalate
        NOTE: "text" | none
    """
    try:
        return _parse_evaluator_strict(dsl)
    except ParseError:
        return None


def _parse_evaluator_strict(dsl: str) -> dict[str, Any]:
    lines = dsl.strip().split("\n")
    result: dict[str, Any] = {}

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("PROGRESS: "):
            val = line[len("PROGRESS: "):].strip()
            if val not in VALID_PROGRESS:
                raise ParseError(f"Invalid PROGRESS: {val!r}")
            result["progress"] = val
        elif line.startswith("CONFIDENCE: "):
            try:
                result["confidence"] = float(line[len("CONFIDENCE: "):].strip())
            except ValueError as e:
                raise ParseError(f"Invalid CONFIDENCE: {e}")
        elif line.startswith("ACTION: "):
            val = line[len("ACTION: "):].strip()
            if val not in VALID_ACTION:
                raise ParseError(f"Invalid ACTION: {val!r}")
            result["action"] = val
        elif line.startswith("NOTE: "):
            result["note"] = _parse_note(line[len("NOTE: "):])
        else:
            raise ParseError(f"Unexpected line: {line!r}")

    for key in ("progress", "confidence", "action"):
        if key not in result:
            raise ParseError(f"Missing required field: {key}")

    return result


# ── Observer DSL Parser ──────────────────────────────────────


VALID_PRIORITY = {"high", "medium", "low"}


def parse_observer_dsl(dsl: str) -> dict[str, Any] | None:
    """
    Parse an Observer DSL string into a structured dict.

    Expected format:
        PRIORITY: high | medium | low
        FOCUS: module1, module2, ...
        NOVELTY: <float 0-1>
        NOTE: "text" | none
    """
    try:
        return _parse_observer_strict(dsl)
    except ParseError:
        return None


def _parse_observer_strict(dsl: str) -> dict[str, Any]:
    lines = dsl.strip().split("\n")
    result: dict[str, Any] = {}

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if line.startswith("PRIORITY: "):
            val = line[len("PRIORITY: "):].strip()
            if val not in VALID_PRIORITY:
                raise ParseError(f"Invalid PRIORITY: {val!r}")
            result["priority"] = val
        elif line.startswith("FOCUS: "):
            modules = [m.strip() for m in line[len("FOCUS: "):].split(",")]
            result["focus"] = sorted(modules)
        elif line.startswith("NOVELTY: "):
            try:
                result["novelty"] = float(line[len("NOVELTY: "):].strip())
            except ValueError as e:
                raise ParseError(f"Invalid NOVELTY: {e}")
        elif line.startswith("NOTE: "):
            result["note"] = _parse_note(line[len("NOTE: "):])
        else:
            raise ParseError(f"Unexpected line: {line!r}")

    for key in ("priority", "focus", "novelty"):
        if key not in result:
            raise ParseError(f"Missing required field: {key}")

    return result


# ── Semantic matchers per DSL ────────────────────────────────


def evaluator_reports_match(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    """Semantic match for evaluator: progress + action must match."""
    if actual.get("progress") != expected.get("progress"):
        return False
    if actual.get("action") != expected.get("action"):
        return False
    return True


def observer_reports_match(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    """Semantic match for observer: priority + focus set must match."""
    if actual.get("priority") != expected.get("priority"):
        return False
    if sorted(actual.get("focus", [])) != sorted(expected.get("focus", [])):
        return False
    return True


# ── Accuracy Metrics ───────────────────────────────────────────


def compute_parse_accuracy(
    outputs: list[str],
    parser_fn: Callable[[str], Any] | None = None,
) -> float:
    """
    Compute the fraction of outputs that successfully parse as valid Monitor DSL.

    Args:
        outputs: List of raw DSL strings to parse.
        parser_fn: Optional custom parser function. If None, uses parse_monitor_dsl.
                   Must return a truthy value on success, None/falsy on failure.

    Returns:
        Parse accuracy as a float in [0, 1].
    """
    if not outputs:
        return 0.0

    if parser_fn is None:
        parser_fn = parse_monitor_dsl

    successes = sum(1 for o in outputs if parser_fn(o) is not None)
    return successes / len(outputs)


def compute_semantic_accuracy(
    parsed_outputs: list[dict[str, Any] | None],
    expected_reports: list[dict[str, Any]],
    match_fn: Callable[[dict[str, Any], dict[str, Any]], bool] | None = None,
) -> float:
    """
    Compute the fraction of parsed outputs that semantically match expected reports.

    When match_fn is None (default), uses the Monitor DSL matcher:
      - anomalies: same count, same types (order-insensitive by moduleId)
      - escalation: both None or both non-None
      - restrictedActions: same set of actions (order-insensitive)
      - forceReplan: exact match

    Args:
        parsed_outputs: List of parsed dicts (or None for failed parses).
        expected_reports: List of expected parsed dicts (same length).
        match_fn: Optional custom matcher function.

    Returns:
        Semantic accuracy as a float in [0, 1].
    """
    if not expected_reports:
        return 0.0

    if match_fn is None:
        match_fn = _reports_match

    matches = 0
    for parsed, expected in zip(parsed_outputs, expected_reports):
        if parsed is None or expected is None:
            continue
        if match_fn(parsed, expected):
            matches += 1

    return matches / len(expected_reports)


def _reports_match(actual: dict[str, Any], expected: dict[str, Any]) -> bool:
    """Check if two parsed MonitorReport dicts semantically match."""
    # forceReplan — exact match
    if actual.get("forceReplan") != expected.get("forceReplan"):
        return False

    # escalation — both None or both have a value (content can differ)
    actual_esc = actual.get("escalation")
    expected_esc = expected.get("escalation")
    if (actual_esc is None) != (expected_esc is None):
        return False

    # restrictedActions — same set (order-insensitive)
    actual_restrict = set(actual.get("restrictedActions", []))
    expected_restrict = set(expected.get("restrictedActions", []))
    if actual_restrict != expected_restrict:
        return False

    # anomalies — same count and types per module
    actual_anomalies = actual.get("anomalies", [])
    expected_anomalies = expected.get("anomalies", [])
    if len(actual_anomalies) != len(expected_anomalies):
        return False

    # Compare by (moduleId, type) pairs — order-insensitive
    actual_pairs = sorted(
        (a.get("moduleId", ""), a.get("type", "")) for a in actual_anomalies
    )
    expected_pairs = sorted(
        (a.get("moduleId", ""), a.get("type", "")) for a in expected_anomalies
    )
    if actual_pairs != expected_pairs:
        return False

    return True
