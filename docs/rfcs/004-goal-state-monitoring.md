# RFC 004: Goal-State Monitoring — Closing the Evaluation Gap

**Status:** Draft — theory extension
**Author:** PO + Lysica
**Date:** 2026-04-03
**Extends:** RFC 001 (Calculus of Cognitive Composition)
**Applies to:** `@method/pacta` cognitive algebra, experiment cycle orchestrators
**Organization:** Vidtecci

## Motivation

RFC 001 defines an 8-module cognitive cycle with four composition operators. The
architecture monitors for **process anomalies** — low confidence, stagnation, action
failure, conflict — but is completely silent on **goal satisfaction**. No module
compares the current state to the goal state. No signal type carries "the task is
done." No control directive terminates the cycle on success.

This gap was identified empirically:

- **R-17/R-18:** Partitioned workspace regression. The agent loses context about what
  it's trying to achieve because no module maintains a persistent goal representation
  independent of workspace pressure. The flat workspace succeeds by brute force (everything
  visible), not by cognitive design.
- **R-16:** Goal drift at 30 cycles. The agent loops indefinitely because nothing
  detects that the goal has been achieved (or that it never will be).
- **All conditions:** The `done` action is decided by the LLM with zero metacognitive
  validation. The architecture trusts the object level to make a meta-level decision.

The absence of goal-state monitoring is not an engineering oversight — it reflects a
genuine gap in RFC 001's compositional model. This RFC proposes a principled extension
grounded in cybernetic control theory, metacognitive monitoring research, and
bounded rationality.

## Theoretical Grounding

Five lines of research converge on the same mechanism: **task completion is detected
by the disappearance of a discrepancy signal, not by the appearance of a success signal.**

### 1. Carver-Scheier Cybernetic Control (1998, 2000)

Goal-directed behavior is a **negative feedback loop**: a comparator continuously
measures the discrepancy between current state and reference value (the goal). A
second-order loop — the **metamonitor** — tracks the *rate* of discrepancy reduction.

Three outcomes:
- **Discrepancy → 0**: Goal achieved. Terminate and shift to next goal.
- **Rate → 0, discrepancy > 0**: Stuck. Trigger strategy change or goal disengagement.
- **Rate < 0** (discrepancy increasing): Regression. Trigger alarm and intervention.

> Carver, C. S., & Scheier, M. F. (1998). *On the Self-Regulation of Behavior.*
> Cambridge University Press.
>
> Carver, C. S., & Scheier, M. F. (2000). On the structure of behavioral
> self-regulation. In M. Boekaerts et al. (Eds.), *Handbook of Self-Regulation*.

### 2. Nelson-Narens Judgment of Performance (1990)

The metacognitive monitoring taxonomy defines **Judgment of Performance (JOP)** as a
post-action evaluation: "how well did I just do?" This is distinct from Feeling of
Knowing (pre-retrieval) and Judgment of Learning (during study). JOP feeds the
**control** decision to continue, terminate, or change strategy.

Task completion requires JOP exceeding a threshold the meta-level holds as "sufficient."
RFC 001 implements Feeling of Knowing (confidence) and ease-of-learning (effort) but
not JOP. The Evaluator estimates progress from signal quality, not from outcome assessment.

> Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new
> findings. In G. Bower (Ed.), *The Psychology of Learning and Motivation* (Vol. 26).

### 3. Simon's Satisficing (1956)

Agents maintain a dynamic **aspiration level** — a "good enough" threshold. Search
terminates when the first option meeting the threshold is found. The aspiration level
rises when progress is easy and drops when search is costly.

The key insight: termination is not optimization. The agent doesn't need to know it
found the *best* solution — only that the solution meets the aspiration level. This
is computationally cheaper than verification and sufficient for bounded agents.

> Simon, H. A. (1956). Rational choice and the structure of the environment.
> *Psychological Review*, 63(2), 129-138.

### 4. ACC Conflict Drop (Botvinick et al., 2001, 2004)

The dorsal anterior cingulate cortex (dACC) monitors response conflict — co-activation
of incompatible action representations. RFC 001's Monitor implements conflict *presence*
detection (Botvinick's model). What's missing: **conflict *absence* detection.**

When goal-state and current-state representations stop conflicting (discrepancy = 0),
the ACC signal drops, releasing the dorsolateral PFC from compensatory control. Task
completion is neurally "quiet" — the signal *stops*, it doesn't fire.

> Botvinick, M. M., Braver, T. S., Barch, D. M., Carter, C. S., & Cohen, J. D. (2001).
> Conflict monitoring and cognitive control. *Psychological Review*, 108(3), 624-652.

### 5. Reward Prediction Error Absence (Schultz, 1997)

Dopamine neurons fire on **unexpected** reward (positive RPE) and depress on
**unexpected** omission (negative RPE). **Expected** reward produces baseline activity
— no signal. Task completion that matches expectation is neurochemically silent.

The implication: a well-calibrated agent should detect completion by the *absence*
of surprise, not by a reward burst. The monitoring system should notice that
predictions are consistently met and nothing is triggering alarm.

> Schultz, W. (1997). Dopamine neurons and their role in reward mechanisms.
> *Current Opinion in Neurobiology*, 7(2), 191-197.

## The Gap in RFC 001

RFC 001's cognitive cycle implements the **left half** of metacognitive monitoring
(anomaly detection) but not the **right half** (goal evaluation):

```
                 Metacognitive Monitoring
                 ┌─────────────────────────────────────┐
                 │                                     │
    ┌────────────┴──────────┐       ┌──────────────────┴────────┐
    │   Process Monitoring  │       │   Outcome Monitoring      │
    │   (RFC 001: ✓)        │       │   (RFC 001: ✗)            │
    │                       │       │                           │
    │   • Confidence        │       │   • Goal-state discrepancy│
    │   • Stagnation        │       │   • Judgment of Performance│
    │   • Conflict          │       │   • Satisficing threshold │
    │   • Prediction error  │       │   • Discrepancy rate      │
    │   • Impasse detection │       │   • Termination signal    │
    └───────────────────────┘       └───────────────────────────┘
```

**F1-FTH defines the concepts but RFC 001 doesn't implement them:**
- `O: Mod(D) → Bool` (objective predicate) — defined in theory, absent from cycle
- `μ⃗` (success profile) — defined in theory, no module computes it
- Termination certificate — defined for methodologies, absent from cognitive cycles

The cognitive cycle inherits the methodology's goal but has no mechanism to evaluate
it. This is the compositional gap: the hierarchy operator (▷) connects Monitor to
object-level for anomaly detection, but there's no corresponding connection for
goal evaluation.

## Proposed Extension

### 1. Goal-State Discrepancy Signal

A new signal type carrying the result of comparing current state to goal state:

```
GoalDiscrepancy = {
  source:       ModuleId,
  timestamp:    number,
  discrepancy:  number,       // [0, 1] — 0 = goal satisfied, 1 = no progress
  rate:         number,       // Δdiscrepancy / Δcycle — positive = improving
  confidence:   number,       // [0, 1] — how reliable is this estimate?
  satisfied:    boolean,      // discrepancy < satisficing threshold
  basis:        string,       // what was compared (human-readable)
}
```

**Design notes:**

- `discrepancy` is the Carver-Scheier comparator output. It measures how far
  the current state is from the goal, not how confident the agent is.
- `rate` is the metamonitor — the derivative. Positive rate = making progress.
  Zero rate = stuck. Negative rate = regressing.
- `satisfied` applies Simon's satisficing: the goal doesn't need to be perfectly
  achieved, just "good enough" relative to a dynamic aspiration level.
- `confidence` is the meta-meta signal: how much should the cycle trust this
  assessment? A low-confidence satisfaction signal should not terminate the cycle.
- `basis` provides observability — what did the evaluator actually compare?

### 2. Evaluator Redesign: From Signal Aggregator to Goal Comparator

The current Evaluator:
```
step(workspace, signals) → { estimatedProgress, diminishingReturns }
```

Estimates progress from `avg(confidence + success)`. This is proxy measurement —
it correlates with progress but doesn't measure it.

The redesigned Evaluator:
```
step(workspace, signals, goalState) → { discrepancy, jop }

where:
  goalState:    GoalRepresentation     // persistent, never evicted
  discrepancy:  GoalDiscrepancy        // Carver-Scheier comparator output
  jop:          JudgmentOfPerformance  // Nelson-Narens post-action evaluation
```

**GoalRepresentation** is a first-class input to the Evaluator, not a workspace
entry that competes for attention. The goal is extracted at cycle 0 by the Observer
and maintained as module state — immune to workspace pressure.

**JudgmentOfPerformance** extends the Nelson-Narens taxonomy beyond the existing
EOL/JOL/FOK/RC:

```
JudgmentOfPerformance = {
  outcome:      'success' | 'partial' | 'failure' | 'unknown',
  confidence:   number,       // [0, 1] — how sure is this judgment?
  evidence:     string[],     // what workspace entries support this judgment?
}
```

**The Evaluator runs unconditionally** — not gated by the Monitor's anomaly
threshold. This is the critical change. Completion detection is the *opposite*
of anomaly detection: it fires when things are going well, not when they're
going wrong. Gating the Evaluator behind the Monitor means it can never detect
success.

### 3. Termination Control Directive

A new control directive that the cycle orchestrator understands:

```
TerminateDirective extends ControlDirective = {
  target:     'cycle',
  reason:     'goal-satisfied' | 'goal-unreachable' | 'budget-exhausted',
  confidence: number,
  evidence:   GoalDiscrepancy,
}
```

**Three termination modes:**
- **goal-satisfied:** Discrepancy below satisficing threshold with sufficient
  confidence. The positive case — we're done.
- **goal-unreachable:** Discrepancy stable or increasing over N cycles, combined
  with diminishing returns. The negative case — we should stop trying.
- **budget-exhausted:** External constraint. Not a cognitive decision but needs
  to be distinguished from the above for observability.

**The termination decision is meta-level, not object-level.** Currently, the
LLM decides "done" (object-level), which is asking the task-executor to judge
its own output. In the extended model, the Evaluator (meta-level) assesses
goal satisfaction and issues a TerminateDirective. The object-level can suggest
completion, but the meta-level validates it.

### 4. Adaptive Context Selection

The partition regression (R-18) reveals that static budget allocation across
partitions is insufficient. The agent's context needs change across the task
lifecycle:

```
Phase 1 (orientation):  High goal/constraint, low operational
Phase 2 (execution):    Balanced — goal + operational + constraint
Phase 3 (verification): High goal, moderate operational (for comparison)
```

The Evaluator's GoalDiscrepancy signal can drive context selection:

```
ContextBias = f(discrepancy, rate, cycle)

where:
  high discrepancy, positive rate  → execution bias (operational)
  high discrepancy, zero rate      → reorientation bias (goal + constraint)
  low discrepancy, any rate        → verification bias (goal + operational)
```

This connects the Evaluator to the workspace attention mechanism. Currently,
salience is computed at write time (static). With goal-state monitoring,
salience can be *reweighted* based on where the agent is in the task lifecycle.

## Composition with Existing Operators

### Evaluator as Hierarchical Monitor

The redesigned Evaluator composes via the hierarchical operator (▷) with the
entire object-level, just as the Monitor does — but monitoring a different signal:

```
Agent = (Monitor ▷ ObjectLevel) ∧ (Evaluator ▷ ObjectLevel)

where:
  Monitor   reads: process signals (confidence, stagnation, conflict)
  Evaluator reads: goal state + workspace state → discrepancy
```

Both are meta-level modules. Both produce control directives. They operate in
parallel on different signal domains. The Monitor catches process failures; the
Evaluator catches goal satisfaction (and goal failure).

### Integration with the Cognitive Cycle

The 8-phase cycle extends to include unconditional evaluation:

```
1. OBSERVE   — Observer processes new input
2. ATTEND    — Workspace attention selects salient entries
3. REMEMBER  — Memory retrieves relevant knowledge
4. REASON    — Reasoner produces reasoning trace
5. MONITOR   — Meta-level reads monitoring signals (conditional on threshold)
6. EVALUATE  — Evaluator compares workspace state to goal state (unconditional)
7. CONTROL   — Meta-level issues control directives (including TerminateDirective)
8. ACT       — Actor selects and executes action
9. LEARN     — Reflector distills cycle into memory (async)
```

**Phase 6 (EVALUATE) is new and unconditional.** It runs every cycle, producing
a GoalDiscrepancy signal. Phase 7 (CONTROL) now has both Monitor and Evaluator
signals to act on. The TerminateDirective, if issued, prevents Phase 8 (ACT)
from executing and exits the cycle.

### Cost Model

The Evaluator is a **rule-based module** — it compares workspace entries against
the goal representation using heuristics (keyword overlap, structural matching,
constraint satisfaction). No LLM call. Cost per cycle: negligible (< 1ms).

If higher-fidelity evaluation is needed, an LLM-backed Evaluator can be gated
by the rule-based one: run the cheap check every cycle, escalate to LLM evaluation
only when the rule-based check produces low confidence. This mirrors the
default-interventionist pattern already established for the Monitor.

## Formal Definition

### GoalRepresentation

```
G = {
  objective:    string,           // natural language goal statement
  constraints:  string[],         // extracted prohibitions and requirements
  subgoals:     SubGoal[],        // decomposed sub-objectives (optional)
  aspiration:   number,           // satisficing threshold [0, 1], default 0.8
}

SubGoal = {
  description:  string,
  satisfied:    boolean,
  evidence:     string | undefined,
}
```

**Extraction:** The Observer extracts G from the task input at cycle 0. The
Planner may refine G.subgoals during execution. G is stored as Evaluator
internal state — not a workspace entry. It is immune to eviction.

### Evaluator Module (Redesigned)

```
Evaluator = (
  I:  { workspace: ReadonlyWorkspaceSnapshot, signals: AggregatedSignals },
  O:  { discrepancy: GoalDiscrepancy, jop: JudgmentOfPerformance },
  S:  { goal: GoalRepresentation, history: GoalDiscrepancy[], aspirationLevel: number },
  mu: EvaluatorMonitoring & { discrepancy: GoalDiscrepancy },
  kappa: { evaluationHorizon: 'immediate' | 'trajectory' }
)
```

### Discrepancy Computation

The simplest viable discrepancy function (rule-based, no LLM):

```
discrepancy(workspace, goal) =
  let goalTerms     = extractKeyTerms(goal.objective)
  let constraintMet = goal.constraints.every(c => !violated(workspace, c))
  let subgoalScore  = goal.subgoals.filter(s => s.satisfied).length / goal.subgoals.length
  let termOverlap   = countOverlap(goalTerms, workspaceWriteActions(workspace))
  let writeActivity = hasWriteAction(recentCycles)

  // Weighted combination — subgoals dominate if decomposed
  if goal.subgoals.length > 0:
    return 1.0 - (0.6 * subgoalScore + 0.2 * termOverlap + 0.2 * (constraintMet ? 1 : 0))
  else:
    return 1.0 - (0.5 * termOverlap + 0.3 * (constraintMet ? 1 : 0) + 0.2 * writeActivity)
```

**This is deliberately simple.** A heuristic comparator that checks keyword overlap,
constraint satisfaction, and whether the agent has actually produced output. It
won't catch subtle failures — but it will catch obvious completion ("file created
and constraints met") and obvious stagnation ("nothing written in 5 cycles").

For higher fidelity, the SLM compilation pipeline (RFC 002) can train a specialized
evaluator on goal-satisfaction judgments, replacing the rule-based function with a
compiled SLM call at negligible cost.

### Satisficing Dynamics

The aspiration level is dynamic (Simon's model):

```
aspirationLevel(cycle) =
  if rate > 0:    min(aspiration + 0.05, 0.95)   // progress → raise bar
  if rate == 0:   max(aspiration - 0.10, 0.50)   // stuck → lower bar
  if rate < 0:    max(aspiration - 0.15, 0.40)   // regressing → lower faster
```

The agent starts with high aspirations and lowers them when stuck. This prevents
both premature termination (aspiration too low) and infinite cycling (aspiration
too high). The floor (0.40) ensures the agent eventually accepts "good enough."

### Termination Decision

```
terminate(discrepancy, aspirationLevel, confidence, cycle, maxCycles) =
  if discrepancy.satisfied && confidence > 0.7:
    TerminateDirective('goal-satisfied')
  elif cycle > maxCycles * 0.6 && rate <= 0 && diminishingReturns:
    TerminateDirective('goal-unreachable')
  elif cycle >= maxCycles:
    TerminateDirective('budget-exhausted')
  else:
    continue
```

## Relationship to Other RFCs

### RFC 001 (Cognitive Composition)

This RFC extends RFC 001's cognitive cycle with a 9th phase (EVALUATE, unconditional)
and a new signal type (GoalDiscrepancy). All existing composition operators remain
unchanged. The Evaluator's redesign is backward-compatible: the existing
`estimatedProgress` and `diminishingReturns` are subsumed by GoalDiscrepancy.

### RFC 002 (Small Language Models)

The rule-based discrepancy function is a compilation target for RFC 002. Once the
heuristic is validated, it can be trained as an SLM — producing goal-satisfaction
judgments at SLM cost (~0.15% fallback rate per R-14).

### RFC 003 (Workspace Partitions)

Goal-state monitoring directly addresses the partition regression. With adaptive
context selection driven by GoalDiscrepancy, the partition budget allocation
becomes dynamic rather than static. The Evaluator's assessment of task lifecycle
phase drives which partitions receive priority.

### F1-FTH (Formal Theory)

This RFC operationalizes F1-FTH's `O: Mod(D) → Bool` within the cognitive cycle.
The GoalRepresentation is the cycle's view of O; the discrepancy function is the
cycle's approximation of `O(current_state)`. The satisficing threshold replaces
exact satisfaction with bounded-rationality semantics.

## Validation Criteria

1. **Completion detection:** The Evaluator detects goal satisfaction before
   MAX_CYCLES on tasks where the agent currently exhausts all cycles (T02, T05).
   Measured: cycle number at which TerminateDirective fires vs MAX_CYCLES.

2. **False positive rate:** The Evaluator does not prematurely terminate on tasks
   that require extended search (T01, T06). Measured: success rate does not
   decrease vs baseline on search-heavy tasks.

3. **Partition regression recovery:** With adaptive context selection, T02 and T04
   pass rates under partitioned workspace match or exceed flat baseline.
   Measured: pass rate comparison R-18 (partitioned, no evaluation) vs R-20
   (partitioned + goal-state monitoring).

4. **Stuck detection:** The Evaluator detects goal-unreachable before MAX_CYCLES
   on tasks where the agent loops without progress (T06 at 30 cycles).
   Measured: cycle number at which goal-unreachable fires vs MAX_CYCLES.

**Abandonment criterion:** If the rule-based Evaluator produces > 30% false
positive terminations across T01-T06, the approach should be refined (LLM-backed
evaluation) or the satisficing dynamics re-tuned before further experimentation.

## Open Questions

**Q1:** Should the Evaluator have direct access to the tool provider (to validate
its own assessment), or should it remain read-only? Direct access enables
verification ("did the file actually get created?") but violates the
monitor-doesn't-act principle from Nelson & Narens.

**Q2:** How should goal decomposition interact with satisficing? If the Planner
decomposes the goal into subgoals, the Evaluator can track per-subgoal satisfaction.
But subgoal decomposition may be wrong — the Evaluator needs a meta-assessment of
plan quality, not just subgoal completion.

**Q3:** Can the aspiration level be learned from task history? Currently it's a
heuristic that rises and falls with rate. A more principled approach would calibrate
aspiration from historical task completion data (similar to RFC 002's calibration
approach).

**Q4:** How does goal-state monitoring interact with the System 1/2 transition
(RFC 001 Part V)? A compiled System 1 response might include a compiled satisfaction
check — pattern-match on output structure rather than running the full Evaluator.
