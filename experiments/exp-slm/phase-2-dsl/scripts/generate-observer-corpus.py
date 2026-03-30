#!/usr/bin/env python3
"""
Observer module corpus generator — R-08.

Observer job: given novelty signals from input processing, output an attention
priority report (PRIORITY, FOCUS, NOVELTY, NOTE).

DSL rules (deterministic):
  Input format:
    OBS-SIGNALS:
    [observer:<id>] novelty=<float> processed=<True|False> content=<text|code|error|tool-output>

  Output format:
    PRIORITY: <high|medium|low>
    FOCUS: <comma-separated modules | none>
    NOVELTY: <float — max noveltyScore across all observers>
    NOTE: <quoted string | none>

  Causal mapping rules:
    1. max_novelty = max(noveltyScore for all signals)
    2. has_error = any signal with content=error
    3. has_unprocessed = any signal with processed=False

    PRIORITY:
      - "high"   if has_error OR max_novelty >= 0.75
      - "medium" if max_novelty >= 0.40 (and not high)
      - "low"    if max_novelty < 0.40 (and not high/medium)

    FOCUS (which modules need attention given the observation):
      - high priority:   ["reasoner", "planner"]  always
                         + add "reflector" if has_unprocessed
      - medium priority: ["reasoner"]              always
                         + add "planner" if max_novelty >= 0.60
      - low priority:    "none"

    NOVELTY: max_novelty (2 decimal places)

    NOTE:
      - error present:            "High novelty error signal requires strategy reassessment"
      - high + unprocessed:       "Unprocessed input with high novelty — reflector intervention needed"
      - high (novelty only):      "Novel input warrants focused attention on reasoning path"
      - medium + novelty>=0.60:   "Moderate novelty may require plan adjustment"
      - medium:                   "Moderate novelty — monitor for pattern development"
      - low:                      "none"

Generates 8000 train + 2000 holdout to
  phase-2-dsl/corpus/observer-v1/train.jsonl
  phase-2-dsl/corpus/observer-v1/holdout.jsonl
"""

import json
import random
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE2_DIR = SCRIPT_DIR.parent
CORPUS_DIR = PHASE2_DIR / "corpus" / "observer-v1"
TRAIN_PATH = CORPUS_DIR / "train.jsonl"
HOLDOUT_PATH = CORPUS_DIR / "holdout.jsonl"

CONTENT_TYPES = ["text", "code", "error", "tool-output"]
OBSERVER_IDS = ["main", "secondary", "tertiary", "aux", "ctx"]

NOVELTY_HIGH_THRESH = 0.75
NOVELTY_MED_THRESH = 0.40
NOVELTY_PLAN_THRESH = 0.60


def encode_signals(signals: list[dict]) -> str:
    """Encode observer signals to compact DSL input format."""
    lines = ["OBS-SIGNALS:"]
    for s in signals:
        lines.append(
            f"[observer:{s['id']}] novelty={s['novelty']:.2f} "
            f"processed={s['processed']} content={s['content']}"
        )
    return "\n".join(lines)


def encode_report(priority: str, focus: list[str], novelty: float, note: str) -> str:
    """Encode observer report to compact DSL output format."""
    focus_str = ", ".join(focus) if focus else "none"
    note_str = f'"{note}"' if note != "none" else "none"
    return (
        f"PRIORITY: {priority}\n"
        f"FOCUS: {focus_str}\n"
        f"NOVELTY: {novelty:.2f}\n"
        f"NOTE: {note_str}"
    )


def derive_report(signals: list[dict]) -> tuple[str, list[str], float, str]:
    """Deterministically derive output from signals."""
    max_novelty = round(max(s["novelty"] for s in signals), 2)
    has_error = any(s["content"] == "error" for s in signals)
    has_unprocessed = any(s["processed"] == "False" for s in signals)

    # PRIORITY
    if has_error or max_novelty >= NOVELTY_HIGH_THRESH:
        priority = "high"
    elif max_novelty >= NOVELTY_MED_THRESH:
        priority = "medium"
    else:
        priority = "low"

    # FOCUS
    if priority == "high":
        focus = ["reasoner", "planner"]
        if has_unprocessed:
            focus.append("reflector")
    elif priority == "medium":
        focus = ["reasoner"]
        if max_novelty >= NOVELTY_PLAN_THRESH:
            focus.append("planner")
    else:
        focus = []

    # NOTE
    if has_error:
        note = "High novelty error signal requires strategy reassessment"
    elif priority == "high" and has_unprocessed:
        note = "Unprocessed input with high novelty — reflector intervention needed"
    elif priority == "high":
        note = "Novel input warrants focused attention on reasoning path"
    elif priority == "medium" and max_novelty >= NOVELTY_PLAN_THRESH:
        note = "Moderate novelty may require plan adjustment"
    elif priority == "medium":
        note = "Moderate novelty — monitor for pattern development"
    else:
        note = "none"

    return priority, focus, max_novelty, note


def generate_example(rng: random.Random) -> dict:
    """Generate one causally consistent (input, output) pair."""
    num_signals = rng.randint(1, 4)
    ids = rng.sample(OBSERVER_IDS, min(num_signals, len(OBSERVER_IDS)))

    signals = []
    for obs_id in ids:
        signals.append({
            "id": obs_id,
            "novelty": round(rng.uniform(0.0, 1.0), 2),
            "processed": rng.choice(["True", "True", "True", "False"]),  # 75% processed
            "content": rng.choice(CONTENT_TYPES),
        })

    priority, focus, max_novelty, note = derive_report(signals)

    return {
        "input": encode_signals(signals),
        "output": encode_report(priority, focus, max_novelty, note),
    }


def generate_targeted_example(
    rng: random.Random,
    scenario: str,
) -> dict:
    """Generate a targeted example for a specific coverage scenario."""
    if scenario == "high_novelty_single":
        novelty = round(rng.uniform(0.75, 1.0), 2)
        signals = [{"id": "main", "novelty": novelty, "processed": "True", "content": rng.choice(["text", "code"])}]
    elif scenario == "high_novelty_multi":
        n = rng.randint(2, 3)
        ids = rng.sample(OBSERVER_IDS, n)
        signals = []
        for obs_id in ids:
            signals.append({
                "id": obs_id,
                "novelty": round(rng.uniform(0.0, 1.0), 2),
                "processed": "True",
                "content": rng.choice(["text", "code", "tool-output"]),
            })
        # Ensure at least one is high
        signals[0]["novelty"] = round(rng.uniform(0.75, 1.0), 2)
    elif scenario == "error_content":
        n = rng.randint(1, 3)
        ids = rng.sample(OBSERVER_IDS, n)
        signals = []
        for i, obs_id in enumerate(ids):
            content = "error" if i == 0 else rng.choice(["text", "code", "tool-output"])
            signals.append({
                "id": obs_id,
                "novelty": round(rng.uniform(0.0, 1.0), 2),
                "processed": "True",
                "content": content,
            })
    elif scenario == "low_novelty":
        n = rng.randint(1, 3)
        ids = rng.sample(OBSERVER_IDS, n)
        signals = []
        for obs_id in ids:
            signals.append({
                "id": obs_id,
                "novelty": round(rng.uniform(0.0, 0.39), 2),
                "processed": "True",
                "content": rng.choice(["text", "code", "tool-output"]),
            })
    elif scenario == "medium_novelty":
        n = rng.randint(1, 3)
        ids = rng.sample(OBSERVER_IDS, n)
        signals = []
        for obs_id in ids:
            signals.append({
                "id": obs_id,
                "novelty": round(rng.uniform(0.40, 0.74), 2),
                "processed": "True",
                "content": rng.choice(["text", "code", "tool-output"]),
            })
    elif scenario == "unprocessed_high":
        n = rng.randint(1, 3)
        ids = rng.sample(OBSERVER_IDS, n)
        signals = []
        for i, obs_id in enumerate(ids):
            signals.append({
                "id": obs_id,
                "novelty": round(rng.uniform(0.75, 1.0), 2),
                "processed": "False" if i == 0 else "True",
                "content": rng.choice(["text", "code"]),
            })
    elif scenario == "unprocessed_low":
        signals = [{"id": "main", "novelty": round(rng.uniform(0.0, 0.39), 2), "processed": "False", "content": "text"}]
    elif scenario == "error_low_novelty":
        # Error overrides novelty for priority
        signals = [{"id": "main", "novelty": round(rng.uniform(0.0, 0.39), 2), "processed": "True", "content": "error"}]
    elif scenario == "tool_output_medium":
        signals = [{"id": "main", "novelty": round(rng.uniform(0.40, 0.74), 2), "processed": "True", "content": "tool-output"}]
    elif scenario == "code_high":
        signals = [{"id": "main", "novelty": round(rng.uniform(0.75, 1.0), 2), "processed": "True", "content": "code"}]
    else:
        return generate_example(rng)

    priority, focus, max_novelty, note = derive_report(signals)
    return {
        "input": encode_signals(signals),
        "output": encode_report(priority, focus, max_novelty, note),
    }


def main():
    rng = random.Random(42)

    total_target = 10000  # 8000 train + 2000 holdout
    targeted_scenarios = [
        "high_novelty_single",
        "high_novelty_multi",
        "error_content",
        "low_novelty",
        "medium_novelty",
        "unprocessed_high",
        "unprocessed_low",
        "error_low_novelty",
        "tool_output_medium",
        "code_high",
    ]

    # Generate targeted examples — 100 per scenario = 1000 examples
    targeted = []
    for scenario in targeted_scenarios:
        for _ in range(100):
            targeted.append(generate_targeted_example(rng, scenario))

    # Fill rest with random
    remaining = total_target - len(targeted)
    generated = [generate_example(rng) for _ in range(remaining)]
    print(f"Targeted: {len(targeted)}, Random: {len(generated)}")

    all_entries = targeted + generated
    rng.shuffle(all_entries)

    # Distribution stats
    high = sum(1 for e in all_entries if "PRIORITY: high" in e["output"])
    medium = sum(1 for e in all_entries if "PRIORITY: medium" in e["output"])
    low = sum(1 for e in all_entries if "PRIORITY: low" in e["output"])
    with_error = sum(1 for e in all_entries if "error" in e["input"])
    print(f"\nDistribution of {len(all_entries)} entries:")
    print(f"  High priority:   {high} ({high*100//len(all_entries)}%)")
    print(f"  Medium priority: {medium} ({medium*100//len(all_entries)}%)")
    print(f"  Low priority:    {low} ({low*100//len(all_entries)}%)")
    print(f"  With error:      {with_error} ({with_error*100//len(all_entries)}%)")

    # 80/20 split
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
