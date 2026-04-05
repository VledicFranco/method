#!/usr/bin/env python3
r"""
Generate predictions from the trained Schema->Grammar SLM on the holdout set.
Outputs a JSONL file with {input, expected, predicted} for each entry.

Usage (on chobits):
    cd C:\Users\atfm0\pv-method\experiments\exp-slm
    set CUDA_VISIBLE_DEVICES=0
    C:\Users\atfm0\miniconda3\envs\slm\python.exe ^
      ..\exp-slm-composition\phase-1-schema-grammar\scripts\generate-predictions.py

Usage (local):
    CUDA_VISIBLE_DEVICES=0 python experiments/exp-slm-composition/phase-1-schema-grammar/scripts/generate-predictions.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE_DIR = SCRIPT_DIR.parent
CORPUS_DIR = PHASE_DIR / "corpus"
MODELS_DIR = PHASE_DIR / "models"
RESULTS_DIR = PHASE_DIR / "results"

DEFAULT_MODEL = MODELS_DIR / "schema-grammar-qwen25-05b-lora"
HOLDOUT_PATH = CORPUS_DIR / "holdout.jsonl"


def load_holdout(path: Path) -> list[dict]:
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=str, default=str(DEFAULT_MODEL))
    parser.add_argument("--holdout", type=str, default=str(HOLDOUT_PATH))
    parser.add_argument("--output", type=str, default=None, help="Output path (default: results/predictions.jsonl)")
    parser.add_argument("--max-entries", type=int, default=0, help="0 = all")
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    holdout_path = Path(args.holdout)

    print(f"Model: {model_dir}")
    print(f"Holdout: {holdout_path}")

    # Load holdout
    entries = load_holdout(holdout_path)
    if args.max_entries > 0:
        entries = entries[:args.max_entries]
    print(f"Entries: {len(entries)}")

    # Load model
    print("Loading model...")
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM

    tokenizer = AutoTokenizer.from_pretrained(str(model_dir))
    model = AutoModelForCausalLM.from_pretrained(
        str(model_dir), dtype=torch.float16, device_map="auto"
    )
    model.eval()
    print(f"Model loaded on {next(model.parameters()).device}")

    # Generate predictions
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = Path(args.output) if args.output else RESULTS_DIR / "predictions.jsonl"

    predictions = []
    start = time.time()

    for i, entry in enumerate(entries):
        messages = [{"role": "user", "content": entry["input"]}]
        input_ids = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt"
        ).to(model.device)

        with torch.no_grad():
            output_ids = model.generate(
                input_ids,
                max_new_tokens=1024,
                do_sample=False,
                temperature=1.0,
                pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
            )

        # Decode only the generated tokens (not the input)
        generated = output_ids[0][input_ids.shape[1]:]
        predicted = tokenizer.decode(generated, skip_special_tokens=True)

        predictions.append({
            "input": entry["input"],
            "expected": entry["output"],
            "predicted": predicted,
        })

        if (i + 1) % 50 == 0:
            elapsed = time.time() - start
            rate = (i + 1) / elapsed
            print(f"  {i+1}/{len(entries)} ({rate:.1f} it/s)")

    elapsed = time.time() - start
    print(f"\nGenerated {len(predictions)} predictions in {elapsed:.1f}s")

    # Save
    with open(out_path, "w", encoding="utf-8") as f:
        for p in predictions:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    print(f"Saved to {out_path}")


if __name__ == "__main__":
    main()
