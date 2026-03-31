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
| R-08 | exp-slm | Multi-module: Observer v2 ALL PASS + ONNX PASS. Evaluator v2 ALL PASS (100%/96.85%/100%) — parser bug fixed, ONNX pending. Both modules gate-passing. | in-progress | — | 2026-03-30 |
| R-13 | exp-cognitive-baseline | Constraint blindness fix. RFC 003 drafted + reviewed. Phase 0: pin flag (~50 lines) as minimum viable fix. Phase 1+: partitioned workspace. | designed | — | 2026-03-30 |

---

## Completed

| ID | Experiment | Result | Date | Log Entries |
|----|-----------|--------|------|-------------|
| R-00a | exp-slm | Gate 0 (DSL feasibility): PASS — 100% parse, 100% semantic | 2026-03-28 | log/2026-03-28-exp-slm-phase0.yaml |
| R-00b | exp-slm | Gate 3 (SLM compilation): PASS — 100% parse, 98.6% semantic | 2026-03-28 | log/2026-03-28-exp-slm-run3.yaml |
| R-01 | exp-slm | Gate 4 Part 1 PASS + 7-point scaling curve. Calibration ECE 0.02, ONNX 100% match. Best: Qwen2.5-Coder-0.5B LoRA r=32 (93.4% adversarial). JSON→TS generalization: 99.6% exact match. | 2026-03-29 | log/2026-03-29-exp-slm-calibration.yaml, log/2026-03-29-exp-slm-onnx-export.yaml, log/2026-03-29-exp-slm-135m-20k.yaml, log/2026-03-29-exp-slm-360m-lora.yaml, log/2026-03-29-exp-slm-qwen05b-lora.yaml, log/2026-03-29-exp-slm-qwen05b-lora-r32.yaml, log/2026-03-29-exp-slm-qwen-coder-05b-lora.yaml, log/2026-03-29-exp-slm-typegen.yaml |
| R-11 | exp-slm | Gate 4 Part 2 PARTIAL PASS (3/4). Qwen2.5-Coder-0.5B ONNX live benchmark: SLM 90% vs qwen3:8b 80%. 90.2% token reduction. 0 escalations. Spearman gate fails (d=10 only failure, correlated with difficulty). Stagnation gap confirmed. | 2026-03-30 | log/2026-03-30-exp-slm-r11.yaml |
| R-09 | exp-slm | Gate 4 Part 2 FULL PASS (4/4). Stagnation-augmented Qwen2.5-Coder-0.5B: SLM 100% (10/10) vs qwen3:8b 70-80%. 90.3% token reduction. Spearman rho 0.0. 0 catastrophic failures. RFC 002 Monitor module VALIDATED. | 2026-03-30 | log/2026-03-30-exp-slm-r09.yaml |
| R-01b | exp-slm | Gate 4 Part 2 PARTIAL PASS (3/4). Live benchmark: 135M SLM (CPU ONNX) scored 90% vs qwen3:8b baseline 80%. 89% token reduction. Zero escalations (invalidates Spearman rho gate). Stagnation pattern is sole training gap. | 2026-03-30 | log/2026-03-30-exp-slm-gate4-live.yaml |
| R-15 | exp-cognitive-baseline | True threshold ablation (wiring fix applied). t2=2 and t4=4 tie at 6/7 (85.7%). t3=3 drops to 5/7 (71.4%). Baseline (t2) chosen for R-14 for comparability. t4 reduces interventions 33% at same success rate. | 2026-03-30 | log/2026-03-30-exp-cognitive-baseline-r15.yaml |
| R-14 | exp-cognitive-baseline | Full T01-T05 matrix, N=5, baseline config. Flat 80% (20/25) vs cognitive 60% (15/25). T01: cognitive wins 100% vs 60%. T03+T04: cognitive 0% (config-schema errors + constraint blindness). R-03 pattern confirmed at larger N. Threshold tuning does not fix structural gaps. | 2026-03-30 | log/2026-03-30-exp-cognitive-baseline-r14.yaml |
| R-12 | exp-cognitive-baseline | Monitor strategy ablation (threshold hardcoded — wiring defect found). Constrain-force 4/5 (80%). Reframe 0/5, +73% tokens. Budgeted nudge-reframe-reset 0/5. Constrain-force is necessary; true threshold ablation blocked pending wiring fix. | 2026-03-30 | log/2026-03-30-exp-cognitive-baseline-r12.yaml |
| R-02 | exp-cognitive-baseline | N=10 on Task 01: flat 8/10 (80%) vs cognitive 6/10 (60%). Flat advantage confirmed. Cognitive uses 20% fewer tokens but 2x longer. Monitor over-fires on T01. | 2026-03-30 | log/2026-03-30-exp-cognitive-baseline-r02.yaml |
| R-03 | exp-cognitive-baseline | Tasks 02-05, A+C, N=3. Flat 11/12 (92%) vs cognitive 7/12 (58%). Flat wins. Cognitive fails T04 0/3 (constraint blindness). T02+T05 parity. T03 shared failure mode. | 2026-03-30 | log/2026-03-30-exp-cognitive-baseline-r03.yaml |
| R-10 | exp-slm | Spearman gate redesigned: difficulty→failure (rho ≤ 0.3) replaces difficulty→escalation (undefined at 0% escalation). Implemented in run-benchmark-live.ts. | 2026-03-30 | (inline code change) |
| R-04 | exp-metacognitive-error | v2 Monitor 11x better at subtle errors (E3: 37.9% vs 3.4% EDR). FPR tradeoff: v2 mean FPR 20.2% vs v1 0%. Gates: G1 PASS, G2 FAIL (v2 FPR), G3 PASS. | 2026-03-29 | log/2026-03-29-exp-metacognitive-error-full.yaml |
| R-05 | exp-workspace-efficiency | PriorityAttend 27.3% token savings vs unlimited, 91% success rate. Eviction quality 25% better than default salience. Gates: G0 PASS, G1 PASS, G2 PARTIAL PASS. | 2026-03-29 | log/2026-03-29-exp-workspace-efficiency-core.yaml |
| R-06 | exp-interventionist-cost | Always-on free (1.07x cost, 93% success). EVC interventionist 1.42x cost but 67% success — worse than baseline. Gate: PARTIAL (cost met, quality missed). | 2026-03-29 | log/2026-03-29-exp-interventionist-cost-core.yaml |
| R-07 | exp-advanced-patterns | All patterns combined degrades performance to 22% success (vs 75% baseline). Context pollution + workspace saturation. Selective activation needed. | 2026-03-29 | log/2026-03-29-exp-advanced-patterns-core.yaml |
