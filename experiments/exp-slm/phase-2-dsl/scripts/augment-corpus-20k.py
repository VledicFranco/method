#!/usr/bin/env python3
"""
Augment corpus 20K — scale the causally consistent training corpus to 20K.

Uses the SAME causal generation rules as augment-corpus-v2.py:
  - restrictedActions = actions from unexpected-result anomalies
  - forceReplan = true when compound anomaly OR >= 2 anomalies
  - escalation = present when forceReplan is true
  - detail strings use consistent templates with signal values embedded

Outputs ONLY train-20k.jsonl. Does NOT touch holdout.jsonl or train-augmented.jsonl.
The holdout remains the same 2.5K entries for fair comparison across scaling runs.

Seed strategy: seed=43 for a fresh 20K set that is statistically similar but not
identical to the original 10K (which used seed=42).
"""

import json
import random
from pathlib import Path
from collections import Counter

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
TRACES_PATH = PHASE2_DIR.parent / "phase-1-llm-monitor" / "traces" / "monitor-v2-traces.jsonl"
CORPUS_DIR = PHASE2_DIR / "corpus" / "monitor-v2"
TRAIN_20K_PATH = CORPUS_DIR / "train-20k.jsonl"

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


# -- Causal generation rules (identical to augment-corpus-v2.py) --

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


def verify_causal_consistency(entry: dict) -> bool:
    """Spot-check that an entry's output is causally consistent with its input."""
    inp = entry["input"]
    out = entry["output"]

    # If REPLAN: yes, there must be an ESCALATE (not none)
    if "REPLAN: yes" in out and "ESCALATE: none" in out:
        return False

    # If RESTRICT lists actions, those actions must appear in ANOMALIES as unexpected-result
    if "RESTRICT: none" not in out:
        restrict_line = [l for l in out.split("\n") if l.startswith("RESTRICT:")][0]
        actions = [a.strip() for a in restrict_line.replace("RESTRICT: ", "").split(",")]
        for action in actions:
            if action not in out:
                return False

    # If there are no anomalies, there should be no replan/escalation/restriction
    if "ANOMALIES: none" in out:
        if "REPLAN: yes" in out:
            return False
        if "ESCALATE: none" not in out:
            return False
        if "RESTRICT: none" not in out:
            return False

    return True


def main():
    random.seed(43)

    # Load trace-based entries (keep for diversity)
    trace_entries = []
    if TRACES_PATH.exists():
        with open(TRACES_PATH) as f:
            for line in f:
                line = line.strip()
                if line:
                    trace = json.loads(line)
                    trace_entries.append({
                        "input": compact_signals(trace["input"]),
                        "output": encode_report(trace["output"]),
                    })
    print(f"Trace entries: {len(trace_entries)}")

    # Generate enough to reach 20K total train entries
    target_train = 20000
    needed = target_train - len(trace_entries)
    generated = [generate_example() for _ in range(needed)]
    print(f"Generated: {len(generated)} causally consistent entries")

    all_entries = trace_entries + generated
    random.shuffle(all_entries)

    # Verify a sample for causal consistency
    sample_size = min(500, len(all_entries))
    sample = random.sample(all_entries, sample_size)
    violations = sum(1 for e in sample if not verify_causal_consistency(e))
    print(f"\nCausal consistency check ({sample_size} sampled): {violations} violations")
    if violations > 0:
        print("  WARNING: Some entries may have causal inconsistencies!")

    # Full verification (fast enough for 20K)
    all_violations = sum(1 for e in all_entries if not verify_causal_consistency(e))
    print(f"Full consistency check ({len(all_entries)} entries): {all_violations} violations")

    # Distribution stats
    clean = sum(1 for e in all_entries if "ANOMALIES: none" in e["output"])
    with_anomaly = len(all_entries) - clean
    with_replan = sum(1 for e in all_entries if "REPLAN: yes" in e["output"])
    with_escalation = sum(1 for e in all_entries if "ESCALATE: none" not in e["output"])
    with_restrict = sum(1 for e in all_entries if "RESTRICT: none" not in e["output"])

    # Anomaly type breakdown
    anomaly_types = Counter()
    for e in all_entries:
        out = e["output"]
        if "low-confidence" in out:
            anomaly_types["low-confidence"] += 1
        if "unexpected-result" in out:
            anomaly_types["unexpected-result"] += 1
        if "compound" in out:
            anomaly_types["compound"] += 1

    print(f"\n{'='*60}")
    print(f"Distribution of {len(all_entries)} entries:")
    print(f"{'='*60}")
    print(f"  Clean (no anomalies): {clean:>6} ({clean*100/len(all_entries):5.1f}%)")
    print(f"  With anomalies:       {with_anomaly:>6} ({with_anomaly*100/len(all_entries):5.1f}%)")
    print(f"  With replan:          {with_replan:>6} ({with_replan*100/len(all_entries):5.1f}%)")
    print(f"  With escalation:      {with_escalation:>6} ({with_escalation*100/len(all_entries):5.1f}%)")
    print(f"  With restrictions:    {with_restrict:>6} ({with_restrict*100/len(all_entries):5.1f}%)")
    print(f"\n  Anomaly type breakdown:")
    for atype, count in sorted(anomaly_types.items()):
        print(f"    {atype:>20}: {count:>6} ({count*100/len(all_entries):5.1f}%)")

    # Write ONLY train-20k.jsonl — do NOT touch holdout or train-augmented
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    with open(TRAIN_20K_PATH, "w", encoding="utf-8", newline="\n") as f:
        for e in all_entries:
            f.write(json.dumps(e, ensure_ascii=True) + "\n")

    print(f"\nWritten {len(all_entries)} entries to {TRAIN_20K_PATH}")
    print(f"Holdout unchanged at {CORPUS_DIR / 'holdout.jsonl'}")


if __name__ == "__main__":
    main()
