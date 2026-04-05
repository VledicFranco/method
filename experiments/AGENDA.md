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
**Status:** Parity at 73% (SLM cognitive = flat, monolithic workspace). Partitioned workspace + full cognitive stack at 44% (R-23). Gap closing: T02 recovered to parity, T04 first pass. Next: partition tuning (R-25) to close remaining 29pp.

### Line 3: Workspace Partitions (RFC 003)
Does typed workspace partitioning enable complex cognition beyond single-workspace limits?
**Status:** Phase 1 IMPLEMENTED (PRD 044, commit bc2cca0). Goal drift confirmed (R-16). Partitioned workspace fixes T01 (0/3→3/3 at 30 cycles), 30-67% token reduction. T06 still fails (reasoning-bound). T02/T04 regressed at 30 cycles — needs 15-cycle retest and pin flag integration.

### Line 4: ARC-AGI Integration
Can our cognitive architecture (modules + SLMs + partitions) improve abstract reasoning on ARC-AGI-3?
**Status:** Planning. SDK identified (`pip install arc-agi`). Architecture maps to ARC-AGI-3 requirements.

### Line 5: Anticipatory Monitoring + Unified Memory (RFC 006)
Does the full cognitive stack (Planner + unified memory + working memory + phase-aware evaluation) match or exceed flat baseline?
**Status:** R-26 series validated. Best demonstrated rates: T01 100%, T02 100%, T03 67%, T04 67%, T05 100% — all match or exceed flat on T01-T03/T05. Architecture bottleneck resolved; remaining gap is LLM code generation quality (Sonnet 4). T06 needs verification loop.
**Key findings:** (1) Unified memory (Cowan model) eliminates destructive eviction — T02 100% exceeds flat 67%. (2) Planner subgoal checklist seeding fixes T04 read-loop. (3) Spreading activation from working memory cues drives context assembly. (4) Architecture validated: 4/5 tasks at or above flat baseline.

---

## Backlog — Planned

| ID | Experiment | Question | Priority | Dependencies |
|----|-----------|----------|----------|-------------|
| R-24 | exp-slm phase-5 | **Statistical confidence** — R-23 full stack at N=5 for T01-T05. Determine if 44% is stable or noise. | **P0** | None |
| R-25 | exp-slm phase-5 | **Partition tuning** — investigate capacity/eviction for T01/T04 remaining gap vs flat (29pp). | P0 | R-24 results |
| — | Planner module | **Formal Planner implementation** (RFC 006 §Planner Module) — typed algebra surfaces, composable with Evaluator. Replace prompt-level assessTaskWithLLM with proper CognitiveModule. | P1 | R-24/R-25 close the gap |
| — | SLM compilation | **Evaluator + assessment SLM targets** — distill phase-aware evaluator and task assessor from frontier traces. Eliminates ~11K tokens/run overhead. RFC 002 pipeline. | P1 | Planner module stable |
| — | Closed algebra | **Per-module working memory for all modules** — extend Monitor, Evaluator, Observer with ModuleWorkingMemory. Complete the algebraic closure from RFC 006. | P2 | R-25 validates architecture |
| — | exp-arc-agi | ARC-AGI-3 baseline: flat vs cognitive vs SLM cognitive | P1 | SDK setup, adapter code |
| — | Structured output | **P(parse) = 1.0 hypothesis** — re-run exp-spl-design recursive condition with StructuredAgentProvider. Validate that structured JSON output eliminates parser bottleneck in implement/design algorithms. PRD 046 C-3 enables this. | P1 | StructuredAgentProvider (merged) |
| — | Observer v3 training | Train Observer on tool-result inputs for every-cycle mode | P3 | Chobits, corpus design |
| — | GPU ONNX re-export | Re-export ONNX models on 2080 Ti for local GPU inference | P2 | Chobits or re-export script |

## Backlog — In Progress

*R-24 (N=5 statistical confidence) is next. R-20→R-23 arc complete.*

---

## Completed

| ID | Experiment | Result | Date |
|----|-----------|--------|------|
| R-26e | exp-slm phase-5 | **Unified memory (Cowan) + Planner + WM: best T01 100%, T02 100%, T03 67%, T04 67%.** Architecture validated — 4/5 tasks match or exceed flat. Remaining gap: LLM write quality. | 2026-04-04 |
| R-26d | exp-slm phase-5 | **T04 67% — best ever.** Subgoal checklist seeding fixes read-loop. KPI regex bug prevented T06 fix. | 2026-04-04 |
| R-26c | exp-slm phase-5 | **T03 67% — exceeds flat 33%.** Formal Planner module wired. Subgoals in unified store. | 2026-04-04 |
| R-26b | exp-slm phase-5 | **T01 100% — exceeds flat 67%.** Dynamic budget + KPI satisfaction gating + tuned spreading. | 2026-04-04 |
| R-26 | exp-slm phase-5 | **Unified memory 50%. T02 100% — exceeds flat 67%.** CognitiveMemoryStore validates Cowan model. | 2026-04-04 |
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
