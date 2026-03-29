#!/usr/bin/env python3
"""
Phase 3 — Fine-tune SmolLM2 on the Monitor DSL corpus.

Supports full fine-tuning, LoRA, and QLoRA (via peft + bitsandbytes). When the
config YAML contains a ``lora:`` section, the model is wrapped with a LoRA adapter
before training. When a ``quantization:`` section is present, the base model is
loaded in 4-bit (NF4) via BitsAndBytesConfig and prepared for k-bit training
(QLoRA). After training, LoRA weights are merged back into the base model so the
saved checkpoint is a standard HuggingFace model (evaluate.py works unchanged).

Loads config from configs/*.yaml, fine-tunes using SFTTrainer from trl,
saves checkpoints. Reports final loss, training time, peak VRAM.

Usage:
    CUDA_VISIBLE_DEVICES=1 python phase-3-training/scripts/train.py
    CUDA_VISIBLE_DEVICES=1 python phase-3-training/scripts/train.py --config path/to/config.yaml
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
DEFAULT_CONFIG = PHASE3_DIR / "configs" / "monitor-smollm2-135m.yaml"
RESULTS_DIR = PHASE3_DIR / "results"


def load_config(config_path: Path) -> dict:
    """Load and return the YAML training config."""
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve_path(base_dir: Path, rel_path: str) -> Path:
    """Resolve a path relative to the phase-3-training directory."""
    return (base_dir / rel_path).resolve()


def load_corpus(path: Path) -> list[dict]:
    """Load a JSONL corpus file into a list of dicts."""
    entries = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries


def format_chat(entry: dict, tokenizer) -> str:
    """
    Format a corpus entry as a chat conversation using the tokenizer's
    built-in chat template.

    Falls back to manual <|im_start|> format if chat_template is unavailable.
    """
    messages = [
        {"role": "user", "content": entry["input"]},
        {"role": "assistant", "content": entry["output"]},
    ]

    # Use the tokenizer's native chat template if available
    if hasattr(tokenizer, "apply_chat_template"):
        try:
            return tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=False
            )
        except Exception:
            pass

    # Fallback: manual ChatML format (SmolLM2-Instruct uses this)
    text = f"<|im_start|>user\n{entry['input']}<|im_end|>\n"
    text += f"<|im_start|>assistant\n{entry['output']}<|im_end|>"
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune SmolLM2 on Monitor DSL")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG,
        help="Path to training config YAML",
    )
    args = parser.parse_args()

    # ── Load config ────────────────────────────────────────────
    config = load_config(args.config)
    model_cfg = config["model"]
    train_cfg = config["training"]
    data_cfg = config["data"]
    output_cfg = config["output"]
    lora_cfg = config.get("lora", None)  # Optional LoRA config
    quant_cfg = config.get("quantization", None)  # Optional QLoRA quantization config

    model_name = model_cfg["name"]
    output_dir = resolve_path(PHASE3_DIR, output_cfg["dir"])

    train_path = resolve_path(PHASE3_DIR, data_cfg["train_path"])
    holdout_path = resolve_path(PHASE3_DIR, data_cfg["holdout_path"])

    print(f"Config loaded from {args.config}")
    print(f"  Model: {model_name}")
    if quant_cfg and lora_cfg:
        print(f"  Mode: QLoRA (4-bit NF4 + LoRA r={lora_cfg['r']}, alpha={lora_cfg['lora_alpha']})")
    elif lora_cfg:
        print(f"  Mode: LoRA (r={lora_cfg['r']}, alpha={lora_cfg['lora_alpha']})")
    else:
        print(f"  Mode: Full fine-tune")
    print(f"  Train data: {train_path}")
    print(f"  Holdout data: {holdout_path}")
    print(f"  Output dir: {output_dir}")

    # ── Deferred imports (heavy) ───────────────────────────────
    import torch
    from datasets import Dataset
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    if not torch.cuda.is_available():
        print("WARNING: No CUDA GPU detected — training will run on CPU (very slow).")

    device_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU"
    print(f"  Device: {device_name}")

    # ── Load tokenizer & model ─────────────────────────────────
    print(f"\nLoading tokenizer and model: {model_name} ...")
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    # Load in FP32 — AMP handles mixed precision during training
    dtype_map = {"float32": torch.float32, "float16": torch.float16}
    load_dtype = dtype_map.get(model_cfg.get("dtype", "float32"), torch.float32)

    use_quantization = quant_cfg is not None
    if use_quantization:
        from transformers import BitsAndBytesConfig

        compute_dtype_map = {"float16": torch.float16, "float32": torch.float32}
        bnb_compute_dtype = compute_dtype_map.get(
            quant_cfg.get("bnb_4bit_compute_dtype", "float16"), torch.float16
        )
        bnb_config = BitsAndBytesConfig(
            load_in_4bit=quant_cfg.get("load_in_4bit", True),
            bnb_4bit_quant_type=quant_cfg.get("bnb_4bit_quant_type", "nf4"),
            bnb_4bit_compute_dtype=bnb_compute_dtype,
            bnb_4bit_use_double_quant=quant_cfg.get("bnb_4bit_use_double_quant", False),
        )
        print(f"  Quantization: 4-bit NF4, compute_dtype={bnb_compute_dtype}")
        model = AutoModelForCausalLM.from_pretrained(
            model_name, quantization_config=bnb_config, torch_dtype=torch.float16
        )
    else:
        model = AutoModelForCausalLM.from_pretrained(model_name, dtype=load_dtype)

    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Model loaded — {total_params / 1e6:.1f}M params, dtype={load_dtype if not use_quantization else '4-bit NF4'}")

    # ── Apply LoRA if configured ──────────────────────────────
    use_lora = lora_cfg is not None
    if use_lora:
        from peft import LoraConfig, TaskType, get_peft_model

        # For QLoRA: prepare the quantized model for k-bit training
        if use_quantization:
            from peft import prepare_model_for_kbit_training
            model = prepare_model_for_kbit_training(model)
            print("  Model prepared for k-bit training (QLoRA)")

        task_type_map = {"CAUSAL_LM": TaskType.CAUSAL_LM}
        peft_config = LoraConfig(
            r=lora_cfg["r"],
            lora_alpha=lora_cfg["lora_alpha"],
            target_modules=lora_cfg["target_modules"],
            lora_dropout=lora_cfg.get("lora_dropout", 0.0),
            bias=lora_cfg.get("bias", "none"),
            task_type=task_type_map.get(lora_cfg.get("task_type", "CAUSAL_LM"), TaskType.CAUSAL_LM),
        )
        model = get_peft_model(model, peft_config)

        # Ensure all trainable params are FP32 for AMP compatibility
        # (QLoRA/quantized models may leave LoRA params in BF16 which breaks
        # the FP16 grad scaler on SM 7.5 GPUs)
        if use_quantization:
            for param in model.parameters():
                if param.requires_grad:
                    param.data = param.data.to(torch.float32)

        trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
        print(f"  LoRA applied — trainable: {trainable_params / 1e6:.2f}M / {total_params / 1e6:.1f}M total ({100 * trainable_params / total_params:.2f}%)")
    else:
        trainable_params = total_params

    # ── Load and format datasets ───────────────────────────────
    print("\nLoading and formatting datasets ...")

    if not train_path.exists():
        print(f"ERROR: Training data not found at {train_path}")
        sys.exit(1)
    if not holdout_path.exists():
        print(f"ERROR: Holdout data not found at {holdout_path}")
        sys.exit(1)

    train_entries = load_corpus(train_path)
    holdout_entries = load_corpus(holdout_path)

    train_texts = [{"text": format_chat(e, tokenizer)} for e in train_entries]
    eval_texts = [{"text": format_chat(e, tokenizer)} for e in holdout_entries]

    train_dataset = Dataset.from_list(train_texts)
    eval_dataset = Dataset.from_list(eval_texts)

    print(f"  Train: {len(train_dataset)} examples")
    print(f"  Eval:  {len(eval_dataset)} examples")
    print(f"  Sample formatted text:\n    {train_texts[0]['text'][:200]}...")

    # ── Configure SFTTrainer ───────────────────────────────────
    output_dir.mkdir(parents=True, exist_ok=True)

    training_args = SFTConfig(
        output_dir=str(output_dir),
        max_steps=train_cfg["max_steps"],
        per_device_train_batch_size=train_cfg["per_device_train_batch_size"],
        learning_rate=train_cfg["learning_rate"],
        warmup_steps=train_cfg["warmup_steps"],
        weight_decay=train_cfg["weight_decay"],
        fp16=train_cfg["fp16"],
        bf16=train_cfg["bf16"],
        max_length=train_cfg["max_length"],
        logging_steps=train_cfg["logging_steps"],
        save_strategy=train_cfg["save_strategy"],
        save_steps=train_cfg["save_steps"],
        eval_strategy=train_cfg["eval_strategy"],
        eval_steps=train_cfg["eval_steps"],
        seed=train_cfg["seed"],
        dataset_text_field="text",
        report_to="none",
        # Avoid OOM with gradient checkpointing if needed
        gradient_accumulation_steps=1,
        # Disable find_unused_parameters for single-GPU training
        ddp_find_unused_parameters=False,
    )

    trainer = SFTTrainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
    )

    # ── Train ──────────────────────────────────────────────────
    print(f"\nStarting training: {train_cfg['max_steps']} steps ...")
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    t0 = time.perf_counter()
    train_result = trainer.train()
    elapsed = time.perf_counter() - t0

    final_loss = train_result.training_loss
    peak_vram_mb = (
        torch.cuda.max_memory_allocated() / (1024**2)
        if torch.cuda.is_available()
        else 0.0
    )

    print(f"\n{'='*60}")
    print(f"Training complete!")
    print(f"  Final loss:   {final_loss:.4f}")
    print(f"  Time:         {elapsed:.1f}s ({elapsed / 60:.1f}m)")
    print(f"  Peak VRAM:    {peak_vram_mb:.0f} MB")
    print(f"  Steps:        {train_result.global_step}")
    print(f"{'='*60}")

    # ── Save final model ───────────────────────────────────────
    if use_lora:
        print(f"\nMerging LoRA weights and saving full model to {output_dir} ...")
        # Merge LoRA adapters back into the base model
        # For QLoRA (4-bit), merge_and_unload dequantizes automatically
        merged_model = model.merge_and_unload()
        merged_model.save_pretrained(str(output_dir))
        tokenizer.save_pretrained(str(output_dir))
        print("  Merged model and tokenizer saved.")
    else:
        print(f"\nSaving final model to {output_dir} ...")
        trainer.save_model(str(output_dir))
        tokenizer.save_pretrained(str(output_dir))
        print("  Model and tokenizer saved.")

    # ── Write training report ──────────────────────────────────
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    if use_quantization and use_lora:
        method_str = f"QLoRA (4-bit NF4 + LoRA r={lora_cfg['r']}, alpha={lora_cfg['lora_alpha']})"
    elif use_lora:
        method_str = f"LoRA (r={lora_cfg['r']}, alpha={lora_cfg['lora_alpha']})"
    else:
        method_str = "full_finetune"

    report = {
        "model": model_name,
        "config": str(args.config),
        "method": method_str,
        "total_params": total_params,
        "trainable_params": trainable_params,
        "final_loss": round(final_loss, 4),
        "global_step": train_result.global_step,
        "training_time_s": round(elapsed, 1),
        "peak_vram_mb": round(peak_vram_mb, 1),
        "train_entries": len(train_dataset),
        "eval_entries": len(eval_dataset),
        "device": device_name,
        "max_steps": train_cfg["max_steps"],
        "batch_size": train_cfg["per_device_train_batch_size"],
        "learning_rate": train_cfg["learning_rate"],
        "fp16": train_cfg["fp16"],
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    report_path = RESULTS_DIR / "training-report.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")

    print(f"Training report saved to {report_path}")


if __name__ == "__main__":
    main()
