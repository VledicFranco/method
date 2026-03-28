#!/usr/bin/env python3
"""
Phase 3 — Evaluate the fine-tuned Monitor DSL model.

Loads the trained model, runs inference on the holdout set, measures:
  - Parse accuracy (target >= 95%)
  - Semantic accuracy (target >= 85%)
  - Adversarial accuracy on boundary cases (target >= 70%)
  - Confidence scores (mean, median, p95)
  - Inference latency (mean, median, p95)

Results: phase-3-training/results/training-eval.json

Usage:
    CUDA_VISIBLE_DEVICES=1 python phase-3-training/scripts/evaluate.py
    CUDA_VISIBLE_DEVICES=1 python phase-3-training/scripts/evaluate.py --model-dir path/to/model
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import yaml

# ── Paths ──────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE3_DIR = SCRIPT_DIR.parent
EXP_ROOT = PHASE3_DIR.parent
DEFAULT_CONFIG = PHASE3_DIR / "configs" / "monitor-smollm2-135m.yaml"
RESULTS_DIR = PHASE3_DIR / "results"

# Add shared modules to path
sys.path.insert(0, str(EXP_ROOT))

from shared.metrics.accuracy import (
    compute_parse_accuracy,
    compute_semantic_accuracy,
    parse_monitor_dsl,
)
from shared.metrics.calibration import compute_confidence


def load_config(config_path: Path) -> dict:
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_corpus(path: Path) -> list[dict]:
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def build_prompt(entry: dict, tokenizer) -> str:
    """
    Build the inference prompt for a single entry.
    Uses the tokenizer's chat template with add_generation_prompt=True
    so the model generates the assistant response.
    """
    messages = [{"role": "user", "content": entry["input"]}]

    if hasattr(tokenizer, "apply_chat_template"):
        try:
            return tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        except Exception:
            pass

    # Fallback: manual ChatML
    return f"<|im_start|>user\n{entry['input']}<|im_end|>\n<|im_start|>assistant\n"


def extract_assistant_response(full_text: str, prompt: str) -> str:
    """Extract just the assistant response from the full generated text."""
    response = full_text[len(prompt):]
    # Strip trailing special tokens
    for token in ["<|im_end|>", "<|endoftext|>", "</s>"]:
        if response.endswith(token):
            response = response[: -len(token)]
    return response.strip()


def classify_boundary_cases(entries: list[dict]) -> list[int]:
    """
    Identify indices of adversarial/boundary cases in the holdout set.
    These are entries that are particularly challenging:
      - Compound anomalies (multiple anomaly types)
      - Edge cases with escalation + no anomalies or vice versa
      - Complex restrict lists
    """
    indices = []
    for i, entry in enumerate(entries):
        output = entry.get("output", "")
        parsed = parse_monitor_dsl(output)
        if parsed is None:
            continue

        is_boundary = False
        anomalies = parsed.get("anomalies", [])
        has_escalation = parsed.get("escalation") is not None
        has_restrict = len(parsed.get("restrictedActions", [])) > 0
        has_replan = parsed.get("forceReplan", False)

        # Compound anomaly
        if any(a.get("type") == "compound" for a in anomalies):
            is_boundary = True
        # Multiple anomalies
        if len(anomalies) >= 3:
            is_boundary = True
        # Escalation without anomalies (edge case)
        if has_escalation and len(anomalies) == 0:
            is_boundary = True
        # Complex restrict (3+ actions)
        if len(parsed.get("restrictedActions", [])) >= 3:
            is_boundary = True
        # All flags active
        if has_escalation and has_restrict and has_replan and len(anomalies) > 0:
            is_boundary = True

        if is_boundary:
            indices.append(i)

    return indices


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate fine-tuned Monitor DSL model")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help="Path to training config YAML",
    )
    parser.add_argument(
        "--model-dir",
        type=Path,
        default=None,
        help="Path to trained model directory (overrides config)",
    )
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=256,
        help="Maximum new tokens to generate per example",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1,
        help="Inference batch size (1 for latency measurement accuracy)",
    )
    args = parser.parse_args()

    # ── Load config ────────────────────────────────────────────
    config = load_config(args.config)
    model_dir = args.model_dir or PHASE3_DIR / config["output"]["dir"]
    holdout_path = (PHASE3_DIR / config["data"]["holdout_path"]).resolve()

    print(f"Model directory: {model_dir}")
    print(f"Holdout data: {holdout_path}")

    if not model_dir.exists():
        print(f"ERROR: Model directory not found: {model_dir}")
        print("Run train.py first.")
        sys.exit(1)

    if not holdout_path.exists():
        print(f"ERROR: Holdout data not found: {holdout_path}")
        sys.exit(1)

    # ── Deferred imports ───────────────────────────────────────
    import numpy as np
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # ── Load model & tokenizer ─────────────────────────────────
    print(f"\nLoading model from {model_dir} ...")
    tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        str(model_dir), dtype=torch.float16
    ).to(device)
    model.eval()

    param_count = sum(p.numel() for p in model.parameters())
    print(f"  Model loaded — {param_count / 1e6:.1f}M params on {device}")

    # ── Load holdout set ───────────────────────────────────────
    holdout = load_corpus(holdout_path)
    print(f"  Holdout entries: {len(holdout)}")

    # ── Identify boundary cases ────────────────────────────────
    boundary_indices = set(classify_boundary_cases(holdout))
    print(f"  Boundary/adversarial cases: {len(boundary_indices)}")

    # ── Run inference ──────────────────────────────────────────
    print(f"\nRunning inference on {len(holdout)} entries ...")

    generated_outputs: list[str] = []
    all_log_probs: list[list[float]] = []
    all_lengths: list[int] = []
    latencies: list[float] = []

    for i, entry in enumerate(holdout):
        prompt = build_prompt(entry, tokenizer)
        input_ids = tokenizer(prompt, return_tensors="pt").input_ids.to(device)
        prompt_len = input_ids.shape[1]

        t0 = time.perf_counter()

        with torch.no_grad():
            outputs = model.generate(
                input_ids,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,  # greedy for reproducibility
                return_dict_in_generate=True,
                output_scores=True,
                pad_token_id=tokenizer.pad_token_id,
            )

        latency = time.perf_counter() - t0
        latencies.append(latency)

        # Decode generated tokens
        generated_ids = outputs.sequences[0]
        full_text = tokenizer.decode(generated_ids, skip_special_tokens=False)
        response = extract_assistant_response(full_text, prompt)
        generated_outputs.append(response)

        # Extract per-token log probabilities for confidence scoring
        if outputs.scores:
            token_log_probs = []
            new_token_ids = generated_ids[prompt_len:]
            for step_idx, score in enumerate(outputs.scores):
                if step_idx >= len(new_token_ids):
                    break
                log_probs_step = torch.nn.functional.log_softmax(score[0], dim=-1)
                token_id = new_token_ids[step_idx]
                token_log_probs.append(log_probs_step[token_id].item())
            all_log_probs.append(token_log_probs)
            all_lengths.append(len(token_log_probs))
        else:
            all_log_probs.append([])
            all_lengths.append(0)

        if (i + 1) % 100 == 0 or i == 0:
            print(f"  [{i+1}/{len(holdout)}] latency={latency:.3f}s")

    # ── Compute metrics ────────────────────────────────────────
    print("\nComputing metrics ...")

    # Parse accuracy
    parse_acc = compute_parse_accuracy(generated_outputs)
    print(f"  Parse accuracy:    {parse_acc:.4f} (target >= 0.95)")

    # Semantic accuracy
    parsed_outputs = [parse_monitor_dsl(o) for o in generated_outputs]
    expected_reports = [parse_monitor_dsl(e["output"]) for e in holdout]
    semantic_acc = compute_semantic_accuracy(parsed_outputs, expected_reports)
    print(f"  Semantic accuracy: {semantic_acc:.4f} (target >= 0.85)")

    # Adversarial accuracy (on boundary cases only)
    if boundary_indices:
        boundary_parsed = [parsed_outputs[i] for i in sorted(boundary_indices)]
        boundary_expected = [expected_reports[i] for i in sorted(boundary_indices)]
        adversarial_acc = compute_semantic_accuracy(boundary_parsed, boundary_expected)
    else:
        adversarial_acc = 0.0
    print(f"  Adversarial accuracy: {adversarial_acc:.4f} (target >= 0.70)")

    # Confidence scores
    confidences = compute_confidence(all_log_probs, all_lengths)
    conf_mean = float(np.mean(confidences)) if len(confidences) > 0 else 0.0
    conf_median = float(np.median(confidences)) if len(confidences) > 0 else 0.0
    conf_p95 = float(np.percentile(confidences, 95)) if len(confidences) > 0 else 0.0
    print(f"  Confidence — mean: {conf_mean:.4f}, median: {conf_median:.4f}, p95: {conf_p95:.4f}")

    # Latency
    lat_arr = np.array(latencies)
    lat_mean = float(np.mean(lat_arr))
    lat_median = float(np.median(lat_arr))
    lat_p95 = float(np.percentile(lat_arr, 95))
    print(f"  Latency (s) — mean: {lat_mean:.4f}, median: {lat_median:.4f}, p95: {lat_p95:.4f}")

    # ── Write results ──────────────────────────────────────────
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    results = {
        "model_dir": str(model_dir),
        "holdout_entries": len(holdout),
        "boundary_cases": len(boundary_indices),
        "parse_accuracy": round(parse_acc, 4),
        "semantic_accuracy": round(semantic_acc, 4),
        "adversarial_accuracy": round(adversarial_acc, 4),
        "confidence": {
            "mean": round(conf_mean, 4),
            "median": round(conf_median, 4),
            "p95": round(conf_p95, 4),
        },
        "latency_s": {
            "mean": round(lat_mean, 4),
            "median": round(lat_median, 4),
            "p95": round(lat_p95, 4),
        },
        "targets": {
            "parse_accuracy": ">= 0.95",
            "semantic_accuracy": ">= 0.85",
            "adversarial_accuracy": ">= 0.70",
        },
        "pass": {
            "parse_accuracy": parse_acc >= 0.95,
            "semantic_accuracy": semantic_acc >= 0.85,
            "adversarial_accuracy": adversarial_acc >= 0.70,
        },
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    results_path = RESULTS_DIR / "training-eval.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
        f.write("\n")

    print(f"\nResults saved to {results_path}")

    # ── Summary ────────────────────────────────────────────────
    all_pass = all(results["pass"].values())
    status = "PASS" if all_pass else "FAIL"
    print(f"\n{'='*60}")
    print(f"Evaluation {status}")
    for metric, passed in results["pass"].items():
        mark = "OK" if passed else "MISS"
        print(f"  [{mark}] {metric}: {results[metric]}")
    print(f"{'='*60}")

    if not all_pass:
        sys.exit(1)


if __name__ == "__main__":
    main()
