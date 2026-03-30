#!/usr/bin/env python3
"""
Stagnation corpus augmentation — adds multi-module stagnation patterns.

The existing corpus (train-augmented.jsonl) has ZERO entries with evaluator
signals (diminishing returns, progress tracking) and zero stagnation patterns.
The sole SLM failure in Gate 4 Part 2 was a 6-module stagnation scenario —
this is the targeted fix.

Adds ~2000 new entries covering:
  1. Stagnation: evaluator(diminishing) + repeated actor actions → REPLAN + RESTRICT + ESCALATE
  2. Clean evaluator: healthy progress (no anomaly) — teaches the non-stagnation case
  3. Mixed: stagnation combined with low-confidence / unexpected-result anomalies
  4. Extended module coverage: memory and planner signals (also missing from training data)

Merges with existing corpus → train-stagnation.jsonl + holdout-stagnation.jsonl.
These files are used by monitor-qwen25-coder-05b-lora-stagnation.yaml.

Usage:
    python phase-2-dsl/scripts/augment-corpus-stagnation.py
"""

import json
import random
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
CORPUS_DIR = PHASE2_DIR / "corpus" / "monitor-v2"
EXISTING_TRAIN = CORPUS_DIR / "train-augmented.jsonl"
EXISTING_HOLDOUT = CORPUS_DIR / "holdout.jsonl"
NEW_TRAIN = CORPUS_DIR / "train-stagnation.jsonl"
NEW_HOLDOUT = CORPUS_DIR / "holdout-stagnation.jsonl"

ACTIONS = ["Edit", "Bash", "Read", "Glob", "Grep", "Write",
           "file-delete", "git-push", "git-commit", "deploy"]
EFFORT_LEVELS = ["low", "medium", "high"]
CONF_THRESHOLD = 0.3
REPEATED_ACTIONS = ["Read", "Grep", "Bash", "Glob"]  # most common repeated patterns


# ── DSL encoding (matches dsl-codec.ts exactly) ────────────────

def escape_detail(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def encode_signals(signals: dict) -> str:
    """Encode signals to compact DSL format matching dsl-codec.ts."""
    if not signals:
        return "SIGNALS:\n(none)"
    parts = ["SIGNALS:"]
    for mod_id, sig in signals.items():
        sig_type = sig.get("type", "unknown")
        tokens = []

        if sig_type in ("reasoner", "reasoner-actor"):
            if "confidence" in sig:
                tokens.append(f"conf={sig['confidence']}")
            if sig.get("conflictDetected"):
                tokens.append("conflict")
            if "effortLevel" in sig:
                tokens.append(f"effort={sig['effortLevel']}")

        if sig_type in ("actor", "reasoner-actor"):
            if "actionTaken" in sig:
                tokens.append(f"action={sig['actionTaken']}")
            if "success" in sig:
                tokens.append(f"ok={'True' if sig['success'] else 'False'}")
            if sig.get("unexpectedResult"):
                tokens.append("unexpected")

        if sig_type == "observer":
            if "inputProcessed" in sig:
                tokens.append(f"processed={'True' if sig['inputProcessed'] else 'False'}")
            if "noveltyScore" in sig:
                tokens.append(f"novelty={sig['noveltyScore']}")

        if sig_type == "memory":
            if "retrievalCount" in sig:
                tokens.append(f"retrievals={sig['retrievalCount']}")
            if "relevanceScore" in sig:
                tokens.append(f"relevance={sig['relevanceScore']}")

        if sig_type == "evaluator":
            if "estimatedProgress" in sig:
                tokens.append(f"progress={sig['estimatedProgress']}")
            if sig.get("diminishingReturns"):
                tokens.append("diminishing")

        if sig_type == "planner":
            if "planRevised" in sig:
                tokens.append(f"revised={'True' if sig['planRevised'] else 'False'}")
            if "subgoalCount" in sig:
                tokens.append(f"subgoals={sig['subgoalCount']}")

        parts.append(f"[{sig_type}:{mod_id}] {' '.join(tokens)}")

    return "\n".join(parts)


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
        lines.append(f'RESTRICT: {", ".join(sorted(restricted))}')

    lines.append(f'REPLAN: {"yes" if report.get("forceReplan") else "no"}')
    return "\n".join(lines)


# ── Example generators ─────────────────────────────────────────

def gen_stagnation() -> dict:
    """Core stagnation: evaluator(diminishing) + repeated actions → full escalation."""
    progress = round(random.uniform(0.04, 0.35), 2)
    repeated_action = random.choice(REPEATED_ACTIONS)

    signals = {
        "evaluator": {
            "type": "evaluator",
            "estimatedProgress": progress,
            "diminishingReturns": True,
        }
    }

    # 2-4 actor slots, majority using the repeated action
    actor_slots = random.sample(["actor", "reflector", "executor", "worker", "handler"], random.randint(2, 4))
    for slot in actor_slots:
        action = repeated_action if random.random() < 0.65 else random.choice(ACTIONS)
        signals[slot] = {"type": "actor", "actionTaken": action, "success": True, "unexpectedResult": False}

    # Optional: observer (low novelty)
    if random.random() < 0.65:
        signals["observer"] = {
            "type": "observer",
            "noveltyScore": round(random.uniform(0.0, 0.12), 2),
            "inputProcessed": True,
        }

    # Optional: memory (many retrievals, low relevance)
    if random.random() < 0.45:
        signals["memory"] = {
            "type": "memory",
            "retrievalCount": random.randint(6, 18),
            "relevanceScore": round(random.uniform(0.1, 0.35), 2),
        }

    # Optional: reasoner (still healthy — stagnation isn't about low confidence)
    if random.random() < 0.4:
        signals["reasoner"] = {
            "type": "reasoner",
            "confidence": round(random.uniform(0.45, 0.9), 2),
            "effortLevel": random.choice(EFFORT_LEVELS),
            "conflictDetected": False,
        }

    # Optional: planner (not revising, same subgoals — stagnation indicator)
    if random.random() < 0.4:
        signals["planner"] = {
            "type": "planner",
            "planRevised": False,
            "subgoalCount": random.randint(2, 5),
        }

    # Derive report
    actor_actions = [s["actionTaken"] for s in signals.values() if s.get("type") == "actor"]
    repeated = sorted({a for a, n in Counter(actor_actions).items() if n >= 2})

    anomalies = [{
        "moduleId": "evaluator",
        "type": "compound",
        "detail": f"Stagnation: diminishing returns with estimated progress {progress}",
    }]

    if repeated:
        esc = f"Stagnation detected: diminishing returns with repeated {repeated[0]} actions, force replan required"
    else:
        esc = f"Stagnation detected: diminishing returns with progress {progress}, force replan required"

    report = {
        "anomalies": anomalies,
        "escalation": esc,
        "restrictedActions": repeated,
        "forceReplan": True,
    }

    return {"input": encode_signals(signals), "output": encode_report(report)}


def gen_clean_evaluator() -> dict:
    """Healthy evaluator progress — no stagnation anomaly. Teaches the clean case."""
    progress = round(random.uniform(0.40, 0.98), 2)

    signals = {
        "evaluator": {
            "type": "evaluator",
            "estimatedProgress": progress,
            "diminishingReturns": False,
        }
    }

    extra = random.sample(["observer", "reasoner", "actor", "memory", "planner"], random.randint(1, 3))
    for mod in extra:
        if mod == "observer":
            signals[mod] = {"type": "observer", "noveltyScore": round(random.uniform(0.25, 0.9), 2), "inputProcessed": True}
        elif mod == "reasoner":
            signals[mod] = {"type": "reasoner", "confidence": round(random.uniform(0.5, 0.99), 2), "effortLevel": random.choice(EFFORT_LEVELS), "conflictDetected": False}
        elif mod == "actor":
            signals[mod] = {"type": "actor", "actionTaken": random.choice(ACTIONS), "success": True, "unexpectedResult": False}
        elif mod == "memory":
            signals[mod] = {"type": "memory", "retrievalCount": random.randint(1, 5), "relevanceScore": round(random.uniform(0.5, 0.92), 2)}
        elif mod == "planner":
            signals[mod] = {"type": "planner", "planRevised": bool(random.getrandbits(1)), "subgoalCount": random.randint(1, 5)}

    report = {"anomalies": [], "escalation": None, "restrictedActions": [], "forceReplan": False}
    return {"input": encode_signals(signals), "output": encode_report(report)}


def gen_mixed_stagnation_plus_anomaly() -> dict:
    """Stagnation combined with low-confidence or unexpected-result — compound multi-anomaly."""
    progress = round(random.uniform(0.04, 0.28), 2)
    repeated_action = random.choice(REPEATED_ACTIONS)

    signals = {
        "evaluator": {
            "type": "evaluator",
            "estimatedProgress": progress,
            "diminishingReturns": True,
        }
    }

    # Always include a low-confidence reasoner
    conf = round(random.uniform(0.0, CONF_THRESHOLD - 0.01), 2)
    signals["reasoner"] = {
        "type": "reasoner",
        "confidence": conf,
        "effortLevel": "high",
        "conflictDetected": False,
    }

    # Repeated actors
    signals["actor"] = {"type": "actor", "actionTaken": repeated_action, "success": True, "unexpectedResult": False}
    signals["reflector"] = {"type": "actor", "actionTaken": repeated_action, "success": True, "unexpectedResult": False}

    if random.random() < 0.5:
        signals["observer"] = {"type": "observer", "noveltyScore": round(random.uniform(0.0, 0.08), 2), "inputProcessed": True}

    if random.random() < 0.4:
        signals["memory"] = {"type": "memory", "retrievalCount": random.randint(8, 20), "relevanceScore": round(random.uniform(0.1, 0.3), 2)}

    anomalies = [
        {
            "moduleId": "reasoner",
            "type": "low-confidence",
            "detail": f"Confidence {conf} below threshold {CONF_THRESHOLD}",
        },
        {
            "moduleId": "evaluator",
            "type": "compound",
            "detail": f"Stagnation: diminishing returns with estimated progress {progress}",
        },
    ]

    esc = f"Multiple anomalies: low confidence and stagnation with repeated {repeated_action} actions"
    report = {
        "anomalies": anomalies,
        "escalation": esc,
        "restrictedActions": sorted([repeated_action]),
        "forceReplan": True,
    }

    return {"input": encode_signals(signals), "output": encode_report(report)}


def gen_memory_planner_only() -> dict:
    """Standalone memory/planner signals with no evaluator — widens coverage of new signal types."""
    signals = {}
    mods = random.sample(["memory", "planner", "reasoner", "actor", "observer"], random.randint(2, 4))

    for mod in mods:
        if mod == "memory":
            signals[mod] = {"type": "memory", "retrievalCount": random.randint(1, 12), "relevanceScore": round(random.uniform(0.2, 0.95), 2)}
        elif mod == "planner":
            signals[mod] = {"type": "planner", "planRevised": bool(random.getrandbits(1)), "subgoalCount": random.randint(1, 6)}
        elif mod == "reasoner":
            conf = round(random.uniform(0.0, 1.0), 2)
            signals[mod] = {"type": "reasoner", "confidence": conf, "effortLevel": random.choice(EFFORT_LEVELS), "conflictDetected": random.choice([True, False])}
        elif mod == "actor":
            success = random.choice([True, True, True, False])
            unexpected = not success and random.random() > 0.3
            signals[mod] = {"type": "actor", "actionTaken": random.choice(ACTIONS), "success": success, "unexpectedResult": unexpected}
        elif mod == "observer":
            signals[mod] = {"type": "observer", "noveltyScore": round(random.uniform(0.0, 1.0), 2), "inputProcessed": True}

    # Derive anomalies from any reasoner/actor signals
    anomalies = []
    restricted = []
    for mod_id, sig in signals.items():
        if sig["type"] == "reasoner" and sig.get("confidence", 1.0) < CONF_THRESHOLD:
            anomalies.append({"moduleId": mod_id, "type": "low-confidence", "detail": f"Confidence {sig['confidence']} below threshold {CONF_THRESHOLD}"})
        elif sig["type"] == "actor" and sig.get("unexpectedResult"):
            action = sig["actionTaken"]
            anomalies.append({"moduleId": mod_id, "type": "unexpected-result", "detail": f"Actor reported unexpected result from action: {action}"})
            restricted.append(action)

    has_lc = any(a["type"] == "low-confidence" for a in anomalies)
    has_ur = any(a["type"] == "unexpected-result" for a in anomalies)
    if has_lc and has_ur:
        anomalies.append({"moduleId": "llm-monitor", "type": "compound", "detail": "Compound anomaly: low confidence combined with unexpected result"})

    force_replan = len(anomalies) >= 2
    escalation = None
    if force_replan:
        if any(a["type"] == "compound" for a in anomalies):
            escalation = "Compound anomaly: low confidence combined with unexpected result"
        else:
            escalation = f"Multiple anomalies detected across {len(anomalies)} signals"

    report = {"anomalies": anomalies, "escalation": escalation, "restrictedActions": sorted(set(restricted)), "forceReplan": force_replan}
    return {"input": encode_signals(signals), "output": encode_report(report)}


# ── Main ────────────────────────────────────────────────────────

def load_jsonl(path: Path) -> list[dict]:
    entries = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def main():
    random.seed(2026)

    print("Loading existing corpus...")
    existing_train = load_jsonl(EXISTING_TRAIN)
    existing_holdout = load_jsonl(EXISTING_HOLDOUT)
    print(f"  Train: {len(existing_train)}, Holdout: {len(existing_holdout)}")

    # Generate new stagnation entries
    print("\nGenerating stagnation entries...")
    n_stagnation      = 1200  # core stagnation pattern
    n_clean_eval      = 400   # healthy evaluator (no stagnation)
    n_mixed           = 400   # stagnation + other anomaly
    n_mem_plan        = 200   # memory/planner signal coverage

    new_entries = (
        [gen_stagnation() for _ in range(n_stagnation)] +
        [gen_clean_evaluator() for _ in range(n_clean_eval)] +
        [gen_mixed_stagnation_plus_anomaly() for _ in range(n_mixed)] +
        [gen_memory_planner_only() for _ in range(n_mem_plan)]
    )
    random.shuffle(new_entries)
    print(f"  Generated: {len(new_entries)} new entries")

    # 80/20 split for new entries
    holdout_size = len(new_entries) // 5
    combined_train = existing_train + new_entries[holdout_size:]
    combined_holdout = existing_holdout + new_entries[:holdout_size]
    random.shuffle(combined_train)
    random.shuffle(combined_holdout)

    # Stats
    n_stagnation_train = sum(1 for e in combined_train if "diminishing" in e["input"])
    n_evaluator_train  = sum(1 for e in combined_train if ":evaluator]" in e["input"])
    n_replan           = sum(1 for e in combined_train if "REPLAN: yes" in e["output"])
    n_clean            = sum(1 for e in combined_train if "ANOMALIES: none" in e["output"])

    print(f"\nFinal corpus:")
    print(f"  Train: {len(combined_train)}, Holdout: {len(combined_holdout)}")
    print(f"  Stagnation patterns:    {n_stagnation_train} ({n_stagnation_train*100//len(combined_train)}%)")
    print(f"  Evaluator signals:      {n_evaluator_train} ({n_evaluator_train*100//len(combined_train)}%)")
    print(f"  REPLAN: yes:            {n_replan} ({n_replan*100//len(combined_train)}%)")
    print(f"  ANOMALIES: none:        {n_clean} ({n_clean*100//len(combined_train)}%)")

    CORPUS_DIR.mkdir(parents=True, exist_ok=True)

    with open(NEW_TRAIN, "w", encoding="utf-8", newline="\n") as f:
        for e in combined_train:
            f.write(json.dumps(e, ensure_ascii=True) + "\n")

    with open(NEW_HOLDOUT, "w", encoding="utf-8", newline="\n") as f:
        for e in combined_holdout:
            f.write(json.dumps(e, ensure_ascii=True) + "\n")

    print(f"\nWritten:")
    print(f"  {NEW_TRAIN}")
    print(f"  {NEW_HOLDOUT}")


if __name__ == "__main__":
    main()
