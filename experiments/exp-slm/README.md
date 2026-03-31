# EXP-SLM: Small Language Model Validation

Validates RFC 002's thesis: can SLMs trained on typed DSLs serve as compiled cognitive skills?

**PRD:** `docs/prds/034-slm-validation.md`
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

| Machine | GPU | VRAM | Role |
|---------|-----|------|------|
| `chobits` (SSH) | RTX 4090 | 24 GB | **Primary training host** — all new runs |
| `mission-control` (local) | RTX 2080 Ti (GPU 1) | 11 GB | ONNX inference, serve-model.py |

### Training on chobits (via SSH)

```bash
# Ensure repo is up to date on chobits first
ssh chobits "cd C:\Users\atfm0\pv-method; git pull"

# Run training (CUDA_DEVICE=0 — only GPU on chobits)
ssh chobits "cd C:\Users\atfm0\pv-method\experiments\exp-slm; set CUDA_VISIBLE_DEVICES=0; C:\Users\atfm0\miniconda3\envs\slm\python.exe phase-3-training\scripts\train.py --config phase-3-training\configs\<config>.yaml"

# Pull results back after training
scp -r "chobits:C:\Users\atfm0\pv-method\experiments\exp-slm\phase-3-training\results\*" phase-3-training/results/
```

See `docs/arch/gpu-inference-cluster.md` for full reference (model sync, ONNX export, perf estimates).

### Local (mission-control) — legacy / ONNX only

- `CUDA_VISIBLE_DEVICES=1` (GPU 0 = display, GPU 1 = 2080 Ti)
- No longer used for new training runs

## Gate Status

| Gate | Target | Result | Status |
|------|--------|--------|--------|
| Pre-Gate 0 — Infrastructure | GPU + SFTTrainer + ONNX smoke tests | All 3 pass | **PASS** |
| Gate 1 — LLM Monitor Baseline | ≥50 tokens/invocation, ≥90% valid reports | Baseline established | **PASS** |
| Gate 2 — DSL Feasibility | Parse 100%, semantics ≥90% in ≤3 revisions | 100% / 100%, 1st revision | **PASS** |
| Gate 3 — Single Module Compilation | Parse ≥95%, semantic ≥85%, adversarial ≥70% | 100% / 98.6% / 70.8% | **PASS** |
| Gate 4 Part 1 — Calibration + ONNX | ECE ≤0.15, ONNX ≤2% diff | ECE 0.0195, 100% match | **PASS** |
| Gate 4 Part 2 — Cycle Integration | Success ≥baseline-5%, cost ↓≥30%, ρ≤0.3 | SLM 100% vs 70-80% baseline, 90.3% token reduction, ρ=0.0 | **PASS** |

## Training Runs

### Phase 1 — Initial Training (SmolLM2-135M-Instruct, 134.5M params)

| Run | Corpus | Steps | Parse | Semantic | Adversarial | VRAM | Time |
|-----|--------|-------|-------|----------|-------------|------|------|
| 1 | 4K random | 1,000 | 100% | 39.2% | 11.0% | 2.95 GB | 3.8 min |
| 2 | 4K random | 5,000 | 100% | 39.3% | 11.6% | 2.95 GB | 16.8 min |
| 3 | 10K causal | 3,000 | 100% | 98.6% | 70.8% | 2.95 GB | 11.4 min |

### Phase 3 — Scaling Runs (model architecture + data volume)

| Config | Parse | Semantic | Adversarial | VRAM | Time |
|--------|-------|----------|-------------|------|------|
| SmolLM2-135M Full FT, 10K | 100% | 98.60% | 70.80% | 2951 MB | 683s |
| SmolLM2-135M Full FT, 20K | 100% | 98.64% | 73.58% | 2950 MB | 697s |
| SmolLM2-360M LoRA r=16, 10K | 100% | 98.88% | 77.36% | 2367 MB | 896s |
| Qwen2.5-0.5B LoRA r=16, 10K | 99.96% | 99.60% | 92.45% | 4466 MB | 1200s |

### Phase 4 — Stagnation Augmentation + Live Benchmark (R-09, R-11)

| Config | Corpus | SLM Success | Baseline | Token Red. | Spearman ρ | Status |
|--------|--------|-------------|----------|------------|------------|--------|
| Qwen2.5-Coder-0.5B LoRA r=16 (R-11) | monitor-v1 (10K) | 90% (9/10) | 80% | 90.2% | 0.636 | 3/4 PASS |
| Qwen2.5-Coder-0.5B LoRA r=16 (R-09) | monitor-v2 (11.76K, +stagnation) | **100% (10/10)** | 70-80% | 90.3% | **0.0** | **4/4 PASS** |

Stagnation corpus: 1,760 entries added (evaluator.diminishing + repeated actor → RESTRICT+REPLAN+ESCALATE).
Key finding: 500M SLM outperforms qwen3:8b (8B) on stagnation edge case at 90% token reduction.

### Gate 4 Part 1 — Calibration + ONNX Export

| Metric | Target | Result |
|--------|--------|--------|
| Calibration ECE (temperature scaling) | ≤ 0.15 | **0.0195** |
| ONNX export fidelity | ≤ 2% diff | **100% exact match** |

ONNX model format: `model.onnx` (1.1 MB graph) + `model.onnx_data` (1.88 GB weights). Served via Python HTTP bridge (`serve-model.py`) — Node.js `onnxruntime-node` not functional on Windows.

**Recommended config:** Qwen2.5-Coder-0.5B LoRA r=16, monitor-v2 stagnation-augmented corpus — Gate 4 Part 2 FULL PASS.

### R-08 — Multi-Module SLM Compilation (Observer + Evaluator)

Trained on chobits (RTX 4090, bf16). Both use Qwen2.5-Coder-0.5B LoRA r=16, 3000 steps.

| Module | Corpus | Train Loss | Parse | Semantic | Adversarial | Status |
|--------|--------|-----------|-------|----------|-------------|--------|
| Observer v2 | observer-v1 (10K) | 0.2613 | **100%** | **100%** | **100%** | **ALL PASS** |
| Evaluator v2 | evaluator-v1 (8K) | 0.3701 | **100%** | **96.85%** | **100%** | **ALL PASS** |

**Observer:** Perfect scores across all metrics — ready for ONNX export and integration.

**Evaluator:** Initially showed 71% parse — root cause was parser vocabulary bug (`"diverging"` vs `"regressing"`), NOT corpus quality. With fixed parser: 100% parse, 96.85% semantic, 100% adversarial. Ready for ONNX export.

**bf16 fix validated:** Original evaluator training (fp16, LR 2e-4) produced NaN loss from step 0. Switching to bf16 on RTX 4090 (Ada Lovelace, native bf16 support) resolved the gradient overflow completely.

## Structure

```
phase-0-infra/      Smoke tests (GPU, SFTTrainer, ONNX)
phase-1-llm-monitor/ LLM-backed Monitor v2 (TypeScript)
phase-2-dsl/        DSL grammar + corpus (Python + TypeScript)
phase-3-training/   SLM training + evaluation (Python)
phase-4-integration/ SLMProviderAdapter + benchmark (TypeScript)
shared/             Cross-phase: fixtures, metrics, parser
```
