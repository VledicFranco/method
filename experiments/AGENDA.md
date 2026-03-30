# Research Agenda — pv-method

Prioritized research backlog. See `PROTOCOL.md §5` for the claim protocol.

---

## Active Research Lines

### Line 1: SLM Compilation (RFC 002)
Can small models trained on typed DSLs replace frontier LLM calls in cognitive modules?

### Line 2: Cognitive Architecture Validation (RFC 001)
Does the 8-module cognitive cycle with default-interventionist monitoring outperform
flat ReAct agents on strategy-shift recovery tasks?

---

## Backlog

| ID | Experiment | Question | Status | Claimed By | Updated |
|----|-----------|----------|--------|------------|---------|
| R-02 | exp-cognitive-baseline | Increase N from 3 to 10 on Task 01 (statistical significance) | open | — | 2026-03-29 |
| R-03 | exp-cognitive-baseline | Run Tasks 02-05 under all 3 conditions (A/B/C) | open | — | 2026-03-29 |
| R-08 | exp-slm | Multi-module scaling: compile Observer + Evaluator after Monitor validated | open | — | 2026-03-29 |

---

## Completed

| ID | Experiment | Result | Date | Log Entries |
|----|-----------|--------|------|-------------|
| R-00a | exp-slm | Gate 0 (DSL feasibility): PASS — 100% parse, 100% semantic | 2026-03-28 | log/2026-03-28-exp-slm-phase0.yaml |
| R-00b | exp-slm | Gate 3 (SLM compilation): PASS — 100% parse, 98.6% semantic | 2026-03-28 | log/2026-03-28-exp-slm-run3.yaml |
| R-01 | exp-slm | Gate 4 Part 1 PASS + 7-point scaling curve. Calibration ECE 0.02, ONNX 100% match. Best: Qwen2.5-Coder-0.5B LoRA r=32 (93.4% adversarial). JSON→TS generalization: 99.6% exact match. | 2026-03-29 | log/2026-03-29-exp-slm-calibration.yaml, log/2026-03-29-exp-slm-onnx-export.yaml, log/2026-03-29-exp-slm-135m-20k.yaml, log/2026-03-29-exp-slm-360m-lora.yaml, log/2026-03-29-exp-slm-qwen05b-lora.yaml, log/2026-03-29-exp-slm-qwen05b-lora-r32.yaml, log/2026-03-29-exp-slm-qwen-coder-05b-lora.yaml, log/2026-03-29-exp-slm-typegen.yaml |
| R-04 | exp-metacognitive-error | v2 Monitor 11x better at subtle errors (E3: 37.9% vs 3.4% EDR). FPR tradeoff: v2 mean FPR 20.2% vs v1 0%. Gates: G1 PASS, G2 FAIL (v2 FPR), G3 PASS. | 2026-03-29 | log/2026-03-29-exp-metacognitive-error-full.yaml |
| R-05 | exp-workspace-efficiency | PriorityAttend 27.3% token savings vs unlimited, 91% success rate. Eviction quality 25% better than default salience. Gates: G0 PASS, G1 PASS, G2 PARTIAL PASS. | 2026-03-29 | log/2026-03-29-exp-workspace-efficiency-core.yaml |
| R-06 | exp-interventionist-cost | Always-on free (1.07x cost, 93% success). EVC interventionist 1.42x cost but 67% success — worse than baseline. Gate: PARTIAL (cost met, quality missed). | 2026-03-29 | log/2026-03-29-exp-interventionist-cost-core.yaml |
| R-07 | exp-advanced-patterns | All patterns combined degrades performance to 22% success (vs 75% baseline). Context pollution + workspace saturation. Selective activation needed. | 2026-03-29 | log/2026-03-29-exp-advanced-patterns-core.yaml |
