# RFC 003 Decision Brief — Should We Implement Partitioned Workspaces?

**Date:** 2026-03-31
**Evidence:** R-13 (pin flag), R-14 (SLM cycle), R-15 (ablation + flat baseline)
**Status:** Decision pending — this document frames what we know and what we'd need to decide

---

## What RFC 003 Proposes

Split the monolithic workspace into typed partitions (Constraint, Operational, Task) with:
- Independent eviction policies per partition
- Per-module context selectors (each module sees only what it needs)
- Per-partition deterministic monitors
- Entry routing (Observer classifies new entries into the correct partition)

## What We've Proven So Far

### Phase 0 (pin flag) — SOLVED the motivating problem

RFC 003 was motivated by **constraint blindness**: T04 scored 0% because constraints were evicted by higher-salience tool results. The pin flag (PRD 043) fixed this:

- T04: 0% → 100% (R-13, N=5)
- No regression on T01/T03/T05
- The constraint-classifier already routes constraint-bearing entries to `pinned: true`

The pin flag is a degenerate partition: constraints have `NoEviction`, everything else has `SalienceEviction`. It's a 2-partition system implemented as a boolean flag on the existing workspace.

### Phase 5 (SLM cycle) — revealed workspace pollution, solved without partitions

The Observer-every-cycle ablation proved workspace pollution is real:
- T01: 33% → 100% by switching Observer from every-cycle to cycle0

But the fix was **cycle-gating** (don't write noisy entries), not **partitioning** (write them but keep them separate). The pollution problem was solved at the source.

### What problems remain UNSOLVED?

| Problem | RFC 003 Claims to Fix | Current Evidence |
|---------|----------------------|-----------------|
| Constraint eviction | Phase 0 pin flag | **SOLVED** — T04 100% |
| Workspace pollution from Observer | Part II context selectors | **SOLVED** — cycle-gating |
| Token waste from monolithic context | Part II per-module budgets | **UNMEASURED** — 22% reduction already from cognitive cycle structure |
| Goal drift in long tasks | Part I TaskPartition | **UNOBSERVED** — T01-T05 are max 15 cycles, too short to exhibit goal drift |
| T03 config migration failure | Not addressed by RFC 003 | **TASK-INHERENT** — LLM reasoning limitation |

## The Honest Assessment

RFC 003's Parts I-V are well-designed but the empirical evidence doesn't demand them:

1. **The motivating problem (constraint blindness) is solved** by a boolean flag
2. **The new problem (workspace pollution) is solved** by cycle-gating
3. **The remaining problem (T03)** is not workspace-related at all
4. **Token waste** is real but unmeasured at the per-module level, and the 22% reduction from the cognitive cycle may already capture most of the value

RFC 003 is a solution in search of an unsolved problem. The problems it was designed for have been resolved by simpler interventions.

## What Would Change the Decision

RFC 003 Phase 1 becomes justified if ANY of these are observed:

### Trigger 1: Goal drift on long tasks
Run experiments with >30 cycle tasks (e.g., multi-file refactoring across 10+ files). If the agent loses its strategy/goal context due to tool result churn at cycle 20+, the TaskPartition with `GoalSalience` eviction is justified.

**How to test:** Create T06-T08 with higher complexity requiring 20-40 cycles. If pass rate drops significantly compared to 15-cycle performance, and workspace inspection shows strategy entries evicted, that's evidence.

### Trigger 2: Cross-concern interference at scale
Run experiments where constraints and tool results actively interfere (constraint text is long enough to compete for workspace slots even with pinning). Current T04 constraints are short (1-2 sentences). If real-world constraints are multi-paragraph, the pin flag + capacity limit interaction could reproduce constraint blindness.

**How to test:** Create T09 with 5+ paragraph constraints (>500 tokens). Check if workspace capacity (8 slots) becomes the bottleneck, forcing constraint eviction despite pinning (the `maxPinnedEntries` cap from PRD 043 C-1).

### Trigger 3: Per-module token profiling shows significant waste
Profile how many tokens each module receives vs how many are relevant. If the Monitor is receiving 8K tokens but only needs 2K (constraints + recent signals), the 6K waste justifies context selectors.

**How to test:** Instrument the existing cognitive cycle to log per-module context size and relevance. No code changes to modules needed — just logging in the cycle orchestrator.

### Trigger 4: SLM compilation wants tighter input distributions
RFC 003 Part VI notes that focused contexts are easier SLM compilation targets. If Observer v3 or Monitor v2 training fails because input distributions are too wide (too much irrelevant context in training examples), partition-based context selection would narrow the distribution.

**How to test:** This emerges naturally during SLM training. If a module's SLM fails to converge or has high error rates on inputs with lots of irrelevant context, that's evidence.

## Recommendation

**Do not implement RFC 003 Phase 1 now.** The evidence doesn't justify the complexity. Instead:

1. **Update RFC 003 status** from "Draft" to "Deferred — Phase 0 validated, Phase 1 awaiting trigger"
2. **Run Trigger 3** (per-module token profiling) — it's cheap (~1 day of instrumentation) and would give the most actionable data
3. **Design T06-T08** for Trigger 1 — longer tasks that actually stress workspace retention
4. **Revisit after next SLM training round** for Trigger 4 evidence

The cheapest path to a decision is: **instrument per-module context waste + design longer tasks**. Both can be done in one session without touching workspace architecture.
