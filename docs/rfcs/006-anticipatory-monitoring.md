# RFC 006: Anticipatory Monitoring — Phase-Aware Goal Pursuit

**Status:** Draft — theory extension (empirically validated through R-23)
**Author:** PO + Lysica
**Date:** 2026-04-03
**Extends:** RFC 001 (Calculus of Cognitive Composition), RFC 004 (Goal-State Monitoring)
**Applies to:** `@method/pacta` cognitive algebra, Planner module, Evaluator module
**Organization:** Vidtecci

---

## Part I: Anticipatory Monitoring (Validated)

### Motivation

RFC 004 closed the goal-state monitoring gap: the Evaluator now compares workspace state
to a goal representation and can emit TerminateSignals. PRD 045 implemented this in four
waves. The system works correctly — and produces catastrophic results.

**Empirical evidence:**
- **R-20** (rule-based discrepancy): 4/18 (22%). Every run terminated at cycle 10 with
  `goal-unreachable`. The rule-based discrepancy function produced constant output.
- **R-21** (LLM frontier evaluator): 3/18 (17%). Accurate assessments, but high confidence
  made termination *worse* than rule-based.
- **Baseline** (no goal monitoring, R-15): 11/15 (73%). Better with no oversight.

The paradox: *better monitoring signal → worse performance*. RFC 004 gave the Evaluator
a goal comparator but not **expectations about what progress should look like at each
stage of task execution.**

### Theoretical Grounding

> **Epistemological note:** Consistent with RFC 001 — cognitive science as *design
> inspiration*, not biological validation.

#### 1. Pre-Task Assessment: Koriat's Ease-of-Learning Judgment (EOL)

Before engaging with a task, the metacognitive system forms an initial assessment of
difficulty and expected effort. Nelson & Narens (1990) identify this as the **Ease of
Learning (EOL) judgment**. Koriat (2007) elaborates: the EOL judgment **parameterizes**
subsequent monitoring. Without it, the monitoring system has no reference point.

**Gap in RFC 004:** The Evaluator evaluates every task with the same thresholds.

> Koriat, A. (2007). Metacognition and consciousness. Cambridge Handbook of Consciousness.
> Nelson, T. O., & Narens, L. (1990). Metamemory. Psychology of Learning and Motivation, 26.

#### 2. Phase-Aware Progress: Carver-Scheier's Multi-Level Control

The metamonitor tracks progress *relative to the current phase of a hierarchical plan*,
not just absolute discrepancy. Reading files in cycle 3 is expected exploration; reading
files in cycle 12 is alarming stagnation.

**Gap in RFC 004:** Single discrepancy value against top-level goal, no phase concept.

> Carver, C. S., & Scheier, M. F. (1998). On the Self-Regulation of Behavior. Cambridge UP.
> Powers, W. T. (1973). Behavior: The Control of Perception. Aldine.

#### 3. The Warmth Signal: Metcalfe & Wiebe (1987)

A feeling of approaching the solution that's distinct from actual progress. High warmth +
no solution = "keep going." This prevents premature abandonment.

> Metcalfe, J., & Wiebe, D. (1987). Intuition in insight and noninsight problem solving.

#### 4. Solvability Estimation: P(solvable) ≠ P(solved)

An agent reading code with growing understanding has P(solvable) rising even though
P(solved) = 0. Termination should be gated on solvability, not discrepancy rate.

> Simon, H. A. (1956). Rational choice and the structure of the environment.

### Implementation (Validated R-22)

- `TaskAssessment`, `TaskPhase`, `SolvabilityEstimate` types in `algebra/goal-types.ts`
- `assessTaskWithLLM()` in `algebra/llm-task-assessment.ts` — cycle 0 pre-task assessment
- `buildPhaseAwareDiscrepancy()` in `algebra/llm-discrepancy.ts` — phase-aware evaluation
- Evaluator: solvability-gated termination (smoothed 3-cycle avg, threshold 0.3)
- Planner module: `modules/planner.ts` — formal CognitiveModule with 18 tests

---

## Part II: Module Working Memory (Validated)

### The Algebraic Gap

S in every module is bookkeeping counters — no workspace. The actual workspace is
external, shared, and subject to eviction. This breaks algebraic closure.

### Empirical Evidence

- R-18: Partitioned workspace regresses T04 from 100% (flat) to 0%
- R-22c: Memory v3 (episodic recall) recovers T06 but NOT T02/T04
- R-23: Working memory recovers T02 (0→67%) and T04 (0→33%)

Root cause: the ReasonerActor had no memory across cycles. Its "mental model" was
whatever the partition system showed it each cycle.

### The Closed Form

```typescript
interface ModuleWorkingMemory {
  entries: WorkspaceEntry[];
  config: WorkingMemoryConfig;
}
```

Every module may include working memory in its state. The ReasonerActor's scratchpad
persists plan/understanding via `<working_memory>` LLM response section.

**Status:** Implemented for ReasonerActor (R-23, +11pp). Validates the algebra.

> Baddeley, A. D. (2000). The episodic buffer. Trends in Cognitive Sciences, 4(11).

---

## Part III: Unified Memory Architecture (Proposed)

### Motivation

Parts I and II are compensatory mechanisms for a flawed foundation: **the workspace is
a bounded container with destructive eviction.** Memory v3 was bolted on as retrieval.
Working memory was bolted on as persistence. The architecture accumulates layers because
the base is wrong.

### Cowan's Embedded-Processes Model

The most empirically supported model of human working memory (Cowan, 1999, 2001)
reframes the traditional view:

**Baddeley (1974):** Working memory is a separate buffer with fixed capacity (~7±2).
Items are either "in WM" or "in LTM." Transfer is explicit.

**Cowan (1999, 2001):** Working memory IS long-term memory. No separate buffer. Three
concentric levels of activation:

```
Long-term memory (everything ever stored)
  └── Activated memory (recently relevant subset, no fixed limit)
       └── Focus of attention (3-4 items, current processing target)
```

The "capacity limit" is not container size — it's an **attention bottleneck.** You can
activate as many items as are relevant; the limit is on simultaneous attention. Items
leaving the focus don't vanish — they decay in activation and remain retrievable.

> Cowan, N. (1999). An embedded-processes model of working memory. Models of Working Memory.
> Cowan, N. (2001). The magical number 4 in short-term memory. Behavioral and Brain Sciences, 24.
> Oberauer, K. (2002). Access to information in working memory. J Exp Psych: LMC, 28(3).

### Proposed Architecture: Memory IS the Workspace

**Every write is a memory store. Every read is a retrieval query. Nothing is ever
destructively evicted.**

```
Current:  Partition (bounded) → eviction → lost → Memory (tries to recall)
Proposed: Memory Store (unbounded) ← store ← all modules
          Retrieval (dynamic) → per-module context → exactly what's needed
```

#### Algebra

```typescript
/**
 * Unified memory store — replaces partitioned workspace.
 * All entries live here permanently. Activation decays, but entries
 * remain retrievable when spreading activation cues match.
 */
interface CognitiveMemoryStore {
  /** Store an entry tagged with source, role, and activation metadata. */
  store(entry: MemoryEntry): void;

  /**
   * Retrieve entries relevant to a module's current needs.
   * This IS the workspace read operation.
   */
  retrieve(query: RetrievalQuery): MemoryEntry[];
}

/** Entry in the unified store. */
interface MemoryEntry extends WorkspaceEntry {
  /** Partition role — for retrieval filtering, not capacity limits. */
  role: PartitionRole;
  /** ACT-R activation components. */
  activation: {
    baseLevelActivation: number;  // recency × frequency decay
    lastAccessed: number;
    accessCount: number;
  };
}

/** Per-module retrieval query — replaces ContextSelector. */
interface RetrievalQuery {
  /** Requesting module. */
  module: ModuleId;
  /** Role filter (optional). */
  roles?: PartitionRole[];
  /** Token budget for result. */
  budget: number;
  /** Retrieval strategy. */
  strategy: 'activation' | 'recency' | 'salience';
  /** Spreading activation cues — working memory, goal, recent actions. */
  cues: string[];
}
```

#### How It Works

1. **All writes go to the store.** Observer entries tagged `role: 'task'`. ReasonerActor
   tool results tagged `role: 'operational'`. Nothing is deleted.

2. **Each module retrieves its own context.** The Evaluator queries goal-relevant entries.
   The ReasonerActor queries action-relevant entries. Same store, different queries.

3. **Activation decay replaces eviction.** Old entries aren't deleted — activation decays.
   They remain retrievable when spreading activation cues match. File reads from cycle 3
   have low activation by cycle 10, but when the ReasonerActor's working memory contains
   "need to create v2 handler based on v1 structure," the term "v1 handler" reactivates
   the relevant file read. This is why T04 would work.

4. **Module working memory = retrieval cues.** The scratchpad serves dual roles:
   persistent state AND spreading activation source. "My plan is X, I've learned Y"
   → these terms activate relevant entries in the store.

5. **Context size is self-regulating.** Complex tasks activate more entries. Simple tasks
   activate fewer. No manual capacity tuning.

#### What Survives From the Current Architecture

| Current Component | Becomes | Change |
|---|---|---|
| Partition system | Entry router — tags roles | Loses capacity limits, keeps role tagging |
| Partition eviction | Activation decay | Non-destructive, entries remain retrievable |
| Memory v3 (store) | Core of unified store | Promoted from bolt-on to foundation |
| Memory v3 (retrieval) | Workspace read operation | Promoted from supplementary to primary |
| Module working memory | Retrieval cue generator + state | Dual role |
| ContextSelector | RetrievalQuery | Richer: adds cues, removes fixed capacity |

### Experiment Plan

#### R-26: Diagnostic (Activation-Based Context Assembly)

Replace partition `buildContext()` with activation-based retrieval from Memory v3,
using module working memory as spreading activation cues. Test if T04 recovers to ≥67%.

#### R-27: Full Unified Store

Replace `createPartitionSystem` with `CognitiveMemoryStore`. Implement activation decay,
spreading activation, per-module retrieval queries.

### SLM Compilation Target

The retrieval scoring function (relevance of entry E to module M in context C) is a prime
SLM compilation target. Train a small model on frontier retrieval decisions for near-zero-cost
context assembly.

---

## Empirical Validation (R-20 → R-23)

| Run | Intervention | Result | Finding |
|-----|-------------|--------|---------|
| R-20 | Rule-based discrepancy (PRD 045) | 22% | Comparator can't measure progress |
| R-21 | LLM frontier evaluator | 17% | Better signal + bad termination = worse |
| R-22 | Phase-aware eval + solvability | 28% | Fixed premature termination |
| R-22b | Smoothed solvability | 28% | Tuning noise, partition is the bottleneck |
| R-22c | + Memory v3 episodic recall | 33% | T06 recovered. T04 still 0% |
| R-23 | + Per-module working memory | **44%** | T02 recovered (0→67%), T04 first pass (0→33%) |

**Flat baseline (R-15): 73%.** Remaining 29pp gap motivates Part III.

### Validated Claims

1. Phase awareness prevents premature termination (R-22)
2. Solvability is distinct from discrepancy (R-22)
3. Episodic recall enables complex task completion (R-22c)
4. Per-module working memory recovers reasoning-bound tasks (R-23)
5. No single layer suffices (R-20→R-23 progression)

---

## Open Questions

1. **Retrieval quality:** Can ACT-R activation produce good context assembly? Or does
   scoring need an LLM/SLM?
2. **Activation decay parameters:** How fast should entries decay?
3. **Spreading activation cue design:** What makes a good cue?
4. **Composition semantics:** How do composed modules share the unified store?
5. **Cost:** Activation scoring on 100+ entries. O(n) — indexing needed?
6. **Scratchpad role:** If context is self-regulating, does the scratchpad become just cues?

## References

- Baddeley, A. D. (2000). The episodic buffer. *Trends in Cognitive Sciences*, 4(11), 417-423.
- Baddeley, A. D., & Hitch, G. J. (1974). Working memory. *Psychology of Learning and Motivation*, 8.
- Carver, C. S., & Scheier, M. F. (1998). *On the Self-Regulation of Behavior.* Cambridge UP.
- Cowan, N. (1999). An embedded-processes model of working memory. *Models of Working Memory*.
- Cowan, N. (2001). The magical number 4. *Behavioral and Brain Sciences*, 24, 87-185.
- Flavell, J. H. (1979). Metacognition and cognitive monitoring. *American Psychologist*, 34(10).
- Kahneman, D. (2011). *Thinking, Fast and Slow.* Farrar, Straus and Giroux.
- Koriat, A. (2007). Metacognition and consciousness. *Cambridge Handbook of Consciousness*.
- Metcalfe, J., & Wiebe, D. (1987). Intuition in insight and noninsight problem solving. *M&C*, 15(3).
- Nelson, T. O., & Narens, L. (1990). Metamemory. *Psychology of Learning and Motivation*, 26.
- Oberauer, K. (2002). Access to information in working memory. *J Exp Psych: LMC*, 28(3).
- Powers, W. T. (1973). *Behavior: The Control of Perception.* Aldine.
- Simon, H. A. (1956). Rational choice and the structure of the environment. *Psych Review*, 63(2).
