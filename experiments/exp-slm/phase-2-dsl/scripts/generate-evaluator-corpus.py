#!/usr/bin/env python3
"""
Evaluator module corpus generator — R-08.

Evaluator job: given progress signals from task execution, output a progress
assessment with recommended action (PROGRESS, CONFIDENCE, ACTION, NOTE).

DSL rules (deterministic):
  Input format:
    EVAL-SIGNALS:
    [evaluator:<id>] progress=<float> diminishing=<True|False> steps=<int> clarity=<high|medium|low>

  Output format:
    PROGRESS: <on-track|stagnant|diverging>
    CONFIDENCE: <float>
    ACTION: <continue|replan|escalate>
    NOTE: <quoted string | none>

  Causal mapping rules (single primary evaluator; multi-signal uses primary):
    primary signal = first signal (or the one with highest |progress| variance)

    PROGRESS:
      - "diverging"  if estimatedProgress < 0.0
                     OR (estimatedProgress < 0.20 AND steps > 15)
                     OR (clarity == "low" AND steps > 10)
      - "stagnant"   if diminishing == True
                     OR (estimatedProgress < 0.30 AND steps > 10)
                     (and not diverging)
      - "on-track"   otherwise

    CONFIDENCE (0.0–1.0):
      - base = estimatedProgress * 0.6 + (1.0 if clarity=="high" else 0.5 if clarity=="medium" else 0.2) * 0.4
      - penalty: -0.15 if diminishing; -0.10 per 5 steps over 20; clamp [0.10, 0.95]
      - round to 2 decimal places

    ACTION:
      - "escalate"   if PROGRESS == "diverging" AND (steps > 20 OR clarity == "low")
      - "replan"     if PROGRESS == "diverging" OR PROGRESS == "stagnant"
      - "continue"   if PROGRESS == "on-track"

    NOTE:
      - diverging + escalate + clarity==low:  "Goal clarity too low to recover without intervention"
      - diverging + escalate + steps>20:      "Extended divergence — escalation required"
      - diverging + replan:                   "Progress negative — immediate replanning required"
      - stagnant + diminishing:               "Diminishing returns detected — strategy revision recommended"
      - stagnant (progress):                  "Progress plateau — consider replanning approach"
      - on-track + progress>=0.80:            "Strong progress — maintain current approach"
      - on-track:                             "none"

Generates 8000 train + 2000 holdout to
  phase-2-dsl/corpus/evaluator-v1/train.jsonl
  phase-2-dsl/corpus/evaluator-v1/holdout.jsonl
"""

import json
import random
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
CORPUS_DIR = PHASE2_DIR / "corpus" / "evaluator-v1"
TRAIN_PATH = CORPUS_DIR / "train.jsonl"
HOLDOUT_PATH = CORPUS_DIR / "holdout.jsonl"

CLARITY_LEVELS = ["high", "medium", "low"]
EVALUATOR_IDS = ["main", "secondary", "aux"]


def confidence_from_signal(progress: float, clarity: str, diminishing: bool, steps: int) -> float:
    """Deterministic confidence calculation."""
    clarity_val = {"high": 1.0, "medium": 0.5, "low": 0.2}[clarity]
    base = progress * 0.6 + clarity_val * 0.4
    if diminishing:
        base -= 0.15
    extra_batches = max(0, steps - 20) // 5
    base -= extra_batches * 0.10
    return round(max(0.10, min(0.95, base)), 2)


def encode_signals(signals: list[dict]) -> str:
    """Encode evaluator signals to compact DSL input format."""
    lines = ["EVAL-SIGNALS:"]
    for s in signals:
        dim_str = "True" if s["diminishing"] else "False"
        lines.append(
            f"[evaluator:{s['id']}] progress={s['progress']:.2f} "
            f"diminishing={dim_str} steps={s['steps']} clarity={s['clarity']}"
        )
    return "\n".join(lines)


def encode_report(progress_label: str, confidence: float, action: str, note: str) -> str:
    """Encode evaluator report to compact DSL output format."""
    note_str = f'"{note}"' if note != "none" else "none"
    return (
        f"PROGRESS: {progress_label}\n"
        f"CONFIDENCE: {confidence:.2f}\n"
        f"ACTION: {action}\n"
        f"NOTE: {note_str}"
    )


def derive_report(signals: list[dict]) -> tuple[str, float, str, str]:
    """Deterministically derive (progress_label, confidence, action, note) from signals."""
    # Primary signal drives assessment (first signal = primary)
    p = signals[0]
    progress = p["progress"]
    diminishing = p["diminishing"]
    steps = p["steps"]
    clarity = p["clarity"]

    # PROGRESS label
    if (progress < 0.0
            or (progress < 0.20 and steps > 15)
            or (clarity == "low" and steps > 10)):
        progress_label = "diverging"
    elif diminishing or (progress < 0.30 and steps > 10):
        progress_label = "stagnant"
    else:
        progress_label = "on-track"

    # CONFIDENCE
    confidence = confidence_from_signal(
        max(0.0, progress), clarity, diminishing, steps
    )

    # ACTION
    if progress_label == "diverging" and (steps > 20 or clarity == "low"):
        action = "escalate"
    elif progress_label in ("diverging", "stagnant"):
        action = "replan"
    else:
        action = "continue"

    # NOTE
    if progress_label == "diverging" and action == "escalate" and clarity == "low":
        note = "Goal clarity too low to recover without intervention"
    elif progress_label == "diverging" and action == "escalate" and steps > 20:
        note = "Extended divergence — escalation required"
    elif progress_label == "diverging":
        note = "Progress negative — immediate replanning required"
    elif progress_label == "stagnant" and diminishing:
        note = "Diminishing returns detected — strategy revision recommended"
    elif progress_label == "stagnant":
        note = "Progress plateau — consider replanning approach"
    elif progress_label == "on-track" and progress >= 0.80:
        note = "Strong progress — maintain current approach"
    else:
        note = "none"

    return progress_label, confidence, action, note


def make_signal(rng: random.Random, obs_id: str,
                progress: float = None, diminishing: bool = None,
                steps: int = None, clarity: str = None) -> dict:
    """Create a single evaluator signal with optional overrides."""
    return {
        "id": obs_id,
        "progress": round(rng.uniform(0.0, 1.0), 2) if progress is None else round(progress, 2),
        "diminishing": rng.choice([True, False]) if diminishing is None else diminishing,
        "steps": rng.randint(1, 30) if steps is None else steps,
        "clarity": rng.choice(CLARITY_LEVELS) if clarity is None else clarity,
    }


def generate_example(rng: random.Random) -> dict:
    """Generate one causally consistent (input, output) pair."""
    num_signals = rng.randint(1, 3)
    ids = rng.sample(EVALUATOR_IDS, min(num_signals, len(EVALUATOR_IDS)))
    signals = [make_signal(rng, obs_id) for obs_id in ids]

    progress_label, confidence, action, note = derive_report(signals)
    return {
        "input": encode_signals(signals),
        "output": encode_report(progress_label, confidence, action, note),
    }


def generate_targeted_example(rng: random.Random, scenario: str) -> dict:
    """Generate a targeted example for a specific coverage scenario."""
    if scenario == "on_track_strong":
        s = make_signal(rng, "main", progress=rng.uniform(0.80, 1.0), diminishing=False,
                        steps=rng.randint(1, 15), clarity="high")
    elif scenario == "on_track_moderate":
        s = make_signal(rng, "main", progress=rng.uniform(0.30, 0.79), diminishing=False,
                        steps=rng.randint(1, 10), clarity=rng.choice(["high", "medium"]))
    elif scenario == "stagnant_diminishing":
        s = make_signal(rng, "main", progress=rng.uniform(0.30, 0.70), diminishing=True,
                        steps=rng.randint(5, 25), clarity=rng.choice(["high", "medium"]))
    elif scenario == "stagnant_plateau":
        # Low progress + many steps, no diminishing
        s = make_signal(rng, "main", progress=rng.uniform(0.10, 0.29), diminishing=False,
                        steps=rng.randint(11, 25), clarity=rng.choice(["high", "medium"]))
    elif scenario == "diverging_negative":
        s = make_signal(rng, "main", progress=rng.uniform(-0.30, -0.01), diminishing=False,
                        steps=rng.randint(1, 20), clarity=rng.choice(["high", "medium"]))
    elif scenario == "diverging_low_clarity":
        s = make_signal(rng, "main", progress=rng.uniform(0.10, 0.50), diminishing=False,
                        steps=rng.randint(11, 30), clarity="low")
    elif scenario == "escalate_low_clarity":
        s = make_signal(rng, "main", progress=rng.uniform(-0.20, 0.19), diminishing=False,
                        steps=rng.randint(11, 30), clarity="low")
    elif scenario == "escalate_extended":
        s = make_signal(rng, "main", progress=rng.uniform(-0.30, 0.19), diminishing=False,
                        steps=rng.randint(21, 40), clarity=rng.choice(["high", "medium"]))
    elif scenario == "early_progress_ok":
        s = make_signal(rng, "main", progress=rng.uniform(0.30, 0.80), diminishing=False,
                        steps=rng.randint(1, 5), clarity="high")
    elif scenario == "multi_signal_mixed":
        ids = rng.sample(EVALUATOR_IDS, 2)
        s1 = make_signal(rng, ids[0], progress=rng.uniform(0.40, 0.80), diminishing=False,
                         steps=rng.randint(5, 15), clarity="high")
        s2 = make_signal(rng, ids[1], progress=rng.uniform(0.10, 0.40), diminishing=True,
                         steps=rng.randint(5, 15), clarity="medium")
        signals = [s1, s2]
        progress_label, confidence, action, note = derive_report(signals)
        return {
            "input": encode_signals(signals),
            "output": encode_report(progress_label, confidence, action, note),
        }
    elif scenario == "stagnant_low_progress_early":
        # Low progress but early steps → not diverging, might be stagnant
        s = make_signal(rng, "main", progress=rng.uniform(0.05, 0.29), diminishing=True,
                        steps=rng.randint(5, 10), clarity="medium")
    else:
        return generate_example(rng)

    signals = [s]
    progress_label, confidence, action, note = derive_report(signals)
    return {
        "input": encode_signals(signals),
        "output": encode_report(progress_label, confidence, action, note),
    }


def main():
    rng = random.Random(42)

    total_target = 10000  # 8000 train + 2000 holdout
    targeted_scenarios = [
        "on_track_strong",
        "on_track_moderate",
        "stagnant_diminishing",
        "stagnant_plateau",
        "diverging_negative",
        "diverging_low_clarity",
        "escalate_low_clarity",
        "escalate_extended",
        "early_progress_ok",
        "multi_signal_mixed",
        "stagnant_low_progress_early",
    ]

    # Generate targeted examples — ~90 per scenario ≈ 1000 total
    targeted = []
    per_scenario = 1000 // len(targeted_scenarios)
    for scenario in targeted_scenarios:
        for _ in range(per_scenario):
            targeted.append(generate_targeted_example(rng, scenario))

    # Fill rest with random
    remaining = total_target - len(targeted)
    generated = [generate_example(rng) for _ in range(remaining)]
    print(f"Targeted: {len(targeted)}, Random: {len(generated)}")

    all_entries = targeted + generated
    rng.shuffle(all_entries)

    # Distribution stats
    on_track = sum(1 for e in all_entries if "PROGRESS: on-track" in e["output"])
    stagnant = sum(1 for e in all_entries if "PROGRESS: stagnant" in e["output"])
    diverging = sum(1 for e in all_entries if "PROGRESS: diverging" in e["output"])
    escalate = sum(1 for e in all_entries if "ACTION: escalate" in e["output"])
    replan = sum(1 for e in all_entries if "ACTION: replan" in e["output"])
    cont = sum(1 for e in all_entries if "ACTION: continue" in e["output"])
    print(f"\nDistribution of {len(all_entries)} entries:")
    print(f"  On-track:  {on_track} ({on_track*100//len(all_entries)}%)")
    print(f"  Stagnant:  {stagnant} ({stagnant*100//len(all_entries)}%)")
    print(f"  Diverging: {diverging} ({diverging*100//len(all_entries)}%)")
    print(f"  Action: continue={cont}, replan={replan}, escalate={escalate}")

    # Fixed split: 8000 train + 2000 holdout
    holdout_size = 2000
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
