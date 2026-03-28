# EXP-SLM: Small Language Model Validation

Validates RFC 002's thesis: can SLMs trained on typed DSLs serve as compiled cognitive skills?

**PRD:** `docs/prds/033-slm-validation.md`
**RFC:** `docs/rfcs/002-small-language-models.md`
**Plan:** `.method/sessions/forge-plan-20260328-0330-slm-validation/realize-plan.md`

## Setup

```bash
make setup          # creates Python venv + installs Node deps
```

Requires: Python 3.11+, Node.js 22+, NVIDIA GPU with CUDA, GNU Make.

## Phases

```bash
make phase-0        # Smoke tests: GPU, SFTTrainer, ONNX Runtime
make phase-1        # LLM Monitor v2: collect traces, measure baseline
make phase-2        # DSL design + corpus generation + validation
make phase-3        # SLM training + evaluation + ONNX export
make phase-4        # Integration benchmark: SLM vs LLM Monitor
```

Each phase has a hard gate. Check `results/` in each phase directory for metrics.

## Hardware

- GPU 1: RTX 2080 Ti (11GB VRAM) — training + inference
- GPU 0: Display GPU — do not use for training
- Training uses `CUDA_VISIBLE_DEVICES=1` by default

## Structure

```
phase-0-infra/      Smoke tests (GPU, SFTTrainer, ONNX)
phase-1-llm-monitor/ LLM-backed Monitor v2 (TypeScript)
phase-2-dsl/        DSL grammar + corpus (Python + TypeScript)
phase-3-training/   SLM training + evaluation (Python)
phase-4-integration/ SLMProviderAdapter + benchmark (TypeScript)
shared/             Cross-phase: fixtures, metrics, parser
```
