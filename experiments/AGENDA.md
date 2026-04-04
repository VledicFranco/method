# Research Agenda — pv-method

Prioritized research backlog. See `PROTOCOL.md §5` for the claim protocol.
See `ROADMAP.md` for the strategic research program (RFC 001/002/003 → ARC-AGI).

---

## Active Research Lines

### Line 1: SLM Compilation (RFC 002)
Can small models trained on typed DSLs replace frontier LLM calls in cognitive modules?
**Status:** Gate 5 PASS. 3-module SLM cycle validated. Observer ablation resolved T01 regression.

### Line 2: Cognitive Architecture Validation (RFC 001)
Does the 8-module cognitive cycle with default-interventionist monitoring outperform flat ReAct agents?
**Status:** Parity at 73% (SLM cognitive = flat). Advantage on constraint tasks (T02/T04). Needs longer tasks.

### Line 3: Workspace Partitions (RFC 003)
Does typed workspace partitioning enable complex cognition beyond single-workspace limits?
**Status:** Phase 1 IMPLEMENTED (PRD 044, commit bc2cca0). Goal drift confirmed (R-16). Partitioned workspace fixes T01 (0/3→3/3 at 30 cycles), 30-67% token reduction. T06 still fails (reasoning-bound). T02/T04 regressed at 30 cycles — needs 15-cycle retest and pin flag integration.

### Line 4: ARC-AGI Integration
Can our cognitive architecture (modules + SLMs + partitions) improve abstract reasoning on ARC-AGI-3?
**Status:** Planning. SDK identified (`pip install arc-agi`). Architecture maps to ARC-AGI-3 requirements.

### Line 5: Anticipatory Monitoring + Module Working Memory (RFC 006)
Does pre-task assessment + phase-aware evaluation + per-module working memory close the gap to flat baseline?
**Status:** R-23 validates full stack at 44% (up from 22% at R-20). T02 recovered 0→67%, T04 first pass ever. Per-module working memory is the critical piece — closed algebra empirically validated.
**Key findings:** (1) Better signal + bad termination = worse (R-21). (2) Phase awareness fixes termination (R-22). (3) Episodic recall enables complex tasks (R-22c). (4) Working memory recovers reasoning-bound tasks (R-23). Each layer contributed measurably; no single intervention suffices.

---

## Backlog — Planned

| ID | Experiment | Question | Priority | Dependencies |
|----|-----------|----------|----------|-------------|
| R-24 | exp-slm phase-5 | **Statistical confidence** — R-23 full stack at N=5 for T01-T05. Determine if 44% is stable or noise. | P0 | None |
| R-25 | exp-slm phase-5 | **Partition tuning** — investigate capacity/eviction for T01/T04 remaining gap vs flat. | P1 | R-24 results |
| R-19 | exp-slm phase-5 | T04 with pin flag + partitioned workspace — does combining both fixes work? | P1 | R-18 results |
| — | exp-arc-agi | ARC-AGI-3 baseline: flat vs cognitive vs SLM cognitive | P1 | SDK setup, adapter code |
| — | Observer v3 training | Train Observer on tool-result inputs for every-cycle mode | P3 | Chobits, corpus design |
| — | GPU ONNX re-export | Re-export ONNX models on 2080 Ti for local GPU inference | P2 | Chobits or re-export script |

## Backlog — In Progress

*R-24 (N=5 statistical confidence) is next. R-20→R-23 arc complete.*

---

## Completed

| ID | Experiment | Result | Date |
|----|-----------|--------|------|
| R-23 | exp-slm phase-5 | **Full RFC 006 stack 8/18 (44%).** Phase-aware eval + solvability + Memory v3 + per-module working memory. T02 recovered 0→67% (matches flat). T04 first pass ever (0→33%). Closed algebra validated. | 2026-04-04 |
| R-22c | exp-slm phase-5 | **+ Memory v3: 6/18 (33%).** Episodic recall enables T06 (0→67%). T04 still 0% — proves gap is working memory, not retrieval. | 2026-04-04 |
| R-22b | exp-slm phase-5 | **Smoothed solvability: 5/18 (28%).** Tuning didn't change outcomes — partition context is the bottleneck. | 2026-04-03 |
| R-22 | exp-slm phase-5 | **Phase-aware + solvability: 5/18 (28%).** Fixed premature termination (R-20/R-21), back to partition baseline. Solvability too volatile — needed smoothing. | 2026-04-03 |
| R-21 | exp-slm phase-5 | **LLM frontier evaluator 3/18 (17%).** Accurate assessments but high confidence makes termination worse. Better signal → worse outcome. Proves termination logic is the bottleneck, not evaluator quality. Motivates RFC 006. | 2026-04-03 |
| R-20 | exp-slm phase-5 | **Rule-based goal-state 4/18 (22%).** Universal premature termination at cycle 10. Discrepancy flatlines at 0.300. Rule-based function can't measure progress. | 2026-04-03 |
| R-18 | exp-slm phase-5 | Partitioned 15cyc: 4/15 (27%) vs flat 11/15 (73%). **Regression is NOT from over-cycling — partitions cause T02/T04 failure at both 15 and 30 cycles.** Compositional gap identified: no goal satisfaction detection. | 2026-04-03 |
| R-17 | exp-slm phase-5 | Partitioned workspace (PRD 044): T01 0/3→3/3 at 30 cycles. 30-67% token reduction. T06 still 0/3 (reasoning-bound). T02/T04 regressed at 30 cycles (over-exploration). | 2026-03-31 |
| R-16 | exp-slm phase-5 | **Goal drift confirmed.** T06 0/3 at 30 cycles. Workspace saturated with file contents (3-5K tokens). RFC 003 Trigger 1 FIRED. | 2026-03-31 |
| R-15 | exp-slm phase-5 | Observer ablation: cycle0 fixes T01 (33%→100%). T03 task-inherent (20%). Flat baseline 73%, 28K tokens. Benchmark fix: 9/10 ALL GATES PASS. | 2026-03-31 |
| R-14 | exp-slm phase-5 | **Gate 5 PASS.** 3-module SLM cognitive cycle 73% vs 72% baseline. 0.15% fallback. T02/T04 +28pp. 22% token reduction vs flat. | 2026-03-31 |
| R-13 | exp-cognitive-baseline | Phase 0 pin flag validated. T04: 0%→100%. Overall: 60%→72% (+12pp). No causal regression. | 2026-03-31 |
| R-09 | exp-slm | Gate 4 Part 2 FULL PASS. Stagnation-augmented Monitor SLM 100% (10/10). 90.3% token reduction. | 2026-03-30 |
| R-08 | exp-slm | Multi-module: Observer v2 ALL PASS + ONNX. Evaluator v2 ALL PASS. 3/3 modules gate-passing. | 2026-03-30 |
| R-11 | exp-slm | Gate 4 Part 2 PARTIAL PASS (3/4). Stagnation gap confirmed. | 2026-03-30 |
| R-14b | exp-cognitive-baseline | Full T01-T05 matrix N=5. Flat 80% vs cognitive 60%. T04 constraint blindness (0%). | 2026-03-30 |
| R-15b | exp-cognitive-baseline | Threshold ablation. t2 and t4 tie at 85.7%. t2 chosen for comparability. | 2026-03-30 |
| R-12 | exp-cognitive-baseline | Monitor strategy ablation. Constrain-force necessary. Reframe degrades. | 2026-03-30 |
| R-07 | exp-advanced-patterns | All patterns combined: 22% success. Context pollution. Selective activation needed. | 2026-03-29 |
| R-06 | exp-interventionist-cost | Always-on free. EVC worse than baseline. | 2026-03-29 |
| R-05 | exp-workspace-efficiency | PriorityAttend 27.3% savings, 91% success. | 2026-03-29 |
| R-04 | exp-metacognitive-error | v2 Monitor 11x better at subtle errors. FPR tradeoff. | 2026-03-29 |
| R-01 | exp-slm | Gate 4 Part 1 PASS. Calibration ECE 0.02, ONNX 100% match. 7-point scaling curve. | 2026-03-29 |
| R-00 | exp-slm | Gates 0-3 PASS. DSL 100% parse/semantic. SLM 98.6% semantic. | 2026-03-28 |
