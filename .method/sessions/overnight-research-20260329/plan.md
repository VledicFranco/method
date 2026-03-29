# Overnight Research Plan — 2026-03-29 (Revised)

## Architecture

Orchestrator (this session or a fresh one) manages 6 waves of work.
GPU agents run in-place (need venv + GPU). CPU agents run in worktrees (isolated).
Each wave launches when the previous completes. Notifications drive the chain.

**Total estimated time: 6-7 hours**
**Total agents: ~12 across 6 waves**

**Pre-requisite:** Leave terminal open. Agent completion notifications drive the chain.

---

## Wave 0 — Parallel CPU Work (5 agents, ~20 min each)

All independent, no GPU needed. Launch simultaneously.

| Agent | Isolation | Work | Output |
|-------|-----------|------|--------|
| A1 | in-place | Generate 20K causally consistent corpus | `experiments/exp-slm/phase-2-dsl/corpus/monitor-v2/train-20k.jsonl` |
| A2 | worktree | Design `exp-workspace-efficiency` (R-05) | New experiment directory with README, run.ts, configs |
| A3 | worktree | Design `exp-metacognitive-error` (R-04) | New experiment directory with README, run.ts, error-injection.ts |
| A4 | worktree | Design `exp-interventionist-cost` (R-06) | New experiment directory with README, run.ts, configs |
| A5 | worktree | Design `exp-advanced-patterns` (R-07) | New experiment directory with README, run.ts |

**After Wave 0:** Merge all worktree branches to master. Commit corpus in-place.

---

## Wave 1 — Gate 4 Part 1: Calibrate + Export (1 GPU agent, ~40 min)

| Agent | Isolation | Work |
|-------|-----------|------|
| A6 | in-place | 1. `CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/calibrate.py --model-dir phase-3-training/models/monitor-smollm2-135m-run3` |
| | | 2. `CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/export-onnx.py --model-dir phase-3-training/models/monitor-smollm2-135m-run3` |
| | | 3. Write log entries to `experiments/log/` |
| | | 4. Update FINDINGS.md with calibration ECE and ONNX accuracy delta |

**Acceptance:**
- ECE ≤ 0.15 after temperature scaling
- ONNX export accuracy within 2% of PyTorch
- Log entries per PROTOCOL.md

---

## Wave 2 — Scaling Run A: 135M on 20K corpus (1 GPU agent, ~90 min)

| Agent | Isolation | Work |
|-------|-----------|------|
| A7 | in-place | 1. Create config `monitor-smollm2-135m-20k.yaml` (3000 steps, 20K corpus from Wave 0) |
| | | 2. `CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/train.py --config ...` |
| | | 3. `CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/evaluate.py --model-dir ...` |
| | | 4. Write log entry, commit results |

**Tests:** Does 20K corpus (vs 10K) improve semantic accuracy beyond 98.6%? Especially adversarial accuracy (currently 70.8%).

---

## Wave 3 — Scaling Run B: 360M LoRA on 10K corpus (1 GPU agent, ~90 min)

| Agent | Isolation | Work |
|-------|-----------|------|
| A8 | in-place | 1. Download SmolLM2-360M-Instruct if not cached (~720MB) |
| | | 2. Create config `monitor-smollm2-360m-lora.yaml` (3000 steps, LoRA r=16, 10K corpus) |
| | | 3. Train with LoRA: `CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/train.py --config ...` |
| | | 4. Evaluate on holdout |
| | | 5. Write log entry, commit results |

**Tests:** Does 360M params (vs 135M) improve accuracy? LoRA keeps VRAM under 11GB.

**Training script needs:** The train.py must support LoRA config. Check if it already does — if not, the agent adds LoRA support via peft.

---

## Wave 4 — Scaling Run C: Qwen2.5-0.5B QLoRA on 10K corpus (1 GPU agent, ~105 min)

| Agent | Isolation | Work |
|-------|-----------|------|
| A9 | in-place | 1. Download Qwen2.5-0.5B-Instruct if not cached (~1GB) |
| | | 2. Create config `monitor-qwen25-05b-qlora.yaml` (3000 steps, QLoRA 4-bit, 10K corpus) |
| | | 3. Train with QLoRA: needs bitsandbytes for 4-bit quantization |
| | | 4. Evaluate on holdout |
| | | 5. Write log entry, commit results |

**Tests:** Does 500M params with QLoRA outperform 135M full fine-tune? Different architecture (Qwen vs SmolLM2) — tests generalization.

**Risk:** bitsandbytes may not work on Windows. If QLoRA fails, fall back to LoRA (FP16, higher VRAM).

---

## Wave 5 — Analysis + Documentation (3 CPU agents, parallel, ~30 min)

| Agent | Isolation | Work |
|-------|-----------|------|
| A10 | worktree | Compile scaling analysis: all runs into a single comparison table + scaling curve description. Update FINDINGS.md with complete cross-model results. |
| A11 | worktree | Update RFC 002 Implementation Status with Gate 4 results + scaling data. Update PRD 034 Implementation Status. |
| A12 | worktree | Distill new findings to `ov-research/knowledge/slm-compilation/`. Add scaling-curve.md. Update KNOWLEDGE-LOG.md. |

**After Wave 5:** Merge all branches. Update AGENDA.md (R-01 done, R-04/R-05/R-06/R-07 designed).

---

## Dependency DAG

```
Wave 0:  A1 ─────────────────────────────────────────┐
         A2, A3, A4, A5 (parallel, independent)      │
                                                      │
Wave 1:  A6 (calibrate + export, needs Run 3 model)  │
                                                      │
Wave 2:  A7 (train 135M on 20K, needs A1 corpus) ◄───┘

Wave 3:  A8 (train 360M LoRA, needs GPU free)

Wave 4:  A9 (train 500M QLoRA, needs GPU free)

Wave 5:  A10, A11, A12 (parallel, need all results)
```

GPU chain: A6 → A7 → A8 → A9 (sequential, ~5.5 hours)
CPU work: A1-A5 (parallel, 20 min), A10-A12 (parallel, 30 min)

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| bitsandbytes fails on Windows (Wave 4) | Fall back to LoRA FP16 for Qwen2.5-0.5B |
| SmolLM2-360M download fails | Skip Wave 3, proceed to Wave 4 |
| ONNX export fails | Log failure, proceed with scaling runs anyway |
| Terminal closes mid-chain | Waves complete in isolation; resume by checking what's done |
| Model evaluation takes >60 min | Budget 90 min per GPU wave to be safe |

---

## What PO Wakes Up To

1. **Gate 4 results** — calibration ECE + ONNX export validation
2. **Scaling curve** — 4 data points: 135M/10K, 135M/20K, 360M/10K, 500M/10K
3. **4 new experiments** designed and ready to run (R-04 through R-07)
4. **Updated RFC 002** with comprehensive empirical results
5. **Updated ov-research** with scaling findings
6. **12 log entries** in `experiments/log/`
7. **AGENDA.md** updated with completion status

---

## Commands Reference (for orchestrator)

```bash
# All GPU work runs from this directory:
cd experiments/exp-slm

# Calibrate
CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/calibrate.py --model-dir phase-3-training/models/monitor-smollm2-135m-run3

# ONNX Export
CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/export-onnx.py --model-dir phase-3-training/models/monitor-smollm2-135m-run3

# Train (with config)
CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/train.py --config phase-3-training/configs/{config}.yaml

# Evaluate
CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python phase-3-training/scripts/evaluate.py --model-dir phase-3-training/models/{model-dir}

# Machine verification
CUDA_VISIBLE_DEVICES=1 .venv/Scripts/python ../verify-machine.py
```

---

## Orchestrator Notes

- **GPU agents MUST run in-place** (not worktree) — they need the .venv at experiments/exp-slm/.venv/
- **CPU agents run in worktrees** — isolated, no conflicts
- **After each GPU wave:** commit results to master before launching next GPU agent
- **train.py may need modification** for LoRA/QLoRA support — Wave 3/4 agents should check and add if missing
- **install bitsandbytes** before Wave 4: `.venv/Scripts/pip install bitsandbytes`
