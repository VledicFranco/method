#!/usr/bin/env python3
"""
Augment the base corpus with adversarial/boundary cases.

Reads corpus/monitor-v2/train.jsonl, generates additional edge cases
and stress tests, writes:
  - corpus/monitor-v2/train-augmented.jsonl  (>= 5000 entries)
  - corpus/monitor-v2/holdout.jsonl          (20% of augmented, held out)

The augmented set targets diversity across:
  - Empty anomalies with escalation (edge case)
  - Maximum-length detail strings
  - All 3 anomaly types in one report
  - Unusual module IDs
  - Many restricted actions (5+)
  - forceReplan=true with no anomalies (contradictory but valid)
"""

import json
import os
import random
import string
import sys
from pathlib import Path
from typing import Any

# ── Paths ───────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
BASE_CORPUS_PATH = PHASE2_DIR / "corpus" / "monitor-v2" / "train.jsonl"
AUG_CORPUS_PATH = PHASE2_DIR / "corpus" / "monitor-v2" / "train-augmented.jsonl"
HOLDOUT_PATH = PHASE2_DIR / "corpus" / "monitor-v2" / "holdout.jsonl"

# ── Constants ───────────────────────────────────────────────────

ANOMALY_TYPES = ["low-confidence", "unexpected-result", "compound"]

STANDARD_MODULES = [
    "observer", "reasoner", "actor", "memory",
    "evaluator", "planner", "monitor", "reflector",
    "llm-monitor",
]

UNUSUAL_MODULES = [
    "custom-analyzer", "sentiment-tracker", "context-bridge",
    "schema-validator", "goal-manager", "resource-limiter",
    "safety-gate", "meta-controller", "attention-router",
    "priority-queue", "trace-logger", "abort-handler",
    "module-0", "module-1", "module-2", "module-3",
    "agent-core", "reflection-engine", "tool-proxy",
]

ALL_MODULES = STANDARD_MODULES + UNUSUAL_MODULES

ACTIONS = [
    "Edit", "Bash", "Read", "Glob", "Grep", "Write",
    "file-delete", "git-push", "git-commit", "deploy",
    "network-request", "shell-exec", "git-pull",
    "docker-run", "npm-install", "db-query",
    "api-call", "config-update", "log-rotate",
]

EFFORT_LEVELS = ["low", "medium", "high"]

DETAIL_FRAGMENTS = [
    "Confidence {conf} below threshold 0.3",
    "Low confidence score {conf} detected",
    "Module confidence dropped to {conf}",
    "Actor reported unexpected result",
    "Unexpected result from action: {action}",
    "Tool returned error status for {action}",
    "Compound anomaly: low confidence combined with unexpected result",
    "Multiple anomalies detected requiring escalation",
    "Cascading errors from {mod} detected",
    "System integrity check failed for module {mod}",
    "Resource limit exceeded in {mod}",
    "Timeout during {action} execution",
    "Permission denied for {action}",
    "State invariant violation in {mod}",
    "Output schema mismatch from {mod}",
]

ESCALATION_MESSAGES = [
    "Compound anomaly: low confidence combined with unexpected result",
    "Multiple anomalies detected — recommend strategy review",
    "Critical failure in {mod} — immediate attention required",
    "Cascading errors detected across multiple modules",
    "System integrity compromised — escalating to orchestrator",
    "Repeated failures suggest systemic issue in {mod}",
    "Safety threshold breached — restricting dangerous actions",
    "Agent appears stuck in loop — recommend replan",
    "Resource exhaustion imminent — scaling back operations",
    "Trust score below minimum for continued autonomous operation",
]


def escape_detail(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def encode_monitor_report(report: dict) -> str:
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
        elif sig_type == "monitor":
            if sig.get("anomalyDetected"):
                fields.append("anomaly-detected")
        else:
            if "confidence" in sig:
                fields.append(f"conf={sig['confidence']}")
        parts.append(f"[{mod_id}:{sig_type}] {' '.join(fields)}")
    return "SIGNALS:\n" + "\n".join(parts)


def random_detail(conf: float = 0.1, action: str = "Read", mod: str = "reasoner") -> str:
    tpl = random.choice(DETAIL_FRAGMENTS)
    return tpl.format(conf=conf, action=action, mod=mod)


def random_escalation(mod: str = "reasoner") -> str:
    tpl = random.choice(ESCALATION_MESSAGES)
    return tpl.format(mod=mod)


def make_reasoner_signal(mod_id: str, confidence: float) -> dict:
    return {
        "type": "reasoner", "source": mod_id,
        "timestamp": random.randint(1700000000000, 1800000000000),
        "confidence": confidence,
        "conflictDetected": random.choice([True, False]),
        "effortLevel": random.choice(EFFORT_LEVELS),
    }


def make_actor_signal(mod_id: str, action: str, success: bool, unexpected: bool) -> dict:
    return {
        "type": "actor", "source": mod_id,
        "timestamp": random.randint(1700000000000, 1800000000000),
        "actionTaken": action, "success": success, "unexpectedResult": unexpected,
    }


# ── Adversarial / Edge Case Generators ─────────────────────────

def gen_empty_anomalies_with_escalation() -> dict:
    """Edge: no anomalies but escalation present."""
    signals = {"reasoner": make_reasoner_signal("reasoner", round(random.uniform(0.3, 1.0), 2))}
    report = {
        "anomalies": [],
        "escalation": random_escalation(),
        "restrictedActions": [],
        "forceReplan": random.choice([True, False]),
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_max_length_detail() -> dict:
    """Stress: very long detail strings (200+ chars)."""
    mod = random.choice(ALL_MODULES)
    # Generate a long but valid detail string (no quotes or backslashes)
    words = ["error", "detected", "in", "module", "processing", "stage",
             "unexpected", "behavior", "observed", "during", "execution",
             "of", "the", "analysis", "pipeline", "with", "confidence",
             "score", "below", "threshold", "requiring", "immediate",
             "attention", "from", "the", "orchestrator", "system"]
    detail = " ".join(random.choice(words) for _ in range(random.randint(30, 60)))

    signals = {mod: make_reasoner_signal(mod, round(random.uniform(0.0, 0.29), 2))}
    atype = random.choice(ANOMALY_TYPES)
    report = {
        "anomalies": [{"moduleId": mod, "type": atype, "detail": detail}],
        "escalation": None,
        "restrictedActions": [],
        "forceReplan": False,
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_all_three_types() -> dict:
    """Edge: all 3 anomaly types in one report."""
    mods = random.sample(ALL_MODULES, 3)
    conf = round(random.uniform(0.0, 0.29), 2)
    action = random.choice(ACTIONS)
    anomalies = [
        {"moduleId": mods[0], "type": "low-confidence",
         "detail": f"Confidence {conf} below threshold 0.3"},
        {"moduleId": mods[1], "type": "unexpected-result",
         "detail": f"Unexpected result from action: {action}"},
        {"moduleId": mods[2], "type": "compound",
         "detail": f"Compound anomaly: cascading errors from {mods[0]} to {mods[1]}"},
    ]
    signals = {
        mods[0]: make_reasoner_signal(mods[0], conf),
        mods[1]: make_actor_signal(mods[1], action, False, True),
    }
    report = {
        "anomalies": anomalies,
        "escalation": random_escalation(mods[2]),
        "restrictedActions": random.sample(ACTIONS, random.randint(1, 3)),
        "forceReplan": True,
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_unusual_module_ids() -> dict:
    """Edge: non-standard module IDs."""
    mod = random.choice(UNUSUAL_MODULES)
    atype = random.choice(ANOMALY_TYPES)
    conf = round(random.uniform(0.0, 0.29), 2)
    detail = random_detail(conf=conf, mod=mod)

    signals = {mod: make_reasoner_signal(mod, conf)}
    report = {
        "anomalies": [{"moduleId": mod, "type": atype, "detail": detail}],
        "escalation": random.choice([None, random_escalation(mod)]),
        "restrictedActions": random.choice([[], random.sample(ACTIONS, 1)]),
        "forceReplan": random.choice([True, False]),
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_many_restricted_actions() -> dict:
    """Stress: 5+ restricted actions."""
    n = random.randint(5, 10)
    restricted = random.sample(ACTIONS, min(n, len(ACTIONS)))
    signals = {"actor": make_actor_signal("actor", restricted[0], False, True)}
    report = {
        "anomalies": [{"moduleId": "actor", "type": "unexpected-result",
                        "detail": f"Action {restricted[0]} produced unexpected output"}],
        "escalation": random_escalation("actor"),
        "restrictedActions": restricted,
        "forceReplan": True,
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_replan_no_anomalies() -> dict:
    """Edge: forceReplan=true with no anomalies (contradictory but valid)."""
    signals = {"reasoner": make_reasoner_signal("reasoner", round(random.uniform(0.3, 1.0), 2))}
    report = {
        "anomalies": [],
        "escalation": random.choice([None, random_escalation()]),
        "restrictedActions": random.choice([[], random.sample(ACTIONS, random.randint(1, 3))]),
        "forceReplan": True,
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_clean_report() -> dict:
    """Normal: clean report with varied signals."""
    num_mods = random.randint(1, 6)
    mods = random.sample(ALL_MODULES, min(num_mods, len(ALL_MODULES)))
    signals = {}
    for mod in mods:
        if random.random() > 0.5:
            signals[mod] = make_reasoner_signal(mod, round(random.uniform(0.3, 1.0), 2))
        else:
            signals[mod] = make_actor_signal(mod, random.choice(ACTIONS), True, False)
    report = {
        "anomalies": [],
        "escalation": None,
        "restrictedActions": [],
        "forceReplan": False,
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_single_low_conf() -> dict:
    """Common: single low-confidence anomaly."""
    mod = random.choice(ALL_MODULES)
    conf = round(random.uniform(0.0, 0.29), 2)
    signals = {mod: make_reasoner_signal(mod, conf)}
    restricted = random.choice([[], [random.choice(ACTIONS)]])
    report = {
        "anomalies": [{"moduleId": mod, "type": "low-confidence",
                        "detail": f"Confidence {conf} below threshold 0.3"}],
        "escalation": None,
        "restrictedActions": restricted,
        "forceReplan": random.choice([True, False]),
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_single_unexpected() -> dict:
    """Common: single unexpected-result anomaly."""
    action = random.choice(ACTIONS)
    signals = {"actor": make_actor_signal("actor", action, False, True)}
    report = {
        "anomalies": [{"moduleId": "actor", "type": "unexpected-result",
                        "detail": f"Actor reported unexpected result from action: {action}"}],
        "escalation": None,
        "restrictedActions": random.choice([[], [action]]),
        "forceReplan": random.choice([True, False]),
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_compound() -> dict:
    """Common: compound anomaly with escalation."""
    conf = round(random.uniform(0.0, 0.29), 2)
    action = random.choice(ACTIONS)
    monitor_mod = random.choice(["llm-monitor", "monitor"])
    signals = {
        "reasoner": make_reasoner_signal("reasoner", conf),
        "actor": make_actor_signal("actor", action, False, True),
    }
    detail_compound = "Compound anomaly: low confidence combined with unexpected result"
    report = {
        "anomalies": [
            {"moduleId": "reasoner", "type": "low-confidence",
             "detail": f"Confidence {conf} below threshold 0.3"},
            {"moduleId": "actor", "type": "unexpected-result",
             "detail": f"Actor reported unexpected result from action: {action}"},
            {"moduleId": monitor_mod, "type": "compound", "detail": detail_compound},
        ],
        "escalation": detail_compound,
        "restrictedActions": random.sample(ACTIONS, random.randint(0, 3)),
        "forceReplan": True,
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


def gen_multi_anomaly_varied() -> dict:
    """Varied: 1-3 anomalies with random types."""
    n = random.randint(1, 3)
    mods = random.sample(ALL_MODULES, n)
    anomalies = []
    signals = {}
    for mod in mods:
        atype = random.choice(ANOMALY_TYPES)
        conf = round(random.uniform(0.0, 0.29), 2)
        action = random.choice(ACTIONS)
        detail = random_detail(conf=conf, action=action, mod=mod)
        anomalies.append({"moduleId": mod, "type": atype, "detail": detail})
        if atype == "unexpected-result":
            signals[mod] = make_actor_signal(mod, action, False, True)
        else:
            signals[mod] = make_reasoner_signal(mod, conf)

    report = {
        "anomalies": anomalies,
        "escalation": random.choice([None, random_escalation()]),
        "restrictedActions": random.sample(ACTIONS, random.randint(0, 4)),
        "forceReplan": random.choice([True, False]),
    }
    return {"input": compact_signals(signals), "output": encode_monitor_report(report)}


# ── Main ────────────────────────────────────────────────────────

def main():
    random.seed(123)  # Reproducible

    # Load base corpus
    base_entries = []
    if BASE_CORPUS_PATH.exists():
        with open(BASE_CORPUS_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    base_entries.append(json.loads(line))
    else:
        print(f"WARNING: Base corpus not found at {BASE_CORPUS_PATH}")
        print("Generating entirely from scratch.")

    print(f"Base corpus: {len(base_entries)} entries")

    # Target: >= 5000 total entries
    target = 5000
    needed = max(0, target - len(base_entries))

    # Generate adversarial/edge cases with specific proportions
    generators_with_weights = [
        (gen_clean_report, 0.25),            # Normal cases
        (gen_single_low_conf, 0.12),         # Low confidence
        (gen_single_unexpected, 0.10),        # Unexpected result
        (gen_compound, 0.10),                 # Compound
        (gen_multi_anomaly_varied, 0.10),     # Multi-anomaly varied
        (gen_empty_anomalies_with_escalation, 0.05),  # Edge: empty + escalation
        (gen_max_length_detail, 0.05),        # Stress: long details
        (gen_all_three_types, 0.06),          # Edge: all 3 types
        (gen_unusual_module_ids, 0.05),       # Edge: unusual modules
        (gen_many_restricted_actions, 0.05),  # Stress: many restrictions
        (gen_replan_no_anomalies, 0.07),      # Edge: replan without anomalies
    ]

    augmented_entries = []
    for _ in range(needed):
        r = random.random()
        cumulative = 0.0
        gen_fn = generators_with_weights[0][0]
        for fn, weight in generators_with_weights:
            cumulative += weight
            if r < cumulative:
                gen_fn = fn
                break
        augmented_entries.append(gen_fn())

    print(f"Generated {len(augmented_entries)} augmented entries")

    all_entries = base_entries + augmented_entries
    print(f"Total before split: {len(all_entries)} entries")

    # Shuffle for holdout split
    random.shuffle(all_entries)

    # 80/20 split
    holdout_size = len(all_entries) // 5
    holdout_entries = all_entries[:holdout_size]
    train_entries = all_entries[holdout_size:]

    print(f"Train split: {len(train_entries)} entries")
    print(f"Holdout split: {len(holdout_entries)} entries")

    # Write augmented training corpus
    CORPUS_DIR = AUG_CORPUS_PATH.parent
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)

    with open(AUG_CORPUS_PATH, "w") as f:
        for entry in train_entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    with open(HOLDOUT_PATH, "w") as f:
        for entry in holdout_entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"\nWritten train-augmented to {AUG_CORPUS_PATH}")
    print(f"Written holdout to {HOLDOUT_PATH}")

    # Quick stats
    anomaly_counts = {0: 0, 1: 0, 2: 0, 3: 0}
    escalation_count = 0
    replan_count = 0

    for entry in all_entries:
        dsl = entry["output"]
        if "ANOMALIES: none" in dsl:
            anomaly_counts[0] = anomaly_counts.get(0, 0) + 1
        else:
            n = dsl.count("\n@")
            anomaly_counts[n] = anomaly_counts.get(n, 0) + 1
        if "ESCALATE: none" not in dsl:
            escalation_count += 1
        if "REPLAN: yes" in dsl:
            replan_count += 1

    print(f"\nDistribution:")
    for k in sorted(anomaly_counts.keys()):
        print(f"  {k} anomalies: {anomaly_counts[k]}")
    print(f"  With escalation: {escalation_count}")
    print(f"  With replan: {replan_count}")


if __name__ == "__main__":
    main()
