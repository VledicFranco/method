#!/usr/bin/env python3
"""
Phase 0 — SFT Trainer smoke test.

Downloads SmolLM2-135M-Instruct (or uses HF cache), creates a tiny
dummy dataset, runs exactly 1 SFTTrainer step on GPU with FP16,
and reports peak VRAM / timing.

Results are appended to phase-0-infra/results/infra-report.json.
Exit 0 on pass, 1 on fail.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
REPORT_PATH = RESULTS_DIR / "infra-report.json"

MODEL_ID = "HuggingFaceTB/SmolLM2-135M-Instruct"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def _check_imports() -> None:
    """Early exit with a helpful message if deps are missing."""
    missing: list[str] = []
    for mod in ("torch", "transformers", "trl", "datasets"):
        try:
            __import__(mod)
        except ImportError:
            missing.append(mod)
    if missing:
        fail(
            f"Missing Python packages: {', '.join(missing)}. "
            "Install the Python environment first: pip install -e '.[dev]' "
            "from experiments/exp-slm/"
        )


def main() -> None:
    _check_imports()

    import torch  # type: ignore[import-untyped]
    from datasets import Dataset  # type: ignore[import-untyped]
    from transformers import AutoModelForCausalLM, AutoTokenizer  # type: ignore[import-untyped]
    from trl import SFTConfig, SFTTrainer  # type: ignore[import-untyped]

    if not torch.cuda.is_available():
        fail("No CUDA GPU available — cannot run SFT smoke test.")

    device = torch.device("cuda")

    # -----------------------------------------------------------
    # 1. Load model & tokenizer
    # -----------------------------------------------------------
    print(f"Loading model {MODEL_ID} ...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        torch_dtype=torch.float16,
    )
    print(f"  Model loaded — {sum(p.numel() for p in model.parameters()) / 1e6:.1f}M params")

    # -----------------------------------------------------------
    # 2. Tiny dummy dataset  (10 chat-formatted examples)
    # -----------------------------------------------------------
    examples = [
        {"text": f"<|im_start|>user\nWhat is {i}+{i}?<|im_end|>\n<|im_start|>assistant\n{i+i}<|im_end|>"}
        for i in range(10)
    ]
    dataset = Dataset.from_list(examples)
    print(f"  Dataset: {len(dataset)} examples")

    # -----------------------------------------------------------
    # 3. SFTTrainer — 1 step, FP16
    # -----------------------------------------------------------
    output_dir = str(RESULTS_DIR / "sft-scratch")

    training_args = SFTConfig(
        output_dir=output_dir,
        max_steps=1,
        per_device_train_batch_size=2,
        fp16=True,
        bf16=False,
        logging_steps=1,
        save_strategy="no",
        report_to="none",
        dataset_text_field="text",
        max_seq_length=64,
    )

    torch.cuda.reset_peak_memory_stats(device)
    t0 = time.perf_counter()

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        processing_class=tokenizer,
    )

    train_result = trainer.train()
    elapsed = time.perf_counter() - t0

    peak_vram_mb = torch.cuda.max_memory_allocated(device) / (1024**2)

    print(f"\n  1 training step completed in {elapsed:.2f}s")
    print(f"  Peak VRAM: {peak_vram_mb:.0f} MB")
    print(f"  Train loss: {train_result.training_loss:.4f}")

    # -----------------------------------------------------------
    # 4. Append results to infra-report.json
    # -----------------------------------------------------------
    report: dict = {}
    if REPORT_PATH.exists():
        try:
            report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass  # overwrite corrupt file

    report["sft_smoke_test"] = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "model_id": MODEL_ID,
        "torch_version": torch.__version__,
        "cuda_device": torch.cuda.get_device_name(device),
        "fp16": True,
        "bf16": False,
        "max_steps": 1,
        "batch_size": 2,
        "peak_vram_mb": round(peak_vram_mb, 1),
        "step_time_s": round(elapsed, 3),
        "train_loss": round(train_result.training_loss, 4),
        "pass": True,
    }

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"\nReport updated at {REPORT_PATH}")

    # -----------------------------------------------------------
    # 5. Cleanup scratch dir
    # -----------------------------------------------------------
    import shutil

    scratch = RESULTS_DIR / "sft-scratch"
    if scratch.exists():
        shutil.rmtree(scratch, ignore_errors=True)

    print("\nPASS: SFT smoke test succeeded.")


if __name__ == "__main__":
    main()
