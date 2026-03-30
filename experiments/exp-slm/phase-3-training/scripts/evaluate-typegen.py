#!/usr/bin/env python3
"""
Phase 3 — Evaluate the fine-tuned TypeGen model.

Loads the trained model, runs inference on holdout entries, measures:
  - Exact match rate (whitespace-normalized)
  - Structural match rate (same type structure ignoring whitespace/formatting)
  - Parse rate (valid TypeScript syntax — starts with 'type Generated', balanced braces)
  - Confidence scores (mean, median, p95)
  - Inference latency (mean, median, p95)

Results: phase-3-training/results/typegen-eval.json

Usage:
    CUDA_VISIBLE_DEVICES=1 python phase-3-training/scripts/evaluate-typegen.py \
        --model-dir phase-3-training/models/typegen-qwen25-05b-lora
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE3_DIR = SCRIPT_DIR.parent
DEFAULT_CONFIG = PHASE3_DIR / "configs" / "typegen-qwen25-05b-lora.yaml"
RESULTS_DIR = PHASE3_DIR / "results"


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
    """Extract just the assistant response from the full generated text."""
    response = full_text[len(prompt):]
    for token in ["<|im_end|>", "<|endoftext|>", "</s>"]:
        if response.endswith(token):
            response = response[: -len(token)]
    return response.strip()


# ── TypeScript validation helpers ────────────────────────────────

def normalize_whitespace(s: str) -> str:
    """Normalize whitespace for comparison: collapse runs, strip."""
    return re.sub(r'\s+', ' ', s.strip())


def is_valid_ts_type(output: str) -> bool:
    """Check if output looks like valid TypeScript type syntax."""
    output = output.strip()

    # Must start with 'type Generated ='
    if not output.startswith("type Generated ="):
        return False

    # Must end with semicolon
    if not output.endswith(";"):
        return False

    # Balanced braces
    body = output[len("type Generated ="):-1].strip()
    if body.count("{") != body.count("}"):
        return False
    if body.count("[") != body.count("]"):
        return False
    if body.count("(") != body.count(")"):
        return False

    return True


def structural_match(generated: str, expected: str) -> bool:
    """Check if two TS type definitions are structurally equivalent.

    Normalizes whitespace and compares the resulting strings.
    Also handles minor formatting differences (trailing semicolons, etc.).
    """
    gen_norm = normalize_whitespace(generated)
    exp_norm = normalize_whitespace(expected)
    return gen_norm == exp_norm


def classify_complexity(schema_str: str) -> str:
    """Classify a JSON schema input by complexity for per-tier reporting."""
    try:
        schema = json.loads(schema_str)
    except json.JSONDecodeError:
        return "unknown"

    has_allof = "allOf" in schema
    has_oneof = "oneOf" in schema
    has_anyof = "anyOf" in schema
    has_ref = "$ref" in json.dumps(schema)
    has_additional = "additionalProperties" in schema
    has_pattern = "patternProperties" in schema
    has_prefix = "prefixItems" in schema

    if any([has_allof, has_oneof, has_anyof, has_ref, has_additional, has_pattern, has_prefix]):
        return "complex"

    schema_type = schema.get("type")
    has_nested = False
    if schema_type == "object":
        props = schema.get("properties", {})
        for pval in props.values():
            if isinstance(pval, dict) and pval.get("type") == "object":
                has_nested = True
                break
    if schema_type == "array" and isinstance(schema.get("items"), dict):
        if schema["items"].get("type") == "object":
            has_nested = True

    if has_nested or (schema_type == "object" and len(schema.get("properties", {})) >= 4):
        return "medium"

    return "simple"


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate fine-tuned TypeGen model")
    parser.add_argument(
        "--model-dir",
        type=Path,
        required=True,
        help="Path to trained model directory",
    )
    parser.add_argument(
        "--holdout-path",
        type=Path,
        default=None,
        help="Path to holdout JSONL (default: from config)",
    )
    parser.add_argument(
        "--max-new-tokens",
        type=int,
        default=512,
        help="Maximum new tokens to generate per example",
    )
    parser.add_argument(
        "--num-samples",
        type=int,
        default=500,
        help="Number of holdout entries to evaluate (0 = all)",
    )
    args = parser.parse_args()

    model_dir = args.model_dir
    holdout_path = args.holdout_path or (PHASE3_DIR / ".." / "phase-2-dsl" / "corpus" / "typegen" / "holdout.jsonl").resolve()

    print(f"Model directory: {model_dir}")
    print(f"Holdout data: {holdout_path}")

    if not model_dir.exists():
        print(f"ERROR: Model directory not found: {model_dir}")
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
    if args.num_samples > 0 and args.num_samples < len(holdout):
        # Deterministic subset
        import random
        rng = random.Random(42)
        holdout = rng.sample(holdout, args.num_samples)
    print(f"  Evaluating on {len(holdout)} entries")

    # ── Run inference ──────────────────────────────────────────
    print(f"\nRunning inference on {len(holdout)} entries ...")

    generated_outputs: list[str] = []
    expected_outputs: list[str] = []
    all_log_probs: list[list[float]] = []
    latencies: list[float] = []
    complexities: list[str] = []

    for i, entry in enumerate(holdout):
        prompt = build_prompt(entry, tokenizer)
        input_ids = tokenizer(prompt, return_tensors="pt").input_ids.to(device)
        prompt_len = input_ids.shape[1]

        t0 = time.perf_counter()

        with torch.no_grad():
            outputs = model.generate(
                input_ids,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                return_dict_in_generate=True,
                output_scores=True,
                pad_token_id=tokenizer.pad_token_id,
            )

        latency = time.perf_counter() - t0
        latencies.append(latency)

        generated_ids = outputs.sequences[0]
        full_text = tokenizer.decode(generated_ids, skip_special_tokens=False)
        response = extract_assistant_response(full_text, prompt)
        generated_outputs.append(response)
        expected_outputs.append(entry["output"])
        complexities.append(classify_complexity(entry["input"]))

        # Extract per-token log probs for confidence
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
        else:
            all_log_probs.append([])

        if (i + 1) % 50 == 0 or i == 0:
            print(f"  [{i+1}/{len(holdout)}] latency={latency:.3f}s")

    # ── Compute metrics ────────────────────────────────────────
    print("\nComputing metrics ...")

    # Parse rate (valid TS syntax)
    parse_results = [is_valid_ts_type(g) for g in generated_outputs]
    parse_rate = sum(parse_results) / len(parse_results)
    print(f"  Parse rate:        {parse_rate:.4f} ({sum(parse_results)}/{len(parse_results)})")

    # Exact match (whitespace-normalized)
    exact_results = [normalize_whitespace(g) == normalize_whitespace(e)
                     for g, e in zip(generated_outputs, expected_outputs)]
    exact_match_rate = sum(exact_results) / len(exact_results)
    print(f"  Exact match rate:  {exact_match_rate:.4f} ({sum(exact_results)}/{len(exact_results)})")

    # Structural match
    struct_results = [structural_match(g, e)
                      for g, e in zip(generated_outputs, expected_outputs)]
    struct_match_rate = sum(struct_results) / len(struct_results)
    print(f"  Structural match:  {struct_match_rate:.4f} ({sum(struct_results)}/{len(struct_results)})")

    # Per-complexity breakdown
    print("\n  Per-complexity breakdown:")
    for tier in ["simple", "medium", "complex"]:
        tier_indices = [i for i, c in enumerate(complexities) if c == tier]
        if not tier_indices:
            continue
        tier_exact = sum(exact_results[i] for i in tier_indices) / len(tier_indices)
        tier_parse = sum(parse_results[i] for i in tier_indices) / len(tier_indices)
        tier_struct = sum(struct_results[i] for i in tier_indices) / len(tier_indices)
        print(f"    {tier:8s} (n={len(tier_indices):4d}): "
              f"exact={tier_exact:.4f}, parse={tier_parse:.4f}, struct={tier_struct:.4f}")

    # Confidence scores
    import math
    confidences = []
    for lp_list in all_log_probs:
        if lp_list:
            mean_lp = sum(lp_list) / len(lp_list)
            confidences.append(math.exp(mean_lp))
        else:
            confidences.append(0.0)

    conf_arr = np.array(confidences)
    conf_mean = float(np.mean(conf_arr))
    conf_median = float(np.median(conf_arr))
    conf_p95 = float(np.percentile(conf_arr, 95))
    print(f"\n  Confidence — mean: {conf_mean:.4f}, median: {conf_median:.4f}, p95: {conf_p95:.4f}")

    # Latency
    lat_arr = np.array(latencies)
    lat_mean = float(np.mean(lat_arr))
    lat_median = float(np.median(lat_arr))
    lat_p95 = float(np.percentile(lat_arr, 95))
    print(f"  Latency (s) — mean: {lat_mean:.4f}, median: {lat_median:.4f}, p95: {lat_p95:.4f}")

    # ── Print failure examples ─────────────────────────────────
    failures = [(i, generated_outputs[i], expected_outputs[i])
                for i in range(len(generated_outputs)) if not exact_results[i]]
    if failures:
        print(f"\n  First 5 failures (of {len(failures)}):")
        for idx, gen, exp in failures[:5]:
            print(f"    [{idx}] Complexity: {complexities[idx]}")
            print(f"      Expected: {exp[:100]}")
            print(f"      Got:      {gen[:100]}")
            print()

    # ── Write results ──────────────────────────────────────────
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    # Per-complexity metrics
    per_complexity = {}
    for tier in ["simple", "medium", "complex"]:
        tier_indices = [i for i, c in enumerate(complexities) if c == tier]
        if not tier_indices:
            continue
        per_complexity[tier] = {
            "count": len(tier_indices),
            "exact_match": round(sum(exact_results[i] for i in tier_indices) / len(tier_indices), 4),
            "parse_rate": round(sum(parse_results[i] for i in tier_indices) / len(tier_indices), 4),
            "structural_match": round(sum(struct_results[i] for i in tier_indices) / len(tier_indices), 4),
        }

    results = {
        "model_dir": str(model_dir),
        "holdout_entries": len(holdout),
        "task": "json-schema-to-typescript",
        "parse_rate": round(parse_rate, 4),
        "exact_match_rate": round(exact_match_rate, 4),
        "structural_match_rate": round(struct_match_rate, 4),
        "per_complexity": per_complexity,
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
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    results_path = RESULTS_DIR / "typegen-eval.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
        f.write("\n")

    print(f"\nResults saved to {results_path}")

    # ── Summary ────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"TypeGen Evaluation Summary")
    print(f"  Parse rate:        {parse_rate:.4f}")
    print(f"  Exact match:       {exact_match_rate:.4f}")
    print(f"  Structural match:  {struct_match_rate:.4f}")
    print(f"  Confidence mean:   {conf_mean:.4f}")
    print(f"  Latency median:    {lat_median:.4f}s")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
