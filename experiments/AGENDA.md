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
| R-01 | exp-slm | Gate 4: temperature calibration + ONNX export + integration benchmark | open | — | 2026-03-29 |
| R-02 | exp-cognitive-baseline | Increase N from 3 to 10 on Task 01 (statistical significance) | open | — | 2026-03-29 |
| R-03 | exp-cognitive-baseline | Run Tasks 02-05 under all 3 conditions (A/B/C) | open | — | 2026-03-29 |
| R-04 | exp-metacognitive-error | Can Monitor detect reasoning errors the Reasoner misses? (EXP-024) | open | — | 2026-03-29 |
| R-05 | exp-workspace-efficiency | Token savings from salience-based eviction vs unlimited context (EXP-025) | open | — | 2026-03-29 |
| R-06 | exp-interventionist-cost | Cost overhead of default-interventionist vs always-on meta-level (EXP-026) | open | — | 2026-03-29 |
| R-07 | exp-advanced-patterns | PRD 032 patterns (reflector-v2, affect, conflict-resolver) impact on task success (EXP-027) | open | — | 2026-03-29 |
| R-08 | exp-slm | Multi-module scaling: compile Observer + Evaluator after Monitor validated | blocked | — | 2026-03-29 |

### Blocked Items

| ID | Blocked By | Unblock Condition |
|----|-----------|-------------------|
| R-08 | R-01 | Gate 4 must pass first — validates integration pattern before scaling |

---

## Completed

| ID | Experiment | Result | Date | Log Entries |
|----|-----------|--------|------|-------------|
| R-00a | exp-slm | Gate 0 (DSL feasibility): PASS — 100% parse, 100% semantic | 2026-03-28 | log/2026-03-28-exp-slm-phase0.yaml |
| R-00b | exp-slm | Gate 3 (SLM compilation): PASS — 100% parse, 98.6% semantic | 2026-03-28 | log/2026-03-28-exp-slm-run3.yaml |
