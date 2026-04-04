r"""
Run B-1 inference on arbitrary interfaces from a JSONL file.
Each line: {"id": "...", "input": "interface Foo { ... }"}
Outputs predictions to stdout and saves to results/real-predictions.jsonl

Usage:
    python predict-single.py <input.jsonl>
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PHASE_DIR = SCRIPT_DIR.parent
MODELS_DIR = PHASE_DIR / "models"
RESULTS_DIR = PHASE_DIR / "results"
DEFAULT_MODEL = MODELS_DIR / "schema-grammar-qwen25-05b-lora"


def main():
    if len(sys.argv) < 2:
        print("Usage: python predict-single.py <input.jsonl>")
        sys.exit(1)

    input_path = Path(sys.argv[1])
    entries = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))

    print(f"Loaded {len(entries)} interfaces")
    print(f"Model: {DEFAULT_MODEL}")

    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM

    print("Loading model...")
    tokenizer = AutoTokenizer.from_pretrained(str(DEFAULT_MODEL))
    model = AutoModelForCausalLM.from_pretrained(
        str(DEFAULT_MODEL), dtype=torch.float16, device_map="auto"
    )
    model.eval()
    print(f"Ready on {next(model.parameters()).device}\n")

    predictions = []

    for entry in entries:
        messages = [{"role": "user", "content": entry["input"]}]
        input_ids = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt"
        ).to(model.device)

        t0 = time.time()
        with torch.no_grad():
            output_ids = model.generate(
                input_ids,
                max_new_tokens=1024,
                do_sample=False,
                pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
            )

        generated = output_ids[0][input_ids.shape[1]:]
        predicted = tokenizer.decode(generated, skip_special_tokens=True)
        elapsed = time.time() - t0

        print(f"=== {entry['id']} ({elapsed:.1f}s) ===")
        print(f"INPUT:\n{entry['input']}\n")
        print(f"GENERATED GRAMMAR:\n{predicted[:500]}")
        print(f"{'...' if len(predicted) > 500 else ''}\n")

        predictions.append({
            "id": entry["id"],
            "input": entry["input"],
            "predicted": predicted,
        })

    # Save
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = RESULTS_DIR / "real-predictions.jsonl"
    with open(out_path, "w", encoding="utf-8") as f:
        for p in predictions:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")

    print(f"\nSaved {len(predictions)} predictions to {out_path}")


if __name__ == "__main__":
    main()
