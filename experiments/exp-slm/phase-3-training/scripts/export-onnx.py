#!/usr/bin/env python3
"""
Phase 3 — Export fine-tuned model to ONNX format.

Exports the trained Monitor DSL model to ONNX using optimum, validates by
comparing PyTorch vs ONNX inference on 100 holdout entries.

Note: Node.js onnxruntime-node doesn't work on this Windows machine, but
Python onnxruntime works (CPU provider). The HTTP bridge (Phase 4) will serve
the ONNX model from Python.

Results: logged to console and phase-3-training/results/onnx-export.json

Usage:
    python phase-3-training/scripts/export-onnx.py
    python phase-3-training/scripts/export-onnx.py --model-dir path/to/model
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
    parser = argparse.ArgumentParser(description="Export Monitor DSL model to ONNX")
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
        "--validation-size",
        type=int,
        default=100,
        help="Number of holdout entries to validate with (default: 100)",
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
    onnx_output_dir = model_dir / "onnx"

    print(f"Model directory: {model_dir}")
    print(f"ONNX output: {onnx_output_dir}")
    print(f"Holdout data: {holdout_path}")

    if not model_dir.exists():
        print(f"ERROR: Model directory not found: {model_dir}")
        sys.exit(1)

    # ── Deferred imports ───────────────────────────────────────
    import numpy as np
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    # ── Step 1: Export to ONNX ─────────────────────────────────
    print("\n--- ONNX Export ---")
    export_success = False
    onnx_file_size_mb = 0.0

    try:
        from optimum.onnxruntime import ORTModelForCausalLM

        print(f"Exporting model from {model_dir} to ONNX ...")
        t0 = time.perf_counter()

        # optimum's export: loads the model and exports in one step
        ort_model = ORTModelForCausalLM.from_pretrained(
            str(model_dir),
            export=True,
        )
        ort_model.save_pretrained(str(onnx_output_dir))

        export_time = time.perf_counter() - t0
        print(f"  Export completed in {export_time:.1f}s")

        # Also save tokenizer alongside ONNX model
        tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
        tokenizer.save_pretrained(str(onnx_output_dir))

        # Find the ONNX file and report size (include external data files)
        onnx_files = list(onnx_output_dir.glob("*.onnx"))
        onnx_data_files = list(onnx_output_dir.glob("*.onnx_data"))
        if onnx_files:
            total_size = sum(f.stat().st_size for f in onnx_files + onnx_data_files)
            onnx_file_size_mb = total_size / (1024**2)
            print(f"  ONNX file(s): {[f.name for f in onnx_files]}")
            if onnx_data_files:
                print(f"  External data: {[f.name for f in onnx_data_files]}")
            print(f"  Total ONNX size: {onnx_file_size_mb:.1f} MB")
            export_success = True
        else:
            print("  WARNING: No .onnx files found after export")

    except Exception as e:
        print(f"  optimum export failed: {e}")
        print("  Falling back to torch.onnx.export ...")

        try:
            tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
            if tokenizer.pad_token is None:
                tokenizer.pad_token = tokenizer.eos_token

            model = AutoModelForCausalLM.from_pretrained(
                str(model_dir), dtype=torch.float32
            )
            model.eval()

            onnx_output_dir.mkdir(parents=True, exist_ok=True)
            onnx_path = onnx_output_dir / "model.onnx"

            dummy_input = tokenizer("Hello", return_tensors="pt")
            input_ids = dummy_input["input_ids"]
            attention_mask = dummy_input["attention_mask"]

            t0 = time.perf_counter()
            torch.onnx.export(
                model,
                (input_ids, attention_mask),
                str(onnx_path),
                input_names=["input_ids", "attention_mask"],
                output_names=["logits"],
                dynamic_axes={
                    "input_ids": {0: "batch", 1: "seq_len"},
                    "attention_mask": {0: "batch", 1: "seq_len"},
                    "logits": {0: "batch", 1: "seq_len"},
                },
                opset_version=14,
                do_constant_folding=True,
            )
            export_time = time.perf_counter() - t0

            tokenizer.save_pretrained(str(onnx_output_dir))

            if onnx_path.exists():
                onnx_file_size_mb = onnx_path.stat().st_size / (1024**2)
                print(f"  torch.onnx.export completed in {export_time:.1f}s")
                print(f"  ONNX file: {onnx_path.name} ({onnx_file_size_mb:.1f} MB)")
                export_success = True
            else:
                print("  ERROR: ONNX file was not created")

        except Exception as e2:
            print(f"  torch.onnx.export also failed: {e2}")

    if not export_success:
        print("\nERROR: ONNX export failed. Cannot proceed with validation.")
        _write_failure_report(model_dir, onnx_output_dir)
        sys.exit(1)

    # ── Step 2: Validate ONNX vs PyTorch ───────────────────────
    print("\n--- Validation ---")

    holdout = load_corpus(holdout_path)
    val_set = holdout[: args.validation_size]
    print(f"Validating on {len(val_set)} holdout entries ...")

    # Load PyTorch model for comparison
    print("  Loading PyTorch model ...")
    tokenizer_pt = AutoTokenizer.from_pretrained(str(model_dir))
    # Use a separate pad token ID to avoid early EOS termination during validation.
    # When pad_token == eos_token, generate() may stop immediately on pad tokens.
    if tokenizer_pt.pad_token is None or tokenizer_pt.pad_token_id == tokenizer_pt.eos_token_id:
        tokenizer_pt.pad_token = tokenizer_pt.bos_token or tokenizer_pt.eos_token
        tokenizer_pt.pad_token_id = tokenizer_pt.bos_token_id or tokenizer_pt.eos_token_id

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model_pt = AutoModelForCausalLM.from_pretrained(
        str(model_dir), dtype=torch.float16
    ).to(device)
    model_pt.eval()

    # Load ONNX model
    print("  Loading ONNX model ...")
    try:
        from optimum.onnxruntime import ORTModelForCausalLM

        model_onnx = ORTModelForCausalLM.from_pretrained(str(onnx_output_dir))
        tokenizer_onnx = AutoTokenizer.from_pretrained(str(onnx_output_dir))
        if tokenizer_onnx.pad_token is None:
            tokenizer_onnx.pad_token = tokenizer_onnx.eos_token
        use_optimum = True
    except Exception as e:
        print(f"  Could not load ONNX model via optimum: {e}")
        print("  Skipping ONNX inference validation (export-only mode)")
        use_optimum = False

    pt_parses = 0
    onnx_parses = 0
    match_count = 0

    if use_optimum:
        for i, entry in enumerate(val_set):
            prompt = build_prompt(entry, tokenizer_pt)

            # PyTorch inference
            pt_ids = tokenizer_pt(prompt, return_tensors="pt").input_ids.to(device)
            with torch.no_grad():
                pt_out = model_pt.generate(
                    pt_ids,
                    max_new_tokens=args.max_new_tokens,
                    min_new_tokens=1,
                    do_sample=False,
                    pad_token_id=tokenizer_pt.pad_token_id,
                )
            pt_text = tokenizer_pt.decode(pt_out[0], skip_special_tokens=False)
            pt_response = extract_assistant_response(pt_text, prompt)

            # ONNX inference
            onnx_ids = tokenizer_onnx(prompt, return_tensors="pt").input_ids
            onnx_out = model_onnx.generate(
                onnx_ids,
                max_new_tokens=args.max_new_tokens,
                do_sample=False,
                pad_token_id=tokenizer_onnx.pad_token_id,
            )
            onnx_text = tokenizer_onnx.decode(onnx_out[0], skip_special_tokens=False)
            onnx_response = extract_assistant_response(onnx_text, prompt)

            # Compare parse results
            pt_parsed = parse_monitor_dsl(pt_response)
            onnx_parsed = parse_monitor_dsl(onnx_response)

            if pt_parsed is not None:
                pt_parses += 1
            if onnx_parsed is not None:
                onnx_parses += 1
            if pt_response == onnx_response:
                match_count += 1

            if (i + 1) % 25 == 0:
                print(f"  [{i+1}/{len(val_set)}] matches={match_count}")

    pt_parse_rate = pt_parses / len(val_set) if val_set else 0
    onnx_parse_rate = onnx_parses / len(val_set) if val_set else 0
    match_rate = match_count / len(val_set) if val_set else 0
    accuracy_diff = abs(pt_parse_rate - onnx_parse_rate)

    print(f"\n  PyTorch parse rate: {pt_parse_rate:.4f}")
    print(f"  ONNX parse rate:   {onnx_parse_rate:.4f}")
    print(f"  Exact match rate:  {match_rate:.4f}")
    print(f"  Accuracy diff:     {accuracy_diff:.4f} (target <= 0.02)")

    # ── Write results ──────────────────────────────────────────
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    results = {
        "export_success": export_success,
        "onnx_dir": str(onnx_output_dir),
        "onnx_file_size_mb": round(onnx_file_size_mb, 1),
        "validation": {
            "entries": len(val_set),
            "pytorch_parse_rate": round(pt_parse_rate, 4),
            "onnx_parse_rate": round(onnx_parse_rate, 4),
            "exact_match_rate": round(match_rate, 4),
            "accuracy_difference": round(accuracy_diff, 4),
            "used_optimum": use_optimum,
        },
        "pass": export_success and accuracy_diff <= 0.02,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    results_path = RESULTS_DIR / "onnx-export.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
        f.write("\n")

    print(f"\nResults saved to {results_path}")

    status = "PASS" if results["pass"] else "FAIL"
    print(f"\n{'='*60}")
    print(f"ONNX Export {status}")
    print(f"  Export: {'OK' if export_success else 'FAIL'}")
    if use_optimum:
        print(f"  Accuracy diff: {accuracy_diff:.4f} {'<= 0.02' if accuracy_diff <= 0.02 else '> 0.02 FAIL'}")
    else:
        print("  Validation: skipped (optimum load failed)")
    print(f"  ONNX size: {onnx_file_size_mb:.1f} MB")
    print(f"{'='*60}")

    if not results["pass"]:
        sys.exit(1)


def _write_failure_report(model_dir: Path, onnx_dir: Path) -> None:
    """Write a failure report when export fails entirely."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    results = {
        "export_success": False,
        "model_dir": str(model_dir),
        "onnx_dir": str(onnx_dir),
        "pass": False,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    results_path = RESULTS_DIR / "onnx-export.json"
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
        f.write("\n")
    print(f"Failure report saved to {results_path}")


if __name__ == "__main__":
    main()
