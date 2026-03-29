#!/usr/bin/env python3
"""
Augment corpus v2 — causally consistent training data.

Key fix from Run 1-2 analysis: restrictedActions and forceReplan were randomly
assigned with no causal link to input signals. The model learned anomaly detection
(correct moduleId + type from signals) but couldn't learn restrict/replan because
the mapping was random noise.

v2 rules (deterministic):
  - restrictedActions = actions from unexpected-result anomalies (the action that failed)
  - forceReplan = true when compound anomaly OR >= 2 anomalies
  - escalation = present when forceReplan is true
  - detail strings use consistent templates with signal values embedded

Output: 10K train + 2.5K holdout (larger corpus for better generalization)
"""

import json
import random
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
TRACES_PATH = PHASE2_DIR.parent / "phase-1-llm-monitor" / "traces" / "monitor-v2-traces.jsonl"
CORPUS_DIR = PHASE2_DIR / "corpus" / "monitor-v2"
TRAIN_PATH = CORPUS_DIR / "train-augmented.jsonl"
HOLDOUT_PATH = CORPUS_DIR / "holdout.jsonl"

STANDARD_MODULES = [
    "observer", "reasoner", "actor", "memory",
    "evaluator", "planner", "monitor", "reflector", "llm-monitor",
]
ACTIONS = [
    "Edit", "Bash", "Read", "Glob", "Grep", "Write",
    "file-delete", "git-push", "git-commit", "deploy",
]
EFFORT_LEVELS = ["low", "medium", "high"]
CONF_THRESHOLD = 0.3


def escape_detail(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def encode_report(report: dict) -> str:
    lines = []
    anomalies = report.get("anomalies", [])
    if not anomalies:
        lines.append("ANOMALIES: none")
    else:
        lines.append("ANOMALIES:")
        for a in anomalies:
            lines.append(f'@{a["moduleId"]} {a["type"]} "{escape_detail(a["detail"])}"')

    esc = report.get("escalation")
    if esc is None:
        lines.append("ESCALATE: none")
    else:
        lines.append(f'ESCALATE: "{escape_detail(esc)}"')

    restricted = report.get("restrictedActions", [])
    if not restricted:
        lines.append("RESTRICT: none")
    else:
        lines.append(f'RESTRICT: {", ".join(restricted)}')

    lines.append(f'REPLAN: {"yes" if report.get("forceReplan") else "no"}')
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
        else:
            if "confidence" in sig:
                fields.append(f"conf={sig['confidence']}")
        parts.append(f"[{mod_id}:{sig_type}] {' '.join(fields)}")
    return "SIGNALS:\n" + "\n".join(parts)


# ── Causal generation rules ──────────────────────────────────

def generate_example() -> dict:
    """Generate one causally consistent (input, output) pair."""
    # Step 1: Generate random signals
    num_mods = random.randint(1, 5)
    mods = random.sample(STANDARD_MODULES, min(num_mods, len(STANDARD_MODULES)))
    signals = {}
    for mod in mods:
        sig_type = random.choice(["reasoner", "actor", "observer"])
        if sig_type == "reasoner":
            conf = round(random.uniform(0.0, 1.0), 2)
            signals[mod] = {
                "type": "reasoner", "source": mod,
                "timestamp": random.randint(1700000000000, 1800000000000),
                "confidence": conf,
                "conflictDetected": random.choice([True, False]),
                "effortLevel": random.choice(EFFORT_LEVELS),
            }
        elif sig_type == "actor":
            success = random.choice([True, True, True, False])  # 75% success
            unexpected = not success and random.random() > 0.3  # 70% of failures are unexpected
            action = random.choice(ACTIONS)
            signals[mod] = {
                "type": "actor", "source": mod,
                "timestamp": random.randint(1700000000000, 1800000000000),
                "actionTaken": action, "success": success,
                "unexpectedResult": unexpected,
            }
        else:
            signals[mod] = {
                "type": "observer", "source": mod,
                "timestamp": random.randint(1700000000000, 1800000000000),
                "inputProcessed": True,
                "noveltyScore": round(random.uniform(0.0, 1.0), 2),
            }

    # Step 2: DERIVE anomalies deterministically from signals
    anomalies = []
    restricted_actions = []

    for mod, sig in signals.items():
        if sig["type"] == "reasoner" and sig["confidence"] < CONF_THRESHOLD:
            anomalies.append({
                "moduleId": mod,
                "type": "low-confidence",
                "detail": f"Confidence {sig['confidence']} below threshold {CONF_THRESHOLD}",
            })
        elif sig["type"] == "actor" and sig.get("unexpectedResult"):
            action = sig["actionTaken"]
            anomalies.append({
                "moduleId": mod,
                "type": "unexpected-result",
                "detail": f"Actor reported unexpected result from action: {action}",
            })
            restricted_actions.append(action)

    # Compound: if both low-confidence AND unexpected-result present
    has_low_conf = any(a["type"] == "low-confidence" for a in anomalies)
    has_unexpected = any(a["type"] == "unexpected-result" for a in anomalies)
    if has_low_conf and has_unexpected:
        anomalies.append({
            "moduleId": "llm-monitor",
            "type": "compound",
            "detail": "Compound anomaly: low confidence combined with unexpected result",
        })

    # Step 3: DERIVE forceReplan deterministically
    force_replan = len(anomalies) >= 2

    # Step 4: DERIVE escalation deterministically
    escalation = None
    if force_replan:
        if any(a["type"] == "compound" for a in anomalies):
            escalation = "Compound anomaly: low confidence combined with unexpected result"
        else:
            escalation = f"Multiple anomalies detected across {len(anomalies)} signals"

    report = {
        "anomalies": anomalies,
        "escalation": escalation,
        "restrictedActions": sorted(set(restricted_actions)),
        "forceReplan": force_replan,
    }

    return {
        "input": compact_signals(signals),
        "output": encode_report(report),
    }


def main():
    random.seed(42)

    # Load trace-based entries (keep for diversity)
    trace_entries = []
    if TRACES_PATH.exists():
        with open(TRACES_PATH) as f:
            for line in f:
                line = line.strip()
                if line:
                    trace = json.loads(line)
                    # Re-encode traces with consistent rules
                    trace_entries.append({
                        "input": compact_signals(trace["input"]),
                        "output": encode_report(trace["output"]),
                    })
    print(f"Trace entries: {len(trace_entries)}")

    # Generate 12500 causally consistent examples
    target_total = 12500
    needed = target_total - len(trace_entries)
    generated = [generate_example() for _ in range(needed)]
    print(f"Generated: {len(generated)} causally consistent entries")

    all_entries = trace_entries + generated
    random.shuffle(all_entries)

    # Stats
    clean = sum(1 for e in all_entries if "ANOMALIES: none" in e["output"])
    with_anomaly = len(all_entries) - clean
    with_replan = sum(1 for e in all_entries if "REPLAN: yes" in e["output"])
    with_escalation = sum(1 for e in all_entries if "ESCALATE: none" not in e["output"])
    with_restrict = sum(1 for e in all_entries if "RESTRICT: none" not in e["output"])
    print(f"\nDistribution of {len(all_entries)} entries:")
    print(f"  Clean (no anomalies): {clean} ({clean*100//len(all_entries)}%)")
    print(f"  With anomalies:       {with_anomaly} ({with_anomaly*100//len(all_entries)}%)")
    print(f"  With replan:          {with_replan} ({with_replan*100//len(all_entries)}%)")
    print(f"  With escalation:      {with_escalation} ({with_escalation*100//len(all_entries)}%)")
    print(f"  With restrictions:    {with_restrict} ({with_restrict*100//len(all_entries)}%)")

    # 80/20 split
    holdout_size = len(all_entries) // 5
    holdout = all_entries[:holdout_size]
    train = all_entries[holdout_size:]

    print(f"\nTrain: {len(train)}, Holdout: {len(holdout)}")

    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    with open(TRAIN_PATH, "w", encoding="utf-8", newline="\n") as f:
        for e in train:
            f.write(json.dumps(e, ensure_ascii=True) + "\n")
    with open(HOLDOUT_PATH, "w", encoding="utf-8", newline="\n") as f:
        for e in holdout:
            f.write(json.dumps(e, ensure_ascii=True) + "\n")

    print(f"Written to {TRAIN_PATH} and {HOLDOUT_PATH}")


if __name__ == "__main__":
    main()
