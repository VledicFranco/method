# Research Roadmap — Cognitive Architecture → AGI Benchmarks

**Last updated:** 2026-03-31
**North star:** Validate that compiled cognitive modules improve abstract reasoning on ARC-AGI-3.

---

## The Thesis (one paragraph)

LLM agents waste frontier compute on routine metacognitive decisions (novelty assessment, anomaly detection, progress evaluation) that can be compiled to small language models. A cognitive architecture with typed workspace partitions, SLM-compiled metacognitive modules, and a frontier LLM reserved for open-ended reasoning should produce agents that are both cheaper and more capable than flat ReAct agents. ARC-AGI-3 (interactive reasoning benchmark) is the external validation target — it tests exactly the capabilities our architecture is designed to produce: exploration, goal acquisition, world modeling, and adaptive strategy.

## The Stack

```
Layer 4: ARC-AGI-3 Benchmark Validation          ← external AGI measurement
Layer 3: Cognitive Cycle (RFC 001)                ← 8-module orchestration
Layer 2: SLM Compilation (RFC 002)                ← local inference for metacognition
Layer 1: Workspace Partitions (RFC 003)           ← typed memory architecture
Layer 0: Formal Theory (F1-FTH, F4-PHI)          ← compositional foundations
```

Each layer builds on the one below. RFC 001 defines the cycle. RFC 002 compiles the modules. RFC 003 gives them typed memory. ARC-AGI validates that the composition produces intelligence.

## Current State (2026-04-03)

### What's Proven

| Claim | Evidence | Status |
|-------|----------|--------|
| SLMs can replace frontier LLM for metacognition | R-14: 3-module SLM cycle matches baseline (73% vs 72%), 0.15% fallback | **Validated** |
| Pin flag prevents constraint eviction | R-13: T04 0%→100% | **Validated** |
| Observer firing frequency matters | R-15: T01 33%→100% with cycle0 mode | **Validated** |
| SLM Evaluator helps constraint tasks | R-14: T02/T04 both 100% with SLM Evaluator | **Validated** |
| 22% frontier token reduction vs flat | R-15: flat 28K avg vs SLM cognitive 22K avg | **Validated** |
| Goal drift on long tasks | R-16: T06 0/3 at 30 cycles. Workspace saturated (3-5K tokens), goal evicted | **Validated** |
| Partitioned workspace preserves goals | R-17: T01 0/3→3/3 at 30 cycles. 30-67% token reduction per module call | **Validated** |
| T06 is reasoning-bound, not workspace-bound | R-17: T06 still 0/3 with partitioned workspace — agent loops despite having correct context | **Validated** |

### What's Open

| Question | Experiment Needed | Priority |
|----------|------------------|----------|
| Does partitioned workspace regress T02-T05 at 15 cycles? | R-18: Partitioned at MAX_CYCLES=15 for T01-T05 | **P0** — isolate regression cause from R-17 |
| Does pin flag + partitions fix T04? | R-19: Combined condition | **P0** — two fixes may be complementary |
| Can our cognitive architecture solve ARC-AGI-3 tasks? | exp-arc-agi baseline | **P1** — the north star experiment |
| GPU inference on mission-control? | ONNX re-export on 2080 Ti architecture | **P2** — latency optimization |
| Observer v3 trained on tool results? | New training on chobits | **P3** — only if every-cycle mode wanted |

## Research Program — Phased Plan

### Phase A: Close the RFC 003 Question — COMPLETE

1. ~~**T06 30-cycle results**~~ — R-16: goal drift confirmed (0/3).
2. ~~**Decision:** Implement RFC 003 Phase 1~~ — **DONE.** PRD 044 implemented (commit bc2cca0).
3. ~~**Validation:** R-17~~ — T01 fixed, T06 reasoning-bound, T02/T04 regressed at 30 cycles.

### Phase A.1: Partition Tuning (current)

1. **R-18:** Run partitioned workspace at MAX_CYCLES=15 for T01-T05 — isolate whether regressions are from partitions or from over-cycling.
2. **R-19:** Combine pin flag + partitioned workspace for T04 — the two mechanisms address different failure modes.
3. **Adaptive MAX_CYCLES policy** — short tasks at 15, long tasks at 30+.

### Phase C: ARC-AGI-3 Integration (~2-3 weeks)

1. **Install SDK:** `pip install arc-agi` in experiment venv
2. **Build adapter:** Map ARC-AGI-3 `env.step(action)` → cognitive cycle input/output
   - Environment observation → Observer input
   - Grid state → Workspace entries
   - Action selection → Reasoner-Actor output
   - Score feedback → Evaluator input
3. **Baseline:** Run flat agent (frontier LLM only) on ARC-AGI-3 training tasks
4. **Cognitive:** Run cognitive cycle (rule-based modules) on same tasks
5. **SLM cognitive:** Run SLM-compiled modules on same tasks
6. **Measure:** Score, efficiency (tokens per task), adaptation speed

### Phase D: SLM Compilation for ARC-AGI (~3-4 weeks)

1. Collect ARC-AGI cognitive traces from Phase C
2. Build DSL codecs for ARC-specific signals (grid patterns, action sequences, novelty in grid transformations)
3. Train SLMs on ARC-specific metacognitive judgments
4. Validate: SLM modules on ARC-AGI match or exceed rule-based

### Phase E: Workspace Partitions for ARC-AGI (~2 weeks, requires Phase B)

1. Add EnvironmentModelPartition (persistent grid world model)
2. Add StrategyPartition (exploration vs exploitation strategies)
3. Per-module selectors tuned for ARC-AGI task structure
4. Measure: does partitioned workspace improve score on long-horizon ARC tasks?

## Key Files for Context

| File | Purpose | When to Read |
|------|---------|-------------|
| `experiments/ROADMAP.md` | This document — research program overview | **Start of any research session** |
| `experiments/AGENDA.md` | Active backlog with claim protocol | Before starting experiment work |
| `experiments/PROTOCOL.md` | How to run experiments, log results | Before running any experiment |
| `docs/rfcs/001-cognitive-composition.md` | Module algebra formal theory | When modifying cognitive cycle |
| `docs/rfcs/002-small-language-models.md` | SLM compilation thesis | When training or evaluating SLMs |
| `docs/rfcs/003-cortical-workspace-composition.md` | Partition architecture | When modifying workspace |
| `docs/rfcs/003-strategic-evaluation.md` | Why RFC 003 matters for AGI | When making RFC 003 decisions |
| `docs/rfcs/003-decision-brief.md` | Empirical triggers for RFC 003 | When evaluating evidence |
| `experiments/exp-slm/phase-5-cycle/FINDINGS.md` | Phase 5 results | For SLM cycle baseline numbers |
| `experiments/exp-slm/DESIGN-SLM-COGNITIVE-CYCLE.md` | Phase 5 architecture | When modifying the SLM cycle |

## Principles for This Research Program

1. **Measure on ARC-AGI, not just coding tasks.** T01-T06 are useful for development but don't test AGI capabilities. ARC-AGI-3 is the external validation.
2. **Build composable infrastructure, not one-off experiments.** RFC 003 partitions, SLM compilation, and the cognitive cycle should compose — each improvement should compound with the others.
3. **SLMs for speed, LLMs for reasoning.** The metacognitive modules (Observer, Monitor, Evaluator) should be SLM-compiled. The Reasoner stays frontier. This is the RFC 002 thesis applied to ARC-AGI.
4. **Workspace architecture determines cognitive capability.** Single-workspace limits single-concern cognition. Partitioned workspace enables multi-goal, long-horizon, cross-task reasoning. This is the RFC 003 thesis.
5. **Ship the experiments, not the theory.** Every architectural claim must be validated empirically. If ARC-AGI scores don't improve, the architecture isn't working.
