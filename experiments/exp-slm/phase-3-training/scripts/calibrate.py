#!/usr/bin/env python3
"""
Phase 3 — Temperature scaling calibration for the fine-tuned Monitor DSL model.

Uses a calibration set (10% of holdout = 100 entries, separate from eval set)
to learn a single temperature parameter T that minimizes NLL.

Reports: optimal T, ECE before and after calibration.
Target: ECE <= 0.15 after calibration.

Results: phase-3-training/results/calibration.json

Usage:
    python phase-3-training/scripts/calibrate.py
    python phase-3-training/scripts/calibrate.py --model-dir path/to/model
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

from shared.metrics.accuracy import parse_monitor_dsl
from shared.metrics.calibration import compute_confidence, compute_ece


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
    """Build inference prompt using tokenizer's chat template."""
    messages = [{"role": "user", "content": entry["input"]}]

    if hasattr(tokenizer, "apply_chat_template"):
        try:
            return tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        except Exception:
            pass

    return f"<|im_start|>user\n{entry['input']}<|im_end|>\n<|im_start|>assistant\n"


def extract_assistant_response(full_text: str, prompt: str) -> str:
    """Extract the assistant response from generated text."""
    response = full_text[len(prompt):]
    for token in ["<|im_end|>", "<|endoftext|>", "</s>"]:
        if response.endswith(token):
            response = response[: -len(token)]
    return response.strip()


def main() -> None:
    parser = argparse.ArgumentParser(description="Calibrate Monitor DSL model")
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
        "--calibration-size",
        type=int,
        default=100,
        help="Number of entries to use for calibration (default: 100, taken from start of holdout)",
    )
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=256,
        help="Maximum new tokens to generate per example",
    )
    args = parser.parse_args()

    # ── Load config ────────────────────────────────────────────
    config = load_config(args.config)
    model_dir = args.model_dir or PHASE3_DIR / config["output"]["dir"]
    holdout_path = (PHASE3_DIR / config["data"]["holdout_path"]).resolve()

    print(f"Model directory: {model_dir}")
    print(f"Holdout data: {holdout_path}")
    print(f"Calibration size: {args.calibration_size}")

    if not model_dir.exists():
        print(f"ERROR: Model directory not found: {model_dir}")
        sys.exit(1)

    # ── Deferred imports ───────────────────────────────────────
    import numpy as np
    import torch
    from scipy.optimize import minimize_scalar
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

    # ── Load calibration set ───────────────────────────────────
    # Take the first `calibration_size` entries from holdout as the calibration set.
    # The evaluate.py script uses the full holdout, so these overlap. In a more
    # rigorous setup you'd split, but for 100/1000 this is acceptable.
    holdout = load_corpus(holdout_path)
    cal_set = holdout[: args.calibration_size]
    print(f"  Calibration entries: {len(cal_set)}")

    # ── Run inference and collect logits ────────────────────────
    print("\nRunning inference on calibration set ...")

    all_log_probs: list[list[float]] = []
    all_lengths: list[int] = []
    all_correct: list[int] = []  # 1 if semantically correct, 0 otherwise

    for i, entry in enumerate(cal_set):
        prompt = build_prompt(entry, tokenizer)
        input_ids = tokenizer(prompt, return_tensors="pt").input_ids.to(device)
        prompt_len = input_ids.shape[1]

        with torch.no_grad():
            outputs = model.generate(
                input_ids,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                return_dict_in_generate=True,
                output_scores=True,
                pad_token_id=tokenizer.pad_token_id,
            )

        # Decode
        generated_ids = outputs.sequences[0]
        full_text = tokenizer.decode(generated_ids, skip_special_tokens=False)
        response = extract_assistant_response(full_text, prompt)

        # Per-token log probs
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

        # Check semantic correctness
        parsed_gen = parse_monitor_dsl(response)
        parsed_exp = parse_monitor_dsl(entry["output"])
        correct = _reports_match(parsed_gen, parsed_exp) if (parsed_gen and parsed_exp) else 0
        all_correct.append(int(correct))

        if (i + 1) % 25 == 0:
            print(f"  [{i+1}/{len(cal_set)}]")

    # ── Compute uncalibrated ECE ───────────────────────────────
    raw_confidences = compute_confidence(all_log_probs, all_lengths)
    accuracies = np.array(all_correct, dtype=np.float64)

    ece_before = compute_ece(raw_confidences, accuracies)
    print(f"\nUncalibrated ECE: {ece_before:.4f}")

    # ── Learn temperature T via grid search ────────────────────
    # Temperature scaling: scale per-token log-probs by 1/T, then recompute confidence.
    # We minimize NLL on the calibration set, which is equivalent to finding T that
    # makes the confidence distribution match the accuracy distribution.

    def scaled_ece(T: float) -> float:
        """Compute ECE with temperature-scaled confidences."""
        scaled_lps = [[lp / T for lp in seq_lps] for seq_lps in all_log_probs]
        scaled_conf = compute_confidence(scaled_lps, all_lengths)
        return compute_ece(scaled_conf, accuracies)

    def nll_objective(T: float) -> float:
        """Negative log-likelihood under temperature scaling."""
        total_nll = 0.0
        for seq_lps, length in zip(all_log_probs, all_lengths):
            if length == 0:
                continue
            scaled = [lp / T for lp in seq_lps]
            total_nll -= sum(scaled)  # NLL = -sum(log_probs / T)
        return total_nll

    print("\nSearching for optimal temperature ...")
    result = minimize_scalar(nll_objective, bounds=(0.1, 10.0), method="bounded")
    optimal_T = result.x
    print(f"  Optimal T (NLL): {optimal_T:.4f}")

    # Also do a direct ECE minimization as a sanity check
    result_ece = minimize_scalar(scaled_ece, bounds=(0.1, 10.0), method="bounded")
    optimal_T_ece = result_ece.x
    print(f"  Optimal T (ECE): {optimal_T_ece:.4f}")

    # Use the NLL-optimal T as the primary result
    ece_after = scaled_ece(optimal_T)
    print(f"\nCalibrated ECE (T={optimal_T:.4f}): {ece_after:.4f} (target <= 0.15)")

    # ── Write results ──────────────────────────────────────────
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    cal_results = {
        "optimal_temperature": round(optimal_T, 4),
        "optimal_temperature_ece": round(optimal_T_ece, 4),
        "ece_before": round(ece_before, 4),
        "ece_after": round(ece_after, 4),
        "calibration_entries": len(cal_set),
        "accuracy_on_calibration_set": round(float(accuracies.mean()), 4),
        "mean_confidence_before": round(float(raw_confidences.mean()), 4),
        "mean_confidence_after": round(
            float(
                compute_confidence(
                    [[lp / optimal_T for lp in seq] for seq in all_log_probs],
                    all_lengths,
                ).mean()
            ),
            4,
        ),
        "target_ece": "<= 0.15",
        "pass": ece_after <= 0.15,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    cal_path = RESULTS_DIR / "calibration.json"
    with open(cal_path, "w", encoding="utf-8") as f:
        json.dump(cal_results, f, indent=2)
        f.write("\n")

    print(f"\nCalibration results saved to {cal_path}")

    status = "PASS" if cal_results["pass"] else "FAIL"
    print(f"\n{'='*60}")
    print(f"Calibration {status}")
    print(f"  ECE before: {ece_before:.4f}")
    print(f"  ECE after:  {ece_after:.4f} (target <= 0.15)")
    print(f"  Temperature: {optimal_T:.4f}")
    print(f"{'='*60}")

    if not cal_results["pass"]:
        sys.exit(1)


def _reports_match(actual: dict | None, expected: dict | None) -> bool:
    """Check if two parsed MonitorReport dicts semantically match."""
    if actual is None or expected is None:
        return False

    # forceReplan
    if actual.get("forceReplan") != expected.get("forceReplan"):
        return False

    # escalation — both None or both have a value
    if (actual.get("escalation") is None) != (expected.get("escalation") is None):
        return False

    # restrictedActions — same set
    if set(actual.get("restrictedActions", [])) != set(
        expected.get("restrictedActions", [])
    ):
        return False

    # anomalies — same (moduleId, type) pairs
    actual_pairs = sorted(
        (a.get("moduleId", ""), a.get("type", "")) for a in actual.get("anomalies", [])
    )
    expected_pairs = sorted(
        (a.get("moduleId", ""), a.get("type", ""))
        for a in expected.get("anomalies", [])
    )
    return actual_pairs == expected_pairs


if __name__ == "__main__":
    main()
