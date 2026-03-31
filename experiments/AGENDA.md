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
**Status:** Phase 0 (pin flag) validated. Phase 1 recommended for research optionality. See `docs/rfcs/003-strategic-evaluation.md`.

### Line 4: ARC-AGI Integration (NEW)
Can our cognitive architecture (modules + SLMs + partitions) improve abstract reasoning on ARC-AGI-3?
**Status:** Planning. SDK identified (`pip install arc-agi`). Architecture maps to ARC-AGI-3 requirements.

---

## Backlog — Planned

| ID | Experiment | Question | Priority | Dependencies |
|----|-----------|----------|----------|-------------|
| — | exp-arc-agi | ARC-AGI-3 baseline: flat vs cognitive vs SLM cognitive | P1 | SDK setup, adapter code |
| — | exp-slm T06 extended | Goal drift on 30-cycle tasks? | P0 | Running now (2026-03-31) |
| — | RFC 003 Phase 1 impl | Partitioned workspace implementation + T01-T06 validation | P1 | T06 results, strategic decision |
| — | Observer v3 training | Train Observer on tool-result inputs for every-cycle mode | P3 | Chobits, corpus design |
| — | GPU ONNX re-export | Re-export ONNX models on 2080 Ti for local GPU inference | P2 | Chobits or re-export script |

## Backlog — In Progress

| ID | Experiment | Question | Status | Claimed By | Updated |
|----|-----------|----------|--------|------------|---------|
| R-16 | exp-slm phase-5 | T06 multi-module-extract at MAX_CYCLES=30 × N=3 — goal drift test | running | session 2026-03-31 | 2026-03-31 |

---

## Completed

| ID | Experiment | Result | Date |
|----|-----------|--------|------|
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
