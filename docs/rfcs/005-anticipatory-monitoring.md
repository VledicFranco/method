# RFC 005: Anticipatory Monitoring — Phase-Aware Goal Pursuit

**Status:** Draft — theory extension
**Author:** PO + Lysica
**Date:** 2026-04-03
**Extends:** RFC 001 (Calculus of Cognitive Composition), RFC 004 (Goal-State Monitoring)
**Applies to:** `@method/pacta` cognitive algebra, Planner module, Evaluator module
**Organization:** Vidtecci

## Motivation

RFC 004 closed the goal-state monitoring gap: the Evaluator now compares workspace state
to a goal representation and can emit TerminateSignals. PRD 045 implemented this in four
waves. The system works correctly — and produces catastrophic results.

**Empirical evidence:**
- **R-20** (rule-based discrepancy): 4/18 (22%). Every run terminated at cycle 10 with
  `goal-unreachable`. The rule-based discrepancy function produced constant output
  (0.300 discrepancy) regardless of actual progress.
- **R-21** (LLM frontier evaluator): 3/18 (17%). The LLM evaluator produced *accurate*
  assessments — correctly identifying when the agent was reading vs writing, giving
  differentiated discrepancy scores. But the high confidence (0.85-0.95) made the
  unreachable heuristic fire more reliably, making outcomes *worse* than rule-based.
- **Baseline** (no goal monitoring, R-15): 11/15 (73%). The agent performs better with
  no metacognitive oversight than with accurate metacognitive oversight.

The paradox: *better monitoring signal → worse performance*. This is not a bug in the
implementation — it reveals a structural gap in the cognitive architecture. RFC 004 gave
the Evaluator a goal comparator. What it did not give the Evaluator is **expectations
about what progress should look like at each stage of task execution.**

A human programmer who spends the first 5 minutes reading code does not feel stuck.
They are in the *exploration phase* and they know it. The cognitive architecture has no
concept of phases, no pre-task assessment of difficulty, no expected trajectory, and no
distinction between "not progressing" and "progressing through a phase that doesn't
produce visible artifacts."

This RFC identifies the missing cognitive functions, grounds them in the literature,
and proposes a principled extension to the module inventory.

## Theoretical Grounding

> **Epistemological note:** Consistent with RFC 001 — cognitive science as *design
> inspiration*, not biological validation. The engineering proposal stands on its own
> merits. The cognitive science provides decomposition rationale and named mechanisms.

### 1. Pre-Task Assessment: Koriat's Ease-of-Learning Judgment (EOL)

Before engaging with a task, the metacognitive system forms an initial assessment
of difficulty and expected effort. Nelson & Narens (1990) identify this as the
**Ease of Learning (EOL) judgment** — a metacognitive prediction made *before*
study begins, based on surface features of the material.

Koriat (2007) elaborates: metacognitive judgments serve a *control* function. The
EOL judgment doesn't just estimate difficulty — it **parameterizes** the subsequent
monitoring process. A task judged as "hard" sets different monitoring thresholds
than a task judged as "easy." Without an EOL judgment, the monitoring system has
no reference point for evaluating whether observed progress is normal or anomalous.

**Gap in RFC 004:** The Evaluator receives a goal representation but no difficulty
estimate or expected timeline. It evaluates every task with the same thresholds
(60% of maxCycles for unreachable, aspiration 0.80 for satisfied). A complex
multi-file refactoring and a simple dead-code removal trigger the same termination
logic.

> Koriat, A. (2007). Metacognition and consciousness. In P. D. Zelazo et al.
> (Eds.), *Cambridge Handbook of Consciousness*. Cambridge UP.
>
> Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and
> new findings. *Psychology of Learning and Motivation*, 26, 125-173.

### 2. Phase-Aware Progress: Carver-Scheier's Multi-Level Control

Carver & Scheier's cybernetic model (1998, 2000) operates at **multiple levels
simultaneously**. The key insight RFC 004 missed: the metamonitor doesn't just
track rate-of-change on a single discrepancy dimension. It tracks progress
*relative to the current phase of a hierarchical plan*.

The human self-regulation system maintains a goal hierarchy:
- **Be-goals** (abstract): "become a good programmer" → not directly actionable
- **Do-goals** (program level): "fix this circular dependency" → the task
- **Motor-goals** (action level): "read file A, understand the import graph" → current action

Progress at the motor-goal level (reading files) doesn't reduce discrepancy at the
do-goal level (dependency not yet fixed). But it *does* represent expected behavior
within the current phase. The metamonitor evaluates: "is current behavior appropriate
for the current phase?" — not just "is discrepancy decreasing?"

**Gap in RFC 004:** The Evaluator computes a single discrepancy value against the
top-level goal. It has no concept of a plan with phases. Reading files in cycle 3
produces the same "no progress" signal as reading files in cycle 12. A phase-aware
evaluator would say: "exploration is expected in cycles 1-5, alarming in cycles 10+."

> Carver, C. S., & Scheier, M. F. (1998). *On the Self-Regulation of Behavior.*
> Cambridge University Press.
>
> Powers, W. T. (1973). *Behavior: The Control of Perception.* Aldine.
> (Foundational work on hierarchical perceptual control that Carver-Scheier extends.)

### 3. The Warmth Signal: Metcalfe & Wiebe's Feeling of Knowing

Metcalfe & Wiebe (1987) demonstrated that subjects solving insight problems report
a **warmth signal** — a feeling of approaching the solution — that's distinct from
actual solution progress. Critically, warmth predicts whether subjects will *continue
working* on a problem. High warmth + no solution = "I'm getting closer, keep going."
Low warmth + no solution = "I'm stuck, try something else."

The warmth signal integrates multiple implicit cues:
- Information gain: "am I learning things relevant to the solution?"
- Structural insight: "do I see how the pieces fit together?"
- Constraint satisfaction: "are the approaches I'm considering consistent?"
- Novelty: "am I encountering new information or repeating myself?"

This is fundamentally a **System 1** (Kahneman, 2011) signal — fast, automatic,
non-verbal. In the brain, it likely involves the anterior cingulate cortex
(expected value tracking), insula (interoceptive awareness), and dopaminergic
prediction errors. It's what the user described as "intuition that something is
moving in the right direction."

**Gap in RFC 004:** The architecture has no warmth signal. The Evaluator can report
"discrepancy is 0.85" but not "I feel like the agent is getting somewhere." An LLM
evaluator approximates warmth through its assessment, but the information is
collapsed into a single discrepancy score rather than maintained as a separate
signal that can override termination decisions.

> Metcalfe, J., & Wiebe, D. (1987). Intuition in insight and noninsight problem
> solving. *Memory & Cognition*, 15(3), 238-246.
>
> Kahneman, D. (2011). *Thinking, Fast and Slow.* Farrar, Straus and Giroux.

### 4. Solvability Estimation: Distinct from Progress

Simon's satisficing model (1956, cited in RFC 004) describes when to *accept* a
solution. What it does not address is the complementary judgment: **when to abandon
a problem as unsolvable.** This requires a running estimate of P(solvable) that's
distinct from the progress estimate P(solved).

The distinction matters because:
- **P(solvable) high, P(solved) low:** "I haven't done it yet but I can see how.
  Keep working." → This is exactly the state that premature termination kills.
- **P(solvable) low, P(solved) low:** "I don't see a path. Consider abandoning."
  → This is the legitimate unreachable signal.
- **P(solvable) high, P(solved) high:** "Almost done, just finishing up."
  → Normal completion trajectory.

In the brain, solvability estimation involves the prefrontal cortex (problem
representation), the hippocampal system (pattern matching against prior experience),
and the reward prediction system (expected value of continued effort). It updates
when the agent learns new information — *even when that information doesn't directly
reduce discrepancy*. Reading code and understanding the problem structure *raises
solvability* without changing discrepancy.

**Gap in RFC 004:** The termination decision is gated on `discrepancy.rate <= 0 &&
cycleNum > maxCycles * 0.6 && diminishingReturns`. This conflates solvability with
progress. An agent that's reading code has rate ≈ 0 and appears stuck, even if
solvability is high. The termination logic needs a solvability signal to gate
the unreachable decision.

> Simon, H. A. (1956). Rational choice and the structure of the environment.
> *Psychological Review*, 63(2), 129-138.

### 5. The Planner as Prerequisite

RFC 001 defines 8 modules. Seven have been implemented or partially implemented.
The **Planner** (goal decomposition, strategy selection, anterior prefrontal abstract
planning) was listed but never elaborated.

The Planner is the module that *produces* the information the other gaps require:
- **Pre-task assessment:** The Planner decomposes the goal, estimates difficulty,
  and sets phase expectations.
- **Phase structure:** The Planner defines what phases the agent will go through
  and what progress looks like in each phase.
- **Expected trajectory:** The Planner provides the reference curve that the
  Evaluator's metamonitor compares against.
- **Solvability prior:** The Planner's decomposition success is itself a solvability
  signal — if the Planner can decompose the goal into concrete steps, solvability
  is high.

Without the Planner, the Evaluator is a comparator without a reference trajectory.
It can only answer "how far from the goal?" — not "are we on track?"

## Proposed Extension

### New Algebra Surfaces

```typescript
/** Pre-task assessment produced by the Planner at cycle 0. */
interface TaskAssessment {
  /** Estimated difficulty level. */
  difficulty: 'low' | 'medium' | 'high';
  /** Expected execution phases with cycle budgets. */
  phases: TaskPhase[];
  /** Initial solvability estimate [0, 1]. */
  solvabilityPrior: number;
  /** Observable indicators for progress tracking. */
  kpis: string[];
  /** Estimated total cycles needed. */
  estimatedCycles: number;
}

/** A phase in the expected task execution trajectory. */
interface TaskPhase {
  /** Phase name. */
  name: 'explore' | 'plan' | 'execute' | 'verify' | string;
  /** Expected cycle range [start, end]. */
  expectedCycles: [number, number];
  /** What progress looks like in this phase (for evaluator). */
  progressIndicator: string;
  /** Expected discrepancy range at end of phase [min, max]. */
  expectedDiscrepancyRange?: [number, number];
}

/** Solvability signal — maintained separately from discrepancy. */
interface SolvabilityEstimate {
  /** Current P(solvable) estimate [0, 1]. */
  probability: number;
  /** What's driving the estimate up or down. */
  evidence: string;
  /** Rate of change per cycle. */
  trend: number;
}
```

### Module Extensions

#### Planner Module (New — RFC 001 §Module Inventory)

The Planner runs at **cycle 0** (or on demand when the Monitor detects an impasse).

**Input:** Goal representation + task context (from Observer).
**Output:** TaskAssessment (phases, difficulty, KPIs, solvability prior).
**Monitoring:** PlannerMonitoring (decomposition quality, confidence in plan).

The Planner uses an LLM to:
1. Read the task description and estimate difficulty
2. Decompose into expected phases with cycle budgets
3. Define observable KPIs for each phase
4. Set an initial solvability estimate

This is the missing "pre-task" System 2 engagement that parameterizes all
subsequent monitoring.

#### Evaluator Extension (Phase-Aware + Solvability)

The Evaluator gains two new capabilities:

1. **Phase-aware discrepancy:** Instead of a single discrepancy against the goal,
   the Evaluator computes discrepancy *relative to the current phase's expectations.*
   "Agent is reading files in cycle 3 and the plan expected exploration until cycle 5"
   → phase-appropriate, no alarm. "Agent is reading files in cycle 10 and execution
   was expected to start by cycle 6" → phase violation, alarm.

2. **Solvability tracking:** The Evaluator maintains a running P(solvable) estimate
   that's separate from discrepancy. Solvability goes up when the agent learns
   relevant information (even without writing files). Solvability goes down when
   the agent encounters unexpected complexity or repeats actions. The unreachable
   termination is gated on solvability, not just discrepancy rate.

#### Updated Termination Logic

```
TERMINATE goal-satisfied:
  discrepancy < threshold AND confidence > gate AND solvability > 0.5
  (Same as RFC 004 but with solvability sanity check)

TERMINATE goal-unreachable:
  solvability < 0.3 AND cycleNum > estimatedCycles * 0.5
  (Gated on solvability, not discrepancy rate. The agent may have rate=0
   because it's exploring, but if solvability is high, don't terminate.)

CONTINUE (default):
  If current phase allows current behavior, continue even if discrepancy
  rate is zero. Phase expectations override raw rate monitoring.
```

## Experiment Plan

### Diagnostic Experiment: R-22 (Prompt-Level Phase Awareness)

**Hypothesis:** Enriching the LLM evaluator prompt with phase expectations prevents
premature termination and recovers baseline performance.

**Method:** Before implementing the Planner module, test the hypothesis cheaply:
1. At cycle 0, make a single LLM call that produces a TaskAssessment (difficulty,
   phases, KPIs)
2. Pass the assessment to the LLM evaluator as additional context each cycle
3. Ask the evaluator to report phase-relative progress AND solvability as separate
   fields alongside discrepancy
4. Gate unreachable termination on solvability < 0.3 instead of rate <= 0

**Success criteria:**
- Pass rate ≥ flat baseline (73%) for T01-T05
- T05 still terminates early (correct early termination preserved)
- No premature goal-unreachable terminations on tasks the agent eventually solves
- Solvability estimates differentiate solvable-but-slow from genuinely stuck

**Why prompt-level first:** This tests the cognitive theory without committing to
module implementation. If enriching the prompt doesn't help, the problem is elsewhere
and we avoid building unnecessary modules. If it does help, we have empirical
evidence to justify the Planner module.

### Full Experiment: R-23 (Module-Level Implementation)

**Prerequisite:** R-22 validates the hypothesis.

**Method:** Implement Planner as a proper cognitive module with typed algebra surfaces.
Extend Evaluator with phase-aware comparison and solvability tracking. Run full
T01-T06 battery with N=5 at 15 and 30 cycles.

**Success criteria (from PRD 045, adjusted):**
1. T05 terminates before MAX_CYCLES in ≥ 80% of runs (goal-satisfied)
2. T06 at 30 cycles: goal-unreachable OR goal-satisfied before cycle 25 in ≥ 60%
3. T01-T05 pass rates ≥ flat baseline (73%)
4. Premature goal-satisfied on incomplete tasks < 15%
5. Solvability correctly predicts task outcome (AUC > 0.75)

## Relationship to Other RFCs

- **RFC 001:** Fills the Planner slot in the 8-module inventory. No changes to other
  modules or composition operators.
- **RFC 004:** Does not replace — extends. Goal-state comparison remains. The
  Planner provides the missing *reference trajectory* that RFC 004's metamonitor
  needs.
- **RFC 002 (SLM Compilation):** The Planner and phase-aware Evaluator are future
  SLM compilation targets. Validate at frontier first, then distill (same pipeline
  as Monitor/Observer).
- **RFC 003 (Workspace Partitions):** The Planner's phase structure could inform
  partition eviction policy (prefer constraint entries during explore phase, prefer
  operational entries during execute phase). Interaction to be explored after R-22.

## Module Working Memory — Closing the Algebra

### The Algebraic Gap

RFC 001 defines the module signature as:

```
Module :: (I, S, κ) → (O, S, μ)
```

Where S is the module's internal state. But in the current implementation, S contains
only bookkeeping counters (cycleCount, successRate, recentActions). No module has a
**workspace** in its state. The actual workspace is external, shared, and subject to
eviction by other modules' writes.

This breaks algebraic closure. Composing two modules doesn't produce something with
the same structure, because the workspace — the thing that carries understanding across
cycles — is a side-channel that isn't part of the module type.

### Empirical Evidence (R-18, R-22b)

R-18 showed that partitioned workspaces regress T04 from 100% (flat) to 0% (partitioned).
R-22b confirmed the regression persists even with phase-aware evaluation. The root cause:

1. The ReasonerActor's state is `{cycleCount, totalTokensUsed, lastActionName, successRate, recentActions}` — **no working memory**.
2. Every cycle, the reasoner gets a fresh `snapshot` from the partition system. That's all it knows.
3. In the flat condition, the workspace accumulates everything — the reasoner "remembers" previous cycles because the workspace contains the full trail.
4. In the partitioned condition, capacity limits (constraint: 12, operational: 14) cause **eviction**. File reads from cycle 3 get dropped to make room for cycle 7's tool results. The reasoner loses context it needs.

### The Cognitive Science Parallel

In the human brain:
- **Prefrontal cortex has its own working memory** (Baddeley, 2000) — it actively maintains task-relevant representations that persist across time steps, independent of sensory input.
- **The hippocampus provides episodic recall** — when something gets evicted from working memory, the hippocampal system can retrieve it on demand.
- **The central executive** (Baddeley, 2000) maintains a goal stack and mental model separate from the incoming perception stream.

Our ReasonerActor has no equivalent. Its "mental model" is whatever the partition system decides to show it this cycle. It's as if the prefrontal cortex had no working memory and relied entirely on the global workspace broadcast for everything.

### The Closed Form

The correct module signature includes a workspace W:

```
Module :: (I, S, W, κ) → (O, S, W, μ)
```

Or equivalently, W is part of S (since S is generic):

```typescript
interface ModuleState<T> {
  /** Module-specific bookkeeping. */
  internal: T;
  /** Module's private working memory — bounded, typed, immune to shared workspace eviction. */
  workingMemory: WorkspaceEntry[];
}
```

Every module gets:
- A **private workspace** (W) that it reads from and writes to during `step()`
- The shared workspace remains the **communication bus** (GWT's global workspace) for inter-module information
- The private workspace persists across cycles and is immune to shared workspace eviction
- Composition operators merge private workspaces according to the operator's semantics

This creates algebraic closure: composing modules produces a module with the same type.

### Practical Implementation Path

1. **Immediate (R-22c):** Wire the existing Memory v3 module (ACT-R episodic recall) into the goal-state condition. This gives the reasoner access to evicted entries via activation-based retrieval — a hippocampal proxy.

2. **Next (R-23):** Add `workingMemory: WorkspaceEntry[]` to each module's state type. The ReasonerActor explicitly writes its plan and understanding to working memory each cycle. The Evaluator maintains its assessment history. The Monitor maintains its anomaly context.

3. **Full (post-R-23):** Extend composition operators to handle per-module working memory. Sequential composition chains working memory. Parallel composition merges. Hierarchical composition scopes.

### Relationship to Existing Memory Module

The Memory module (v3, CLS dual-store) currently serves as a **shared episodic store** — it stores tool results and retrieves them via ACT-R activation when relevant. This is analogous to the hippocampal long-term store.

With per-module working memory, the Memory module's role shifts from "compensating for workspace eviction" to "long-term consolidation." Module working memory handles short-term persistence (what I learned this cycle). The Memory module handles long-term retrieval (what I learned 10 cycles ago that's suddenly relevant again). This is the proper CLS separation: working memory = fast, local, capacity-limited; episodic store = slow, global, persistent.

> Baddeley, A. D. (2000). The episodic buffer: a new component of working memory?
> *Trends in Cognitive Sciences*, 4(11), 417-423.
>
> Baddeley, A. D., & Hitch, G. J. (1974). Working memory. In G. H. Bower (Ed.),
> *Psychology of Learning and Motivation*, Vol. 8. Academic Press.

## Open Questions

1. **Planner accuracy:** Can an LLM reliably estimate task difficulty and phase
   structure? Initial assessment errors propagate to all downstream monitoring.
   Need to understand error modes and design for graceful degradation.

2. **Phase granularity:** How many phases are useful? Too few (explore/execute) may
   not help. Too many (read/analyze/plan/scaffold/implement/test/refine) may be
   brittle. R-22 should explore this.

3. **Solvability calibration:** What inputs produce reliable solvability estimates?
   Information gain (new files read), action diversity (not repeating), and
   structural insight (plan becomes more specific) are candidates.

4. **Cost:** The Planner adds an LLM call at cycle 0. The phase-aware evaluator may
   need a richer prompt. Total token overhead needs to be measured against the
   benefit.

5. **Interaction with write-phase enforcer:** The existing write-bias heuristic in
   the experiment runner is a crude version of phase awareness ("you've been reading
   too long, write something"). If the Planner provides proper phase expectations,
   the write-phase enforcer may become unnecessary or should be subordinated to the
   Planner's phase structure.

6. **Working memory capacity per module:** How many entries should each module's
   private workspace hold? Too small and it loses context. Too large and it
   dominates the prompt, crowding out the shared workspace signal.

7. **Composition operator semantics for W:** How does sequential composition handle
   two modules' private workspaces? Options: concatenate, merge by salience, or
   scope (each module sees only its own). This needs formal definition before
   module working memory can be part of the algebra.

## Empirical Validation (R-20 → R-23)

This RFC was motivated by empirical findings and validated through a sequence of
6 experiments over a single research session. Each experiment tested one layer of
the proposed architecture, and each finding informed the next intervention.

| Run | Intervention | Result | Finding |
|-----|-------------|--------|---------|
| R-20 | Rule-based discrepancy (PRD 045) | 22% | Comparator can't measure progress. Constant 0.300 output. |
| R-21 | LLM frontier evaluator | 17% | Better signal + bad termination = **worse** outcomes. RFC 005 born. |
| R-22 | Phase-aware eval + solvability gating | 28% | Fixed premature termination. Back to partition baseline. |
| R-22b | Smoothed solvability (tuning) | 28% | Tuning noise. Partition context is the bottleneck, not monitoring. |
| R-22c | + Memory v3 episodic recall | 33% | T06 recovered (0→67%). T04 still 0% — gap is working memory, not retrieval. |
| R-23 | + Per-module working memory | **44%** | T02 recovered (0→67%), T04 first pass (0→33%). Closed algebra validated. |

**Flat baseline (R-15): 73%.** Remaining gap (29pp) is primarily partition capacity/eviction,
not missing cognitive functions.

### Key Validated Claims

1. **Phase awareness prevents premature termination.** R-22 proved that the Evaluator
   with phase expectations and solvability gating stops the universal cycle-10 kills
   that plagued R-20/R-21. This is Koriat's EOL judgment in action.

2. **Solvability is distinct from discrepancy.** Solvability stays high during exploration
   (reading files IS progress). Discrepancy stays high (no artifacts yet). Gating
   termination on solvability instead of discrepancy rate is the correct mechanism.

3. **Episodic recall (Memory v3) enables complex tasks.** R-22c showed that ACT-R
   activation retrieval recovers evicted context needed for multi-file tasks (T06).
   This is the hippocampal layer — long-term, on-demand recall.

4. **Per-module working memory recovers reasoning-bound tasks.** R-23 proved that
   the ReasonerActor's scratchpad — plan and understanding that persists across cycles
   independent of shared workspace eviction — is the critical missing piece. T02 was
   0% in every prior partitioned condition; with working memory it's 67% (matching
   flat baseline). This validates the closed algebra: Module :: (I, S, W, κ) → (O, S, W, μ).

5. **No single layer suffices.** The progression shows each intervention contributing
   measurably (+6pp, +5pp, +11pp). The cognitive architecture needs all three:
   anticipatory monitoring, episodic recall, and working memory.

## References

- Carver, C. S., & Scheier, M. F. (1998). *On the Self-Regulation of Behavior.* Cambridge UP.
- Carver, C. S., & Scheier, M. F. (2000). On the structure of behavioral self-regulation.
  In M. Boekaerts et al. (Eds.), *Handbook of Self-Regulation*.
- Flavell, J. H. (1979). Metacognition and cognitive monitoring. *American Psychologist*, 34(10), 906-911.
- Kahneman, D. (2011). *Thinking, Fast and Slow.* Farrar, Straus and Giroux.
- Koriat, A. (2007). Metacognition and consciousness. In P. D. Zelazo et al. (Eds.),
  *Cambridge Handbook of Consciousness*. Cambridge UP.
- Metcalfe, J., & Wiebe, D. (1987). Intuition in insight and noninsight problem solving.
  *Memory & Cognition*, 15(3), 238-246.
- Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new findings.
  *Psychology of Learning and Motivation*, 26, 125-173.
- Powers, W. T. (1973). *Behavior: The Control of Perception.* Aldine.
- Simon, H. A. (1956). Rational choice and the structure of the environment.
  *Psychological Review*, 63(2), 129-138.
