# RFC 004: Goal-State Monitoring — Closing the Evaluation Gap

**Status:** Draft — theory extension
**Author:** PO + Lysica
**Date:** 2026-04-03
**Extends:** RFC 001 (Calculus of Cognitive Composition)
**Applies to:** `@methodts/pacta` cognitive algebra, experiment cycle orchestrators
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

> **Epistemological note:** This RFC uses cognitive science as *design inspiration*,
> not as biological validation — consistent with RFC 001's stated approach. The
> engineering proposal (add goal-state comparison to the cycle) stands on its own
> merits. The cognitive science provides design vocabulary, decomposition rationale,
> and named mechanisms that inform the architecture. Where the analogy breaks, the
> RFC should stand on engineering merit alone.

The following research lines inform the design. The strongest grounding is
Carver-Scheier's cybernetic control model; the others provide supporting
perspectives with varying degrees of directness:

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

### 2. Koriat's Monitoring for Control (2007); Nelson-Narens (1990)

> **FCD review correction:** An earlier draft attributed the general concept of
> post-action outcome evaluation to Nelson & Narens' Judgment of Performance (JOP).
> However, JOP in Nelson & Narens (1990) is specifically about *metamemory* — judging
> memory retrieval performance. The general framework of metacognitive monitoring
> driving control decisions is better attributed to Koriat (2007) and Flavell (1979).

Koriat's "monitoring for control" framework establishes that metacognitive judgments
(confidence, feeling of knowing, ease of learning) serve a functional purpose: they
are **inputs to control decisions** about whether to continue, terminate, or change
strategy. The monitoring signal is not merely informational — it drives action.

Task completion requires a monitoring signal exceeding a threshold the meta-level
holds as "sufficient." RFC 001 implements Feeling of Knowing (confidence) and
ease-of-learning (effort) but not outcome evaluation. The Evaluator estimates
progress from signal quality, not from goal-state comparison.

> Koriat, A. (2007). Metacognition and consciousness. In P. D. Zelazo, M. Moscovitch,
> & E. Thompson (Eds.), *The Cambridge Handbook of Consciousness*. Cambridge UP.
>
> Nelson, T. O., & Narens, L. (1990). Metamemory: A theoretical framework and new
> findings. In G. Bower (Ed.), *The Psychology of Learning and Motivation* (Vol. 26).
>
> Flavell, J. H. (1979). Metacognition and cognitive monitoring: A new area of
> cognitive-developmental inquiry. *American Psychologist*, 34(10), 906-911.

### 3. Satisficing and Aspiration Adaptation (Simon, 1956; Selten, 1998)

Agents maintain a dynamic **aspiration level** — a "good enough" threshold. Search
terminates when the first option meeting the threshold is found (Simon, 1956).

> **FCD review correction:** The directional dynamics of aspiration adaptation
> (raise when succeeding, lower when failing) are more precisely attributed to
> Selten's (1998) aspiration adaptation theory and Lewin's (1944) level-of-aspiration
> work than to Simon (1956), who describes satisficing as a search termination rule
> without specifying the adaptation mechanism.

The key insight: termination is not optimization. The agent doesn't need to know it
found the *best* solution — only that the solution meets the aspiration level. This
is computationally cheaper than verification and sufficient for bounded agents.

> Simon, H. A. (1956). Rational choice and the structure of the environment.
> *Psychological Review*, 63(2), 129-138.
>
> Selten, R. (1998). Aspiration adaptation theory.
> *Journal of Mathematical Psychology*, 42(2-3), 191-214.

### 4. ACC Conflict Monitoring (Botvinick et al., 2001, 2004)

The dorsal anterior cingulate cortex (dACC) monitors response conflict — co-activation
of incompatible action representations. RFC 001's Monitor implements conflict *presence*
detection (Botvinick's model).

> **Caveat:** Botvinick's conflict monitoring operates at the *response* level (competing
> motor plans), not the *goal* level (goal-state discrepancy). Absence of response
> conflict means no competing actions — it does not directly signal goal satisfaction.
> An agent can be confidently wrong with zero conflict, and a completed task can still
> have response conflict (e.g., choosing output format). The design inspiration here
> is the *structural pattern* — a monitoring system that detects signal absence as
> meaningful — not a direct functional mapping.

The engineering takeaway: the Monitor already detects conflict *presence*. A
complementary mechanism that tracks the *reduction* of monitoring signals over time
(decreasing anomalies, increasing confidence) provides indirect evidence of
convergence toward a stable solution.

> Botvinick, M. M., Braver, T. S., Barch, D. M., Carter, C. S., & Cohen, J. D. (2001).
> Conflict monitoring and cognitive control. *Psychological Review*, 108(3), 624-652.

### 5. Reward Prediction Error (Schultz, 1997)

Dopamine neurons fire on **unexpected** reward (positive RPE) and depress on
**unexpected** omission (negative RPE). **Expected** reward produces baseline activity
— no signal.

> **Caveat:** RPE baseline activity during expected outcomes is the *absence* of a
> learning signal, not a *detection mechanism* for task completion. The brain does not
> "detect" completion via RPE silence; it uses other mechanisms (prefrontal working
> memory, goal representations). RPE silence means the system has nothing new to
> learn, not that the task is done. The causal arrow matters: RPE absence is a
> *consequence* of accurate prediction, not the *cause* of completion detection.

The engineering takeaway: when the Monitor's prediction error signals (Friston's
model, already implemented in MonitorV2) consistently stay low — predictions match
observations — this is indirect evidence that the system has converged to a stable
state. Combined with positive discrepancy evidence from the Evaluator, low prediction
error strengthens the confidence in a TerminateSignal.

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
GoalDiscrepancy extends MonitoringSignal = {
  type:         'goal-discrepancy',  // discriminant tag for ModuleMonitoringSignal union
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

- GoalDiscrepancy carries a `type: 'goal-discrepancy'` discriminant to join the
  existing `ModuleMonitoringSignal` union (which discriminates on literal `type` tags).
  It extends `MonitoringSignal`, not `ControlDirective` — goal satisfaction is a
  monitoring signal emitted upward, not a control directive issued downward.
- `discrepancy` is the Carver-Scheier comparator output. It measures how far
  the current state is from the goal, not how confident the agent is.
- `rate` is the metamonitor — the derivative. Positive rate = making progress.
  Zero rate = stuck. Negative rate = regressing.
- `satisfied` applies satisficing semantics (Selten, 1998): the goal doesn't need
  to be perfectly achieved, just "good enough" relative to a dynamic aspiration level.
- `confidence` is the meta-meta signal: how much should the cycle trust this
  assessment? A low-confidence satisfaction signal should not terminate the cycle.
  When aspiration has been lowered (below initial 0.80), the confidence gate
  tightens to > 0.85 to prevent premature termination on degraded criteria.
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
step(input: { workspace, signals }, state: { goal, history, aspirationLevel }, control) →
  { discrepancy, jop }

where:
  state.goal:   GoalRepresentation     // persistent in S, never evicted
  discrepancy:  GoalDiscrepancy        // Carver-Scheier comparator output
  jop:          JudgmentOfPerformance  // Koriat monitoring-for-control
```

> **FCD review correction:** GoalRepresentation lives in the Evaluator's internal
> state (S), not as a third step argument. The `CognitiveModule.step` contract is
> `(I, S, κ) → (O, S', μ)` — adding a third argument would break the contract and
> the composition operators. State is the correct location: it's opaque to other
> modules and persists across cycles, which is exactly what we need for an
> immune-to-eviction goal representation.

**GoalRepresentation** is extracted at cycle 0 by the Observer and injected into
the Evaluator's initial state. It persists across cycles as module state — immune
to workspace pressure. The existing `EvaluatorInput` (`{ workspace, signals }`)
remains unchanged; the goal enters through state, not input.

**JudgmentOfPerformance** extends the metacognitive monitoring taxonomy. This is
closer to Koriat's (2007) "monitoring for control" framework than Nelson-Narens'
(1990) metamemory-specific JOP:

```
JudgmentOfPerformance = {
  outcome:      'success' | 'partial' | 'failure' | 'unknown',
  confidence:   number,       // [0, 1] — how sure is this judgment?
  evidence:     string[],     // what workspace entries support this judgment?
}
```

**The Evaluator runs unconditionally** — not gated by the Monitor's anomaly
threshold. This is the critical architectural change. Completion detection cannot
be gated by anomaly detection: anomalies fire when things go *wrong*, but
completion needs to be checked when things go *right*. Gating the Evaluator behind
the Monitor means it can never detect success during normal operation.

> **Note on cognitive plausibility:** Human metacognitive monitoring is not truly
> continuous — it is triggered by cues (output production, environmental change,
> time pressure; see Ackerman & Thompson, 2017). However, the engineering cost of
> unconditional evaluation is negligible (< 1ms for rule-based heuristics), and
> the alternative (cue-triggered evaluation) requires a cue-detection mechanism
> that is itself a new module. Unconditional evaluation is the simpler engineering
> choice. If profiling shows overhead, a lightweight cue gate (e.g., "evaluate only
> after Write actions") can be added without changing the architecture.

This does not create a new composition operator — it constrains the cycle
orchestrator. The existing algebra operators (▷, >>, |, <|>) are unchanged.
The default-interventionist pattern still applies to MONITOR/CONTROL; EVALUATE
is simply exempt from that gating.

### 3. Termination Signal (Monitoring Channel, Not Control)

> **FCD review correction:** An earlier draft proposed `TerminateDirective` as a
> `ControlDirective`. This is a type error: `ControlDirective` requires `target: ModuleId`
> and flows *downward* (meta → object). Termination targets the cycle orchestrator
> *above* the meta-level — it must flow *upward* as a monitoring signal (μ), not
> downward as control (κ). The orchestrator reads the signal and decides to halt.

A new monitoring signal that the cycle orchestrator reads from `CycleResult`:

```
TerminateSignal extends MonitoringSignal = {
  type:       'terminate',
  source:     ModuleId,        // the Evaluator that issued it
  reason:     'goal-satisfied' | 'goal-unreachable' | 'budget-exhausted',
  confidence: number,
  evidence:   GoalDiscrepancy,
}
```

**Propagation path:** The Evaluator emits `TerminateSignal` as its monitoring
output (μ). The cycle orchestrator checks for this signal after the EVALUATE
phase. If present, `CycleResult` gains a `terminated: TerminateSignal` field,
and the external loop (experiment runner or `CognitiveAgent.invoke()`) breaks.

```
CycleResult = {
  output:     ActorOutput,
  signals:    AggregatedSignals,
  terminated: TerminateSignal | undefined,   // NEW — orchestrator reads this
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
goal satisfaction and emits a TerminateSignal. The orchestrator reads it. The
object-level can suggest completion, but the meta-level validates it.

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

> **Scope limitation:** Adaptive context selection addresses the partition regression
> for tasks where the agent fails due to *lost context* (T04: constraint not visible).
> It does NOT address tasks where the agent fails due to *reasoning limitations*
> (T02: agent reads the buggy code but cannot identify the arithmetic error). T02's
> failure is a reasoning ceiling, not a context selection problem. Adaptive context
> allocation will not fix it — the agent has the right information and can't act on it.
> This RFC acknowledges this boundary: goal-state monitoring improves *metacognitive*
> capability (knowing when you're done, stuck, or lost), not *reasoning* capability
> (solving hard problems).

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
7. CONTROL   — Meta-level issues control directives
8. ACT       — Actor selects and executes action
9. LEARN     — Reflector distills cycle into memory (async)
```

**Phase 6 (EVALUATE) is new and unconditional.** It runs every cycle, producing
a GoalDiscrepancy signal (monitoring channel, μ). The cycle orchestrator checks
for a TerminateSignal in the Evaluator's monitoring output after Phase 6. If
present, Phases 7-9 are skipped and the cycle returns with `terminated` set in
`CycleResult`.

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
  I:     { workspace: ReadonlyWorkspaceSnapshot, signals: AggregatedSignals },
  O:     { discrepancy: GoalDiscrepancy, jop: JudgmentOfPerformance },
  S:     { goal: GoalRepresentation, history: GoalDiscrepancy[], aspirationLevel: number },
  mu:    GoalDiscrepancy,      // type: 'goal-discrepancy' — joins ModuleMonitoringSignal union
  kappa: { evaluationHorizon: 'immediate' | 'trajectory' }
)
```

Note: `I` is unchanged from the current Evaluator (`{ workspace, signals }`).
`GoalRepresentation` lives in `S` (internal state), not `I`. This preserves the
`CognitiveModule.step(I, S, κ) → (O, S', μ)` contract and backward compatibility
with composition operators. The existing `EvaluatorMonitoring` fields
(`estimatedProgress`, `diminishingReturns`) are subsumed by `GoalDiscrepancy`.

Backward compatibility: if `goal` in state is `undefined` (no goal extracted),
the Evaluator falls back to the current signal-aggregation behavior. All existing
tests pass without modification.

```
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

The aspiration level is dynamic (Selten's aspiration adaptation model):

```
aspirationLevel(cycle) =
  if rate > 0:    min(aspiration + 0.05, 0.95)   // progress → raise bar
  if rate == 0:   max(aspiration - 0.05, 0.60)   // stuck → lower bar cautiously
  if rate < 0:    max(aspiration - 0.10, 0.60)   // regressing → lower faster
```

> **FCD review correction:** An earlier draft used a floor of 0.40 with aggressive
> lowering (-0.10, -0.15). Combined with crude keyword-overlap discrepancy, this
> risked premature termination: an agent could declare "good enough" with 60%
> discrepancy remaining if it wrote *something* to the target file. The floor is
> raised to 0.60, and the lowering rate is halved. Additionally, when aspiration
> has been lowered below initial (0.80), the confidence gate for TerminateSignal
> tightens from > 0.70 to > 0.85 (see Termination Decision below).

The agent starts with high aspirations and lowers them when stuck. This prevents
both premature termination (aspiration too high relative to discrepancy resolution)
and infinite cycling (aspiration too high to ever satisfy). The floor (0.60)
ensures the agent cannot accept clearly incomplete work.

> **Note on formal termination:** These satisficing dynamics are NOT a termination
> certificate in the F1-FTH sense. The aspiration level can both rise and fall,
> so the pair `(aspiration, discrepancy)` is not monotonically decreasing. The
> `budget-exhausted` fallback provides pragmatic termination but not a formal
> guarantee. A formal certificate would require proving that discrepancy is bounded
> and that the aspiration floor ensures eventual satisfaction — this is an open
> obligation, not a proven property.

### Termination Decision

```
terminate(discrepancy, aspirationLevel, confidence, cycle, maxCycles) =
  let confidenceGate = aspirationLevel < 0.80 ? 0.85 : 0.70  // tighten when lowered
  if discrepancy.satisfied && confidence > confidenceGate:
    TerminateSignal('goal-satisfied')
  elif cycle > maxCycles * 0.6 && rate <= 0 && diminishingReturns:
    TerminateSignal('goal-unreachable')
  elif cycle >= maxCycles:
    TerminateSignal('budget-exhausted')
  else:
    continue
```

When the aspiration level has been lowered (agent is stuck), the confidence gate
tightens from 0.70 to 0.85. This prevents the failure mode where a crude discrepancy
function combined with lowered aspirations declares "good enough" on incomplete work.

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

> **FCD review correction:** An earlier draft claimed this RFC "operationalizes"
> F1-FTH's `O: Mod(D) → Bool`. This is formally imprecise. F1-FTH's O is a
> predicate on model-theoretic structures (full world states with carrier sets
> and interpretations). The RFC's discrepancy function operates on keyword overlap
> and workspace entry counts. No embedding from workspace snapshots into `Mod(D)`
> is defined. The relationship is *analogical*, not *formal*.

This RFC is *inspired by* F1-FTH's objective predicate `O: Mod(D) → Bool`.
The GoalRepresentation is the cycle's informal view of O; the discrepancy function
is a heuristic proxy for `O(current_state)`. The satisficing threshold replaces
exact satisfaction with bounded-rationality semantics. Formalizing the embedding
from workspace snapshots into `Mod(D)` is an open obligation — not attempted here.

## Validation Criteria

1. **Completion detection:** The Evaluator detects goal satisfaction before
   MAX_CYCLES on tasks where the agent currently exhausts all cycles (T02, T05).
   Measured: cycle number at which TerminateSignal fires vs MAX_CYCLES.

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
