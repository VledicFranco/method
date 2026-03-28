#!/usr/bin/env python3
"""
Generate training corpus of (input_text, dsl_output) pairs.

Reads the 101 traces from phase-1, encodes each MonitorReport as DSL,
then generates additional synthetic examples to reach >= 500 total pairs.

Output: corpus/monitor-v2/train.jsonl
"""

import json
import os
import random
import sys
from pathlib import Path
from typing import Any

# ── Paths ───────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
TRACES_PATH = PHASE2_DIR.parent / "phase-1-llm-monitor" / "traces" / "monitor-v2-traces.jsonl"
CORPUS_DIR = PHASE2_DIR / "corpus" / "monitor-v2"
OUTPUT_PATH = CORPUS_DIR / "train.jsonl"

# ── DSL Encoder (mirrors TypeScript encodeMonitorReport) ────────

ANOMALY_TYPES = ["low-confidence", "unexpected-result", "compound"]

MODULE_IDS = [
    "observer", "reasoner", "actor", "memory",
    "evaluator", "planner", "monitor", "reflector",
    "llm-monitor",
]

ACTIONS = ["Edit", "Bash", "Read", "Glob", "Grep", "Write"]

RESTRICTED_ACTIONS = [
    "Edit", "Bash", "Read", "Write", "Glob", "Grep",
    "file-delete", "git-push", "git-commit", "deploy",
    "network-request", "shell-exec",
]

DETAIL_TEMPLATES_LOW_CONF = [
    "Confidence {conf} below threshold {thresh}",
    "Low confidence score {conf} (threshold: {thresh})",
    "Module confidence dropped to {conf}, below minimum {thresh}",
]

DETAIL_TEMPLATES_UNEXPECTED = [
    "Actor reported unexpected result",
    "Actor reported unexpected result from action: {action}",
    "Unexpected result from action: {action}",
    "Tool returned error status for {action}",
    "Action {action} produced unexpected output",
]

DETAIL_TEMPLATES_COMPOUND = [
    "Compound anomaly: low confidence combined with unexpected result",
    "Compound anomaly: multiple failures detected across modules",
    "Compound anomaly: cascading errors from {mod1} to {mod2}",
    "Multiple anomalies detected requiring escalation",
]

ESCALATION_TEMPLATES = [
    "Compound anomaly: low confidence combined with unexpected result",
    "Multiple anomalies detected — recommend strategy review",
    "Critical failure in {module} — immediate attention required",
    "Cascading errors detected across {n} modules",
    "System integrity compromised — escalating to orchestrator",
    "Repeated failures in {module} suggest systemic issue",
]

EFFORT_LEVELS = ["low", "medium", "high"]


def escape_detail(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def encode_monitor_report(report: dict) -> str:
    """Encode a MonitorReport dict as a DSL string."""
    lines = []

    anomalies = report.get("anomalies", [])
    if len(anomalies) == 0:
        lines.append("ANOMALIES: none")
    else:
        lines.append("ANOMALIES:")
        for a in anomalies:
            lines.append(f'@{a["moduleId"]} {a["type"]} "{escape_detail(a["detail"])}"')

    escalation = report.get("escalation")
    if escalation is None:
        lines.append("ESCALATE: none")
    else:
        lines.append(f'ESCALATE: "{escape_detail(escalation)}"')

    restricted = report.get("restrictedActions", [])
    if len(restricted) == 0:
        lines.append("RESTRICT: none")
    else:
        lines.append(f'RESTRICT: {", ".join(restricted)}')

    force_replan = report.get("forceReplan", False)
    lines.append(f'REPLAN: {"yes" if force_replan else "no"}')

    return "\n".join(lines)


def compact_signals(signals: dict) -> str:
    """Create a compact text representation of AggregatedSignals for SLM input."""
    if not signals:
        return "SIGNALS: empty"

    parts = []
    for mod_id, sig in signals.items():
        sig_type = sig.get("type", "unknown")
        fields = []
        if sig_type == "reasoner":
            fields.append(f"conf={sig.get('confidence', '?')}")
            if sig.get("conflictDetected"):
                fields.append("conflict")
            fields.append(f"effort={sig.get('effortLevel', '?')}")
        elif sig_type == "actor":
            fields.append(f"action={sig.get('actionTaken', '?')}")
            fields.append(f"ok={sig.get('success', '?')}")
            if sig.get("unexpectedResult"):
                fields.append("unexpected")
        elif sig_type == "observer":
            fields.append(f"novelty={sig.get('noveltyScore', '?')}")
            fields.append(f"processed={sig.get('inputProcessed', '?')}")
        elif sig_type == "monitor":
            if sig.get("anomalyDetected"):
                fields.append("anomaly-detected")
            if sig.get("escalation"):
                fields.append(f"esc={sig['escalation']}")
        elif sig_type == "evaluator":
            fields.append(f"progress={sig.get('estimatedProgress', '?')}")
            if sig.get("diminishingReturns"):
                fields.append("diminishing")
        elif sig_type == "memory":
            fields.append(f"retrievals={sig.get('retrievalCount', '?')}")
            fields.append(f"relevance={sig.get('relevanceScore', '?')}")
        else:
            # Generic: include confidence if present
            if "confidence" in sig:
                fields.append(f"conf={sig['confidence']}")

        parts.append(f"[{mod_id}:{sig_type}] {' '.join(fields)}")

    return "SIGNALS:\n" + "\n".join(parts)


# ── Trace-based corpus entries ──────────────────────────────────

def load_trace_entries() -> list[dict]:
    """Load trace records and convert to (input, output) pairs."""
    entries = []
    with open(TRACES_PATH, "r") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            trace = json.loads(line)
            input_text = compact_signals(trace["input"])
            output_dsl = encode_monitor_report(trace["output"])
            entries.append({"input": input_text, "output": output_dsl})
    return entries


# ── Synthetic generation ────────────────────────────────────────

def random_confidence() -> float:
    return round(random.uniform(0.0, 1.0), 2)


def random_low_confidence() -> float:
    return round(random.uniform(0.0, 0.29), 2)


def random_high_confidence() -> float:
    return round(random.uniform(0.3, 1.0), 2)


def make_reasoner_signal(mod_id: str, confidence: float, conflict: bool = False) -> dict:
    return {
        "type": "reasoner",
        "source": mod_id,
        "timestamp": random.randint(1700000000000, 1800000000000),
        "confidence": confidence,
        "conflictDetected": conflict,
        "effortLevel": random.choice(EFFORT_LEVELS),
    }


def make_actor_signal(mod_id: str, success: bool, unexpected: bool, action: str | None = None) -> dict:
    return {
        "type": "actor",
        "source": mod_id,
        "timestamp": random.randint(1700000000000, 1800000000000),
        "actionTaken": action or random.choice(ACTIONS),
        "success": success,
        "unexpectedResult": unexpected,
    }


def make_observer_signal(mod_id: str) -> dict:
    return {
        "type": "observer",
        "source": mod_id,
        "timestamp": random.randint(1700000000000, 1800000000000),
        "inputProcessed": True,
        "noveltyScore": round(random.uniform(0.0, 1.0), 2),
    }


def make_detail_low_conf(conf: float) -> str:
    thresh = 0.3
    tpl = random.choice(DETAIL_TEMPLATES_LOW_CONF)
    return tpl.format(conf=conf, thresh=thresh)


def make_detail_unexpected(action: str | None = None) -> str:
    tpl = random.choice(DETAIL_TEMPLATES_UNEXPECTED)
    act = action or random.choice(ACTIONS)
    return tpl.format(action=act)


def make_detail_compound() -> str:
    tpl = random.choice(DETAIL_TEMPLATES_COMPOUND)
    mods = random.sample(MODULE_IDS, min(2, len(MODULE_IDS)))
    return tpl.format(mod1=mods[0], mod2=mods[1] if len(mods) > 1 else mods[0], n=random.randint(2, 5))


def make_escalation(module: str | None = None) -> str:
    tpl = random.choice(ESCALATION_TEMPLATES)
    mod = module or random.choice(MODULE_IDS)
    return tpl.format(module=mod, n=random.randint(2, 5))


def generate_clean_report() -> tuple[dict, dict]:
    """Generate a clean report (no anomalies)."""
    # Random signals — normal operation
    signals = {}
    num_modules = random.randint(1, 5)
    mods = random.sample(MODULE_IDS, min(num_modules, len(MODULE_IDS)))

    for mod in mods:
        sig_type = random.choice(["reasoner", "actor", "observer"])
        if sig_type == "reasoner":
            signals[mod] = make_reasoner_signal(mod, random_high_confidence())
        elif sig_type == "actor":
            signals[mod] = make_actor_signal(mod, success=True, unexpected=False)
        else:
            signals[mod] = make_observer_signal(mod)

    report = {
        "anomalies": [],
        "escalation": None,
        "restrictedActions": [],
        "forceReplan": False,
    }
    return signals, report


def generate_low_confidence_report() -> tuple[dict, dict]:
    """Generate a report with a single low-confidence anomaly."""
    mod = random.choice(MODULE_IDS)
    conf = random_low_confidence()
    signals = {mod: make_reasoner_signal(mod, conf)}

    # Maybe add a normal actor
    if random.random() > 0.5:
        actor_mod = "actor" if mod != "actor" else "actor-2"
        action = random.choice(ACTIONS)
        signals[actor_mod] = make_actor_signal(actor_mod, success=True, unexpected=False, action=action)

    report = {
        "anomalies": [
            {"moduleId": mod, "type": "low-confidence", "detail": make_detail_low_conf(conf)}
        ],
        "escalation": None,
        "restrictedActions": random.choice([[], [random.choice(RESTRICTED_ACTIONS)]]),
        "forceReplan": random.choice([True, False]),
    }
    return signals, report


def generate_unexpected_result_report() -> tuple[dict, dict]:
    """Generate a report with a single unexpected-result anomaly."""
    action = random.choice(ACTIONS)
    signals = {"actor": make_actor_signal("actor", success=False, unexpected=True, action=action)}

    # Maybe add a normal reasoner
    if random.random() > 0.5:
        signals["reasoner"] = make_reasoner_signal("reasoner", random_high_confidence())

    report = {
        "anomalies": [
            {"moduleId": "actor", "type": "unexpected-result", "detail": make_detail_unexpected(action)}
        ],
        "escalation": None,
        "restrictedActions": random.choice([[], [action]]),
        "forceReplan": random.choice([True, False]),
    }
    return signals, report


def generate_compound_report() -> tuple[dict, dict]:
    """Generate a compound anomaly report."""
    conf = random_low_confidence()
    action = random.choice(ACTIONS)
    monitor_mod = random.choice(["llm-monitor", "monitor"])

    signals = {
        "reasoner": make_reasoner_signal("reasoner", conf, conflict=True),
        "actor": make_actor_signal("actor", success=False, unexpected=True, action=action),
    }

    detail_compound = make_detail_compound()
    escalation = detail_compound if random.random() > 0.3 else make_escalation()

    num_restrict = random.randint(0, 3)
    restricted = random.sample(RESTRICTED_ACTIONS, min(num_restrict, len(RESTRICTED_ACTIONS)))

    report = {
        "anomalies": [
            {"moduleId": "reasoner", "type": "low-confidence", "detail": make_detail_low_conf(conf)},
            {"moduleId": "actor", "type": "unexpected-result", "detail": make_detail_unexpected(action)},
            {"moduleId": monitor_mod, "type": "compound", "detail": detail_compound},
        ],
        "escalation": escalation,
        "restrictedActions": restricted,
        "forceReplan": True,
    }
    return signals, report


def generate_multi_anomaly_report() -> tuple[dict, dict]:
    """Generate a report with 2 anomalies (not necessarily compound)."""
    conf = random_low_confidence()
    action = random.choice(ACTIONS)
    mod1 = random.choice(["reasoner", "planner", "evaluator"])
    mod2 = "actor"

    signals = {
        mod1: make_reasoner_signal(mod1, conf),
        mod2: make_actor_signal(mod2, success=False, unexpected=True, action=action),
    }

    anomalies = [
        {"moduleId": mod1, "type": "low-confidence", "detail": make_detail_low_conf(conf)},
        {"moduleId": mod2, "type": "unexpected-result", "detail": make_detail_unexpected(action)},
    ]

    report = {
        "anomalies": anomalies,
        "escalation": make_escalation() if random.random() > 0.5 else None,
        "restrictedActions": random.sample(RESTRICTED_ACTIONS, random.randint(0, 2)),
        "forceReplan": random.choice([True, False]),
    }
    return signals, report


def generate_synthetic_entries(count: int) -> list[dict]:
    """Generate `count` synthetic (input, output) pairs with balanced distribution."""
    entries = []
    # Distribution: 40% clean, 20% low-conf, 15% unexpected, 15% compound, 10% multi
    generators = [
        (generate_clean_report, 0.40),
        (generate_low_confidence_report, 0.20),
        (generate_unexpected_result_report, 0.15),
        (generate_compound_report, 0.15),
        (generate_multi_anomaly_report, 0.10),
    ]

    for _ in range(count):
        r = random.random()
        cumulative = 0.0
        gen_fn = generators[0][0]
        for fn, weight in generators:
            cumulative += weight
            if r < cumulative:
                gen_fn = fn
                break

        signals, report = gen_fn()
        input_text = compact_signals(signals)
        output_dsl = encode_monitor_report(report)
        entries.append({"input": input_text, "output": output_dsl})

    return entries


# ── Main ────────────────────────────────────────────────────────

def main():
    random.seed(42)  # Reproducible

    # Load trace-based entries
    trace_entries = load_trace_entries()
    print(f"Loaded {len(trace_entries)} trace-based entries")

    # Generate synthetic entries to reach >= 500
    needed = max(0, 500 - len(trace_entries))
    synthetic_entries = generate_synthetic_entries(needed + 100)  # Generate extra for diversity
    print(f"Generated {len(synthetic_entries)} synthetic entries")

    all_entries = trace_entries + synthetic_entries
    print(f"Total corpus: {len(all_entries)} entries")

    # Write corpus
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        for entry in all_entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"Written to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
