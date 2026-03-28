#!/usr/bin/env python3
"""
Validate the generated training corpus.

For each entry in corpus/monitor-v2/train.jsonl:
  1. Parse the DSL output using a Python regex parser (mirrors the peggy grammar)
  2. Verify structural validity (all required fields present, correct types)
  3. For a random sample, verify semantic consistency

Output: results/dsl-eval.json
"""

import json
import os
import random
import re
import sys
from pathlib import Path
from typing import Any

# ── Paths ───────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
CORPUS_PATH = PHASE2_DIR / "corpus" / "monitor-v2" / "train.jsonl"
RESULTS_DIR = PHASE2_DIR / "results"
RESULTS_PATH = RESULTS_DIR / "dsl-eval.json"

# ── Valid values ────────────────────────────────────────────────

VALID_ANOMALY_TYPES = {"low-confidence", "unexpected-result", "compound"}
VALID_BOOLEANS = {"yes": True, "no": False}

# ── Python DSL Parser (mirrors peggy grammar) ──────────────────

class ParseError(Exception):
    pass


def parse_dsl(dsl: str) -> dict:
    """
    Parse a DSL string into a MonitorReport dict.
    Mirrors the peggy grammar but uses line-based regex parsing.
    """
    lines = dsl.strip().split("\n")
    idx = 0

    # ── Parse ANOMALIES section
    if idx >= len(lines):
        raise ParseError("Missing ANOMALIES section")

    line = lines[idx].strip()
    if line == "ANOMALIES: none":
        anomalies = []
        idx += 1
    elif line == "ANOMALIES:":
        idx += 1
        anomalies = []
        # Parse anomaly lines starting with @
        while idx < len(lines) and lines[idx].strip().startswith("@"):
            anomaly = parse_anomaly_line(lines[idx].strip())
            anomalies.append(anomaly)
            idx += 1
        if len(anomalies) == 0:
            raise ParseError("ANOMALIES: section has no entries after header")
    else:
        raise ParseError(f"Expected 'ANOMALIES:' but got: {line!r}")

    # ── Parse ESCALATE section
    if idx >= len(lines):
        raise ParseError("Missing ESCALATE section")

    line = lines[idx].strip()
    if line == "ESCALATE: none":
        escalation = None
        idx += 1
    elif line.startswith("ESCALATE: "):
        rest = line[len("ESCALATE: "):]
        escalation = parse_quoted_string(rest)
        idx += 1
    else:
        raise ParseError(f"Expected 'ESCALATE:' but got: {line!r}")

    # ── Parse RESTRICT section
    if idx >= len(lines):
        raise ParseError("Missing RESTRICT section")

    line = lines[idx].strip()
    if line == "RESTRICT: none":
        restricted_actions = []
        idx += 1
    elif line.startswith("RESTRICT: "):
        rest = line[len("RESTRICT: "):]
        restricted_actions = [s.strip() for s in rest.split(",")]
        idx += 1
    else:
        raise ParseError(f"Expected 'RESTRICT:' but got: {line!r}")

    # ── Parse REPLAN section
    if idx >= len(lines):
        raise ParseError("Missing REPLAN section")

    line = lines[idx].strip()
    if line.startswith("REPLAN: "):
        value = line[len("REPLAN: "):]
        if value not in VALID_BOOLEANS:
            raise ParseError(f"Invalid REPLAN value: {value!r}")
        force_replan = VALID_BOOLEANS[value]
        idx += 1
    else:
        raise ParseError(f"Expected 'REPLAN:' but got: {line!r}")

    return {
        "anomalies": anomalies,
        "escalation": escalation,
        "restrictedActions": restricted_actions,
        "forceReplan": force_replan,
    }


def parse_anomaly_line(line: str) -> dict:
    """Parse a line like: @reasoner low-confidence "detail text" """
    # Pattern: @<identifier> <anomaly-type> "<detail>"
    m = re.match(r'^@([a-zA-Z0-9_-]+)\s+(low-confidence|unexpected-result|compound)\s+"((?:[^"\\]|\\.)*)"$', line)
    if not m:
        raise ParseError(f"Invalid anomaly line: {line!r}")

    module_id = m.group(1)
    anomaly_type = m.group(2)
    detail = m.group(3).replace('\\"', '"').replace('\\\\', '\\')

    if anomaly_type not in VALID_ANOMALY_TYPES:
        raise ParseError(f"Invalid anomaly type: {anomaly_type!r}")

    return {
        "moduleId": module_id,
        "type": anomaly_type,
        "detail": detail,
    }


def parse_quoted_string(s: str) -> str:
    """Parse a quoted string like '"hello world"' and return the unquoted content."""
    s = s.strip()
    if not s.startswith('"') or not s.endswith('"'):
        raise ParseError(f"Expected quoted string but got: {s!r}")
    inner = s[1:-1]
    return inner.replace('\\"', '"').replace('\\\\', '\\')


# ── Semantic Validation ─────────────────────────────────────────

def validate_semantics(report: dict) -> list[str]:
    """Check semantic validity of a parsed report. Returns list of issues."""
    issues = []

    # Check anomalies
    anomalies = report.get("anomalies", [])
    if not isinstance(anomalies, list):
        issues.append("anomalies is not a list")
    else:
        for i, a in enumerate(anomalies):
            if not isinstance(a, dict):
                issues.append(f"anomaly[{i}] is not a dict")
                continue
            if "moduleId" not in a:
                issues.append(f"anomaly[{i}] missing moduleId")
            if "type" not in a:
                issues.append(f"anomaly[{i}] missing type")
            elif a["type"] not in VALID_ANOMALY_TYPES:
                issues.append(f"anomaly[{i}] invalid type: {a['type']}")
            if "detail" not in a:
                issues.append(f"anomaly[{i}] missing detail")
            elif not isinstance(a["detail"], str):
                issues.append(f"anomaly[{i}] detail is not a string")

    # Check escalation
    esc = report.get("escalation")
    if esc is not None and not isinstance(esc, str):
        issues.append(f"escalation is not string or None: {type(esc)}")

    # Check restrictedActions
    restricted = report.get("restrictedActions", [])
    if not isinstance(restricted, list):
        issues.append("restrictedActions is not a list")
    else:
        for i, r in enumerate(restricted):
            if not isinstance(r, str):
                issues.append(f"restrictedActions[{i}] is not a string")
            elif not re.match(r'^[a-zA-Z0-9_-]+$', r):
                issues.append(f"restrictedActions[{i}] has invalid characters: {r!r}")

    # Check forceReplan
    if not isinstance(report.get("forceReplan"), bool):
        issues.append(f"forceReplan is not a boolean: {type(report.get('forceReplan'))}")

    return issues


# ── Main ────────────────────────────────────────────────────────

def main():
    random.seed(42)

    if not CORPUS_PATH.exists():
        print(f"ERROR: Corpus not found at {CORPUS_PATH}")
        print("Run generate-corpus.py first.")
        sys.exit(1)

    # Load corpus
    entries = []
    with open(CORPUS_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))

    total = len(entries)
    print(f"Loaded {total} corpus entries")

    # Parse all entries
    parse_successes = 0
    parse_failures = 0
    failure_details = []

    for i, entry in enumerate(entries):
        dsl = entry.get("output", "")
        try:
            parsed = parse_dsl(dsl)
            parse_successes += 1
        except ParseError as e:
            parse_failures += 1
            if len(failure_details) < 10:  # Limit logged failures
                failure_details.append({"index": i, "error": str(e), "dsl": dsl[:200]})

    parse_success_rate = parse_successes / total if total > 0 else 0.0
    print(f"Parse results: {parse_successes}/{total} succeeded ({parse_success_rate:.1%})")

    if failure_details:
        print(f"\nFirst {len(failure_details)} parse failures:")
        for fd in failure_details:
            print(f"  [{fd['index']}] {fd['error']}")
            print(f"       DSL: {fd['dsl'][:100]}...")

    # Semantic validation on random sample
    sample_size = min(100, total)
    sample_indices = random.sample(range(total), sample_size)

    semantic_pass = 0
    semantic_fail = 0
    semantic_issues = []

    for idx in sample_indices:
        dsl = entries[idx].get("output", "")
        try:
            parsed = parse_dsl(dsl)
            issues = validate_semantics(parsed)
            if issues:
                semantic_fail += 1
                if len(semantic_issues) < 10:
                    semantic_issues.append({"index": idx, "issues": issues})
            else:
                semantic_pass += 1
        except ParseError:
            semantic_fail += 1

    semantic_accuracy = semantic_pass / sample_size if sample_size > 0 else 0.0
    print(f"\nSemantic validation ({sample_size} samples): {semantic_pass}/{sample_size} ({semantic_accuracy:.1%})")

    if semantic_issues:
        print(f"\nSemantic issues (first {len(semantic_issues)}):")
        for si in semantic_issues:
            print(f"  [{si['index']}] {si['issues']}")

    # Write results
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    results = {
        "total_entries": total,
        "parse_success_rate": round(parse_success_rate, 4),
        "semantic_accuracy_rate": round(semantic_accuracy, 4),
        "revision_number": 1,
        "grammar_file": "grammars/monitor-v2.peggy",
    }

    with open(RESULTS_PATH, "w") as f:
        json.dump(results, f, indent=2)
        f.write("\n")

    print(f"\nResults written to {RESULTS_PATH}")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
