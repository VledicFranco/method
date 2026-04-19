---
title: "PRD 035: Cognitive Monitoring & Control v2"
status: implemented
date: "2026-03-29"
tier: heavyweight
depends_on: [30]
enables: [37]
blocked_by: []
complexity: high
domains_affected: [pacta, pacta-testkit]
---

# PRD 035: Cognitive Monitoring & Control v2

**Status:** Validated (2026-03-29) — v2 modules empirically tested, see Validation Results section
**Author:** PO + Lysica
**Date:** 2026-03-29
**Package:** `@methodts/pacta` (L3 — library)
**Depends on:** PRD 030 (Pacta Cognitive Composition)
**Enables:** PRD 037 (Affect Module)
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Problem Statement

The v1 cognitive modules delivered in PRD 030 use first-generation heuristics that are adequate for validating the composition architecture but insufficient for reliable agent monitoring and control. Specific deficiencies:

1. **Scalar confidence is too coarse.** The Monitor reads a single `confidence: number` from the Reasoner and a binary `conflictDetected: boolean`. Nelson & Narens (1990) identified five distinct metacognitive judgments — each triggering different control responses. The current scalar collapses all metacognitive information into one dimension.

2. **No prediction-error tracking.** The Monitor detects anomalies by comparing signals against fixed thresholds. Friston's predictive processing framework (2009, 2010) demonstrates that monitoring should track DEVIATIONS from expected behavior — "the Reasoner usually responds in 2 steps; this time it took 7" is a prediction error worth attending to. The v1 Monitor has no expectation model.

3. **No impasse detection.** When the ReasonerActor gets stuck — tied between approaches, repeating the same action, or stalling with no progress — the agent has no mechanism to detect or recover from the impasse. The 2025 Large Reasoning Model research (OpenReview) identifies this as a primary failure mode: agents cannot detect when they are stuck, perseverate on wrong approaches, and fail to switch strategies. SOAR (Laird, Newell, Rosenbloom 1987) solves this with automatic impasse detection and subgoal generation.

4. **Fixed intervention thresholds.** The v1 Monitor uses `confidenceThreshold: 0.3` and `stagnationThreshold: 3` as fixed constants. Botvinick et al. (2001) demonstrated the Gratton effect: after a conflict cycle, thresholds should lower (expect more conflict); after a clean cycle, thresholds should raise. Fixed thresholds cause both over-monitoring (wasted tokens on routine cycles) and under-monitoring (missed anomalies when patterns shift).

5. **Ad-hoc salience scoring.** The workspace's `defaultSalienceFunction` uses `0.4*recency + 0.3*source + 0.3*goal` — hand-tuned weights with no selection history. Desimone & Duncan (1995) and Awh, Belopolsky & Theeuwes (2012) establish that attention is driven by three independent factors: stimulus salience (bottom-up), goal relevance (top-down), and selection history (learned bias). The v1 ATTEND phase ignores the third factor entirely.

6. **Coarse effort allocation.** The ProviderAdapter modulates LLM calls with string prefixes (`'Briefly: '`, `''`, `'Thoroughly and comprehensively: '`). Da Costa et al. (2024) and Shenhav et al. (2013) formalize effort as a continuous precision parameter — a scalar in [0, 1] that maps to concrete configuration changes (token budget, temperature, prompt depth). The v1 system has no principled effort allocation.

These are not theoretical concerns. The 2025 OpenReview study on metacognitive failure in Large Reasoning Models documents that state-of-the-art agents specifically fail because they lack functional metacognition: inability to detect when stuck, failure to switch strategies, and perseveration on wrong approaches. External metacognitive scaffolding — like the Monitor module — adds genuine value that the LLM cannot replicate internally (arXiv:2505.13763), but only if the scaffolding implements validated mechanisms rather than ad-hoc heuristics.

## Objective

Deliver v2 implementations of Monitor, ATTEND, ReasonerActor, and ProviderAdapter as **plug-and-play replacements** that implement the same `CognitiveModule<I,O,S,Mu,Kappa>` contract defined in PRD 030. Existing v1 modules remain available. Users choose which version to compose.

Specifically:

1. **MonitorV2** — prediction-error tracking, metacognitive taxonomy (Nelson & Narens), precision weighting, adaptive thresholds via Gratton effect
2. **PriorityAttend** — three-factor biased competition (stimulus salience + goal relevance + selection history) with winner suppression
3. **ReasonerActorV2** — impasse detection (tie, no-change, rejection, stall) with auto-subgoal generation
4. **PrecisionAdapter** — continuous precision parameter replacing discrete effort levels, driven by prediction error
5. **EVC-based control gating** — Expected Value of Control threshold policy replacing fixed thresholds

All v2 modules are drop-in replacements for their v1 counterparts. An `enrichedPreset` composes all v2 modules into a ready-to-use cognitive agent configuration.

## Architecture & Design

### Plug-and-Play Principle

Every v2 module implements the same `CognitiveModule<I,O,S,Mu,Kappa>` interface as its v1 counterpart. The composition engine, cycle orchestrator, and workspace require zero changes. Users select modules at composition time:

```typescript
// v1 (existing — unchanged)
const agent = createCognitiveAgent({ modules: { monitor: createMonitor(config), ... } });

// v2 (new — same slot, different factory)
const agent = createCognitiveAgent({ modules: { monitor: createMonitorV2(config), ... } });

// Mix-and-match: v2 monitor with v1 reasoner-actor
const agent = createCognitiveAgent({
  modules: {
    monitor: createMonitorV2(config),
    reasonerActor: createReasonerActor(adapter, tools, writePort),
  },
});
```

### Module Catalog Exports

```typescript
// New exports from @methodts/pacta
export { createMonitorV2, type MonitorV2Config, type MonitorV2State, type EnrichedMonitoringSignal } from './cognitive/modules/monitor-v2.js';
export { createReasonerActorV2, type ReasonerActorV2Config, type ImpasseSignal } from './cognitive/modules/reasoner-actor-v2.js';
export { createPriorityAttend, type PriorityAttendConfig, type PriorityScore } from './cognitive/modules/priority-attend.js';
export { createPrecisionAdapter, type PrecisionConfig } from './cognitive/algebra/precision-adapter.js';
export { evcThresholdPolicy, type EVCConfig } from './cognitive/engine/evc-policy.js';

// Presets
export { enrichedPreset } from './cognitive/presets/enriched.js';
```

### Domain Structure

New files slot into the existing FCA structure from PRD 030:

```
packages/pacta/src/cognitive/
  algebra/
    enriched-signals.ts       EnrichedMonitoringSignal, MetacognitiveJudgment types
    precision-adapter.ts      PrecisionAdapter wrapping ProviderAdapter
  modules/
    monitor-v2.ts             MonitorV2 — prediction error + metacognitive taxonomy
    reasoner-actor-v2.ts      ReasonerActorV2 — impasse detection + auto-subgoaling
    priority-attend.ts        PriorityAttend — three-factor biased competition
  engine/
    evc-policy.ts             EVC-based ThresholdPolicy
  presets/
    enriched.ts               enrichedPreset composing all v2 modules
```

All boundary rules from PRD 030 remain enforced: `modules/` does not import from `engine/`, `engine/` does not import from `modules/`, new files follow the same discipline.

### Module Designs

#### 1. MonitorV2 — Prediction-Error + Metacognitive Taxonomy

The v1 Monitor maintains a running confidence average and counts conflicts. MonitorV2 replaces this with three validated mechanisms:

**Metacognitive taxonomy.** Following Nelson & Narens (1990), monitoring signals are decomposed into four distinct judgments, each triggering a different control response:

| Judgment | When | What It Monitors | Control Response |
|----------|------|-------------------|-----------------|
| EOL (Ease of Learning) | Before task | Predicted difficulty | Allocate more tokens, deeper strategy |
| JOL (Judgment of Learning) | During task | Current mastery estimate | Switch strategy if low, persist if adequate |
| FOK (Feeling of Knowing) | On retrieval failure | Partial match but can't retrieve | Persist with different retrieval cues |
| RC (Retrospective Confidence) | After responding | Post-hoc accuracy estimate | Withhold output if low, seek verification |

These judgments are computed from externally observable module signals (workspace complexity, evaluator progress, retrieval statistics, action success rates) — not from LLM introspective reports. The taxonomy provides a principled categorization of control-relevant signals; it is not a claim about agent self-awareness.

**Prediction-error tracking.** Following Friston (2009, 2010), MonitorV2 maintains an internal expectation model of each module's behavior: expected duration, expected confidence range, expected action type. Each cycle, it computes the deviation between expected and observed behavior. Large deviations indicate either genuine anomalies or model staleness — both worth investigating.

**Precision weighting.** Following Da Costa et al. (2024), each monitoring signal carries a precision weight — the inverse variance of the signal source's historical reliability (inspired by, but simplified from, Friston's precision in predictive processing — here "precision" means inverse variance of a signal source's historical reliability, not the full Bayesian precision over prediction error distributions). Modules that frequently produce false alarms have their signals down-weighted (low precision). Modules with high historical accuracy have their signals amplified (high precision). This is more principled than treating all signals equally.

**Adaptive thresholds via Gratton effect.** Following Botvinick et al. (2001, 2004), MonitorV2 adjusts its intervention thresholds based on recent history. After a cycle where intervention was triggered, thresholds lower (expect more conflict, be more vigilant). After a clean cycle, thresholds raise (expect routine execution, conserve resources). This prevents both over-monitoring and under-monitoring.

```typescript
/** Enriched monitoring signal extending the base MonitoringSignal. */
interface EnrichedMonitoringSignal extends MonitoringSignal {
  // Nelson & Narens (1990) metacognitive taxonomy
  /** Ease of Learning — predicted difficulty before task (0 = easy, 1 = hard). */
  eol?: number;
  /** Judgment of Learning — current mastery estimate (0 = no mastery, 1 = full mastery). */
  jol?: number;
  /** Feeling of Knowing — partial match detected but retrieval failed. */
  fok?: boolean;
  /** Retrospective Confidence — post-hoc accuracy estimate (0 = uncertain, 1 = certain). */
  rc?: number;

  // Friston (2009) prediction error
  /** Deviation from expected module behavior. Magnitude, not direction. */
  predictionError?: number;
  /** Reliability weight of this signal — inverse variance of source's error history. */
  precision?: number;

  // Botvinick (2001) conflict monitoring
  /** Co-activation energy of incompatible responses. 0 = no conflict. */
  conflictEnergy?: number;
}

/** Expectation model for a single module — what MonitorV2 predicts about its behavior. */
interface ModuleExpectation {
  /** Expected confidence range [min, max]. */
  confidenceRange: [number, number];
  /** Expected step duration in ms. */
  expectedDurationMs: number;
  /** Running mean of observed confidence. */
  meanConfidence: number;
  /** Running variance of observed confidence. */
  varianceConfidence: number;
  /** Number of observations used to build this expectation. */
  observations: number;
  /** Exponential moving average decay factor. */
  alpha: number;
}

/** MonitorV2 internal state. */
interface MonitorV2State {
  /** Per-module expectation models. */
  expectations: Map<ModuleId, ModuleExpectation>;
  /** Per-module precision weights (inverse variance, normalized). */
  precisionWeights: Map<ModuleId, number>;
  /** Current adaptive threshold — adjusts via Gratton effect. */
  adaptiveThreshold: number;
  /** Whether the previous cycle triggered an intervention. */
  previousCycleIntervened: boolean;
  /** Consecutive intervention cycles (for meta-intervention cooldown). */
  consecutiveInterventions: number;
  /** Cycle counter. */
  cycleCount: number;
  /** Conflict count. */
  conflictCount: number;
  /** Running confidence average (backward-compat with v1 report consumers). */
  confidenceAverage: number;
  /** Confidence observation count. */
  confidenceObservations: number;
  /** Consecutive read-only cycles. */
  consecutiveReadOnlyCycles: number;
  /** Recent action inputs for stagnation disambiguation. */
  recentActionInputs: string[];
}

/** Configuration for MonitorV2. */
interface MonitorV2Config {
  /** Base confidence threshold. Gratton effect adjusts this adaptively. Default: 0.3. */
  baseConfidenceThreshold?: number;
  /** Gratton adjustment magnitude — how much thresholds shift per cycle. Default: 0.05. */
  grattonDelta?: number;
  /** Minimum adaptive threshold floor. Default: 0.1. */
  thresholdFloor?: number;
  /** Maximum adaptive threshold ceiling. Default: 0.6. */
  thresholdCeiling?: number;
  /** Prediction error significance threshold. Default: 1.5 (1.5 std deviations). */
  predictionErrorThreshold?: number;
  /** Exponential moving average decay for expectation model. Default: 0.2. */
  expectationAlpha?: number;
  /** Stagnation threshold (consecutive read-only cycles). Default: 3. */
  stagnationThreshold?: number;
  /** Module ID override. Default: 'monitor'. */
  id?: string;
}
```

**Step behavior:**

1. For each signal in `AggregatedSignals`, update the corresponding module's expectation model (running mean, variance)
2. Compute prediction error: `|observed - expected| / sqrt(variance)` — normalized deviation
3. Update precision weight: `1 / variance` for each module, normalized across all modules
4. Produce `EnrichedMonitoringSignal` with metacognitive judgments derived from signal patterns:
   - EOL: estimated from workspace complexity and plan depth (if available)
   - JOL: derived from evaluator progress signals
   - FOK: set when memory retrieval is partial (relevanceScore > 0 but retrievalCount = 0)
   - RC: computed from action success rate and prediction error magnitude
5. Apply Gratton effect: if previous cycle intervened, lower threshold by `grattonDelta`; if previous cycle was clean, raise by `grattonDelta` (clamped to `[thresholdFloor, thresholdCeiling]`)
6. Detect anomalies using precision-weighted signals against adaptive threshold
7. Produce `MonitorReport` compatible with v1 consumers (anomalies, escalation, restrictedActions, forceReplan)

#### 2. PriorityAttend — Three-Factor Biased Competition

The v1 workspace uses `defaultSalienceFunction` with hand-tuned weights: `0.4*recency + 0.3*source + 0.3*goal`. Following Desimone & Duncan (1995), Awh, Belopolsky & Theeuwes (2012), and Bisley & Goldberg (2010), PriorityAttend replaces this with three-factor biased competition.

**Three independent factors:**

1. **Stimulus salience (bottom-up):** Novelty, magnitude of change, surprise value. Entries that are new, large, or unexpected score higher. Computed from entry age, content length relative to mean, and whether the entry's content differs from recent entries.

2. **Goal relevance (top-down):** Match to active plan, subgoals, and task objectives. Computed from keyword overlap with active goals (as in v1) plus structural matching against the planner's current subgoal decomposition.

3. **Selection history (learned bias):** Items previously attended that led to successful actions receive a boost. Items attended but followed by failures are suppressed. This implements the empirically validated "selection history" effect that is independent of both stimulus salience and current goals.

**Winner suppression (lateral inhibition):** After ATTEND selects the top-N entries, losing entries' salience is reduced by a configurable factor. This prevents attention oscillation — the same low-priority entry doesn't keep re-entering competition cycle after cycle.

```typescript
/** Three-factor priority score for a workspace entry. */
interface PriorityScore {
  /** Bottom-up: novelty, magnitude, surprise. Range [0, 1]. */
  stimulusSalience: number;
  /** Top-down: match to active plan/subgoals. Range [0, 1]. */
  goalRelevance: number;
  /** Learned bias: items previously attended that led to progress. Range [-1, 1]. */
  selectionHistory: number;
  /** Composite priority: weighted sum. */
  composite: number;
}

/** Selection outcome tracking for history-based biasing. */
interface SelectionOutcome {
  /** Hash of the workspace entry that was attended. */
  entryHash: string;
  /** Whether attending this entry led to a successful action. */
  outcome: 'positive' | 'negative' | 'neutral';
  /** When the outcome was recorded. */
  timestamp: number;
}

/** Configuration for PriorityAttend. */
interface PriorityAttendConfig {
  /** Weight for stimulus salience factor. Default: 0.3. */
  stimulusWeight?: number;
  /** Weight for goal relevance factor. Default: 0.4. */
  goalWeight?: number;
  /** Weight for selection history factor. Default: 0.3. */
  historyWeight?: number;
  /** Suppression factor applied to losing entries after selection. Default: 0.2. */
  suppressionFactor?: number;
  /** Maximum selection history entries to retain. Default: 100. */
  maxHistoryEntries?: number;
}
```

PriorityAttend can be delivered either as a new `SalienceFunction` plugged into the existing workspace engine, or as a wrapper module that replaces the ATTEND phase. The `SalienceFunction` approach is preferred because it requires no changes to the workspace engine — only a different function passed to `createWorkspace()`.

**Implementation approach:**

1. Implement `prioritySalienceFunction` matching the `SalienceFunction` signature `(entry: WorkspaceEntry, context: SalienceContext) => number`
2. Extend `SalienceContext` with optional `selectionOutcomes: SelectionOutcome[]` and `activeSubgoals: string[]`
3. After each ACT phase, tag attended entries with outcome via workspace state update
4. Apply winner suppression: after `attend()` returns top-N, reduce non-selected entries' salience by `suppressionFactor`

#### 3. ReasonerActorV2 — Impasse Detection + Auto-Subgoaling

The v1 ReasonerActor detects stagnation through action entropy and consecutive read-only cycles. ReasonerActorV2 adds SOAR-style impasse detection (Laird, Newell, Rosenbloom 1987) that identifies four distinct impasse types and generates targeted subgoals to resolve each one.

**Impasse taxonomy:**

| Impasse Type | Detection Rule | Auto-Generated Subgoal |
|-------------|---------------|----------------------|
| **Tie** | LLM produces 2+ equally-scored action candidates in `<action>` block, or explicit hedging language | "Compare approaches X and Y explicitly. Which is more likely to succeed given the current state?" |
| **No-change** | LLM repeats the same action as the previous cycle (workspace entry matches) | "Previous approach didn't make progress. List 3 alternative approaches and select the most promising." |
| **Rejection** | Tool execution fails AND no alternative action proposed in the response | "Tool {name} failed with: {error}. What other tools or approaches could achieve the same goal?" |
| **Stall** | Action entropy drops below threshold — same actions repeating across multiple cycles | "Step back. Restate the problem from scratch. What assumptions am I making that might be wrong?" |

```typescript
/** Impasse type taxonomy following SOAR (Laird, Newell, Rosenbloom 1987). */
type ImpasseType = 'tie' | 'no-change' | 'rejection' | 'stall';

/** Signal emitted when an impasse is detected. */
interface ImpasseSignal {
  /** Which type of impasse was detected. */
  type: ImpasseType;
  /** The tied candidates (for 'tie' impasses). */
  candidates?: string[];
  /** How many cycles the agent has been stuck (for 'stall' impasses). */
  stuckCycles?: number;
  /** The failed tool name (for 'rejection' impasses). */
  failedTool?: string;
  /** The auto-generated subgoal to resolve this impasse. */
  autoSubgoal: string;
}

/** Extended monitoring signal for ReasonerActorV2. */
interface ReasonerActorV2Monitoring extends ReasonerActorMonitoring {
  /** Impasse signal, present only when an impasse is detected. */
  impasse?: ImpasseSignal;
}

/** Configuration for ReasonerActorV2. */
interface ReasonerActorV2Config extends ReasonerActorConfig {
  /** Action entropy threshold below which a stall impasse is detected. Default: 0.3. */
  stallEntropyThreshold?: number;
  /** Number of repeated actions before no-change impasse fires. Default: 2. */
  noChangeThreshold?: number;
  /** Whether to inject auto-subgoals into the workspace. Default: true. */
  injectSubgoals?: boolean;
  /** Salience of injected subgoal entries. Default: 0.9 (high priority). */
  subgoalSalience?: number;
}
```

**Step behavior (extending v1):**

1. Execute the standard ReasonerActor step (LLM invocation, action parsing, tool execution)
2. After obtaining the result, check for impasse conditions:
   - **Tie:** Parse the `<action>` block for multiple tool specifications or hedging patterns
   - **No-change:** Compare `actionName` with `state.lastActionName` and tool input with previous input
   - **Rejection:** Check `toolResult.isError && !alternativeActionProposed`
   - **Stall:** Compute action entropy from `state.recentActions`; if below `stallEntropyThreshold`, flag stall
3. If impasse detected:
   a. Generate subgoal string from impasse type template
   b. Inject subgoal into workspace as high-salience entry (if `injectSubgoals` is true)
   c. Include `ImpasseSignal` in the monitoring output
4. MonitorV2 reads the impasse signal and can escalate or adjust control accordingly

The key SOAR insight preserved here: the subgoal is **generated from the impasse type**, not pre-programmed. Each impasse type implies a specific resolution strategy.

#### 4. PrecisionAdapter — Effort Allocation

The v1 ProviderAdapter uses `effort: 'low' | 'medium' | 'high'` as string prefixes. PrecisionAdapter wraps the existing `ProviderAdapter` with a continuous precision parameter following Da Costa et al. (2024) and Shenhav's EVC framework (2013).

**Core mapping:** Precision is a scalar in [0, 1] that determines how carefully the LLM should process its input. Higher precision means more computational resources allocated.

```typescript
/** Precision-based configuration for LLM invocations. */
interface PrecisionConfig {
  /** Token budget — higher precision = more tokens allowed. */
  maxOutputTokens: number;
  /** Temperature — higher precision = lower temperature (more deterministic). */
  temperature: number;
  /** System prompt depth — higher precision = more detailed instructions. */
  promptDepth: 'minimal' | 'standard' | 'thorough';
}

/** Configuration for the PrecisionAdapter factory. */
interface PrecisionAdapterConfig {
  /** Minimum token budget (at precision = 0). Default: 1024. */
  minTokens?: number;
  /** Maximum token budget (at precision = 1). Default: 8192. */
  maxTokens?: number;
  /** Temperature at precision = 0. Default: 1.0. */
  maxTemperature?: number;
  /** Temperature at precision = 1. Default: 0.3. */
  minTemperature?: number;
  /** Prompt depth thresholds: [minimal->standard, standard->thorough]. Default: [0.3, 0.7]. */
  depthThresholds?: [number, number];
}

/**
 * Map a precision value in [0, 1] to concrete LLM configuration.
 *
 * precision = 0 → fast, cheap, approximate (low tokens, high temperature, minimal prompt)
 * precision = 1 → slow, expensive, thorough (high tokens, low temperature, thorough prompt)
 *
 * Driven by MonitorV2's prediction error: high error → high precision.
 * Reference: Da Costa et al. (2024), Shenhav EVC (2013).
 */
function precisionToConfig(precision: number, config?: PrecisionAdapterConfig): PrecisionConfig {
  const minTokens = config?.minTokens ?? 1024;
  const maxTokens = config?.maxTokens ?? 8192;
  const maxTemp = config?.maxTemperature ?? 1.0;
  const minTemp = config?.minTemperature ?? 0.3;
  const [dLow, dHigh] = config?.depthThresholds ?? [0.3, 0.7];

  return {
    maxOutputTokens: Math.round(minTokens + precision * (maxTokens - minTokens)),
    temperature: maxTemp - precision * (maxTemp - minTemp),
    promptDepth: precision < dLow ? 'minimal' : precision < dHigh ? 'standard' : 'thorough',
  };
}
```

**Integration with MonitorV2:** The precision value for each cycle is derived from the Monitor's prediction error magnitude. High prediction error (something unexpected happened) drives precision up (reason more carefully). Low prediction error (routine cycle) drives precision down (execute quickly). This closes the loop: monitoring quality directly controls resource allocation.

PrecisionAdapter wraps the existing `ProviderAdapter` interface — it intercepts `invoke()`, maps precision to `AdapterConfig` adjustments (token budget via pact template, temperature via pact template), and delegates to the underlying adapter. No changes to the `ProviderAdapter` interface itself.

#### 5. EVC-Based Control Gating

The v1 cycle uses `ThresholdPolicy` to decide when MONITOR/CONTROL phases fire. The field-based variant compares signal fields against fixed values. The EVC policy replaces this with a cost-benefit calculation following Shenhav, Botvinick & Cohen (2013).

**EVC equation:** `intervene when E[payoff] - E[cost] > 0`

- **Expected payoff:** Estimated improvement from deploying control. Computed from prediction error magnitude — larger errors suggest more room for improvement.
- **Expected cost:** Estimated token expenditure for the intervention. Computed from remaining cycle budget — if the budget is nearly exhausted, intervention cost is high relative to remaining value.

```typescript
/** Configuration for EVC-based threshold policy. */
interface EVCConfig {
  /** Weight for prediction error in payoff estimation. Default: 1.0. */
  payoffWeight?: number;
  /** Weight for remaining budget in cost estimation. Default: 1.0. */
  costWeight?: number;
  /** Minimum prediction error to consider intervention. Default: 0.1. */
  minPredictionError?: number;
  /** Bias term — positive values favor intervention, negative values favor skipping. Default: 0.0. */
  bias?: number;
}

/**
 * Create an EVC-based ThresholdPolicy.
 *
 * Returns a predicate-type ThresholdPolicy compatible with CycleConfig.
 * The policy estimates expected value of control from prediction error magnitude
 * and remaining budget, intervening only when expected payoff exceeds expected cost.
 *
 * Reference: Shenhav, Botvinick, Cohen (2013) — Expected Value of Control.
 */
function evcThresholdPolicy(config?: EVCConfig): ThresholdPolicy {
  // Returns: { type: 'predicate', shouldIntervene: (signals) => boolean }
  // Implementation reads enriched signals for prediction error and budget remaining
}
```

**Compatibility Matrix:**

| Composition | EVC Behavior |
|-------------|-------------|
| MonitorV2 + EVC | Full EVC: uses predictionError magnitude for payoff estimation |
| MonitorV1 + EVC | Degraded: uses `proxyPE = 1 - confidence` as prediction error proxy, falls back to threshold-like behavior |
| MonitorV2 + ThresholdPolicy | Standard v1 threshold behavior (enriched signals ignored) |
| MonitorV1 + ThresholdPolicy | Unchanged v1 behavior |

When enriched signals are absent (v1 Monitor composition), the EVC policy computes `proxyPE = 1 - confidence` from the base MonitoringSignal and uses this as the prediction error input. This ensures EVC remains functional — though less precise — in mixed v1/v2 compositions.

This is a new `ThresholdPolicy` — it slots into the existing `CycleConfig.thresholds` field. No changes to the cycle orchestrator are required.

## Alternatives Considered

### Alternative 1: Modify v1 modules in-place

Update `monitor.ts` and `reasoner-actor.ts` directly with the new mechanisms.

**Pros:** Simpler, no new files, no versioning complexity.
**Cons:** Breaks existing compositions that depend on v1 behavior. No A/B comparison possible. Violates backward compatibility guarantee from PRD 030.
**Why rejected:** The cognitive composition thesis is still under validation. v1 and v2 must coexist so that EXP-series experiments can compare them on identical tasks. In-place modification eliminates the control condition.

### Alternative 2: New algebra types for v2 signals

Define new `MonitoringSignalV2` and `ControlDirectiveV2` base types that break the `CognitiveModule` contract.

**Pros:** Cleaner type separation, v2 signals not constrained by v1 shape.
**Cons:** Defeats the plug-and-play principle. v2 modules would not compose with v1 modules. The composition operators would need new overloads. The cycle orchestrator would need conditionals.
**Why rejected:** The value of PRD 030's architecture is composability. Breaking the module contract for richer signals is the wrong trade-off. Instead, v2 signals EXTEND the base types — `EnrichedMonitoringSignal extends MonitoringSignal`. Consumers that only need v1 fields see v1 fields. Consumers that understand v2 check for enriched fields.

### Alternative 3: Implement only MonitorV2, defer the rest

Deliver MonitorV2 alone since it addresses the most critical deficiency (no prediction-error tracking, no metacognitive taxonomy).

**Pros:** Smaller scope, faster delivery, lower risk.
**Cons:** MonitorV2 without PrecisionAdapter has no lever to act on prediction errors (it can detect anomalies but not adjust effort). Without EVC policy, it still fires against fixed thresholds. Without impasse detection, stuck agents remain stuck even with better monitoring. The modules are designed as an integrated system.
**Why rejected:** The neuroscience research is clear that monitoring, control, and effort allocation form a coupled feedback loop. Delivering one without the others produces a half-circuit — detection without response.

## Scope

### In-Scope

- MonitorV2 module with prediction-error tracking, metacognitive taxonomy, precision weighting, adaptive thresholds
- EnrichedMonitoringSignal type extending MonitoringSignal
- PriorityAttend salience function with three-factor scoring and selection history tracking
- ReasonerActorV2 module with four-type impasse detection and auto-subgoal generation
- PrecisionAdapter wrapping ProviderAdapter with continuous precision parameter
- EVC-based ThresholdPolicy for control gating
- `enrichedPreset` composing all v2 modules
- Tests for all new modules (15+ scenarios per module)
- Testkit extensions: assertions for prediction error, impasse detection, precision levels

### Out-of-Scope

- Affect module (PRD 037) — uses enriched monitoring signals but is a separate concern
- Memory changes (dual-store CLS architecture) — separate PRD
- Cycle v2 (10-phase with APPRAISE, EVALUATE reordering) — separate PRD
- Theory of Mind module — speculative, no validated mechanism for LLM agents
- Curiosity module — depends on prediction-error infrastructure delivered here, but separate PRD
- Changes to the cycle orchestrator — all v2 modules work with the existing 8-phase cycle

### Non-Goals

- Replacing v1 modules — they remain available and are the default
- Achieving human-level metacognition — this implements validated computational mechanisms, not biological fidelity
- Optimizing for production performance — this is research infrastructure; profiling follows validation
- Modifying the CognitiveModule contract — v2 modules must be drop-in replacements

## Implementation Phases

### Phase 1: EnrichedMonitoringSignal + MonitorV2

The foundation — prediction error and metacognitive taxonomy.

Files:
- `packages/pacta/src/cognitive/algebra/enriched-signals.ts` — new — EnrichedMonitoringSignal type, MetacognitiveJudgment types, ModuleExpectation type
- `packages/pacta/src/cognitive/modules/monitor-v2.ts` — new — createMonitorV2() factory, MonitorV2Config, MonitorV2State
- `packages/pacta/src/cognitive/algebra/index.ts` — modified — export enriched signal types

Tests:
- `packages/pacta/src/cognitive/modules/__tests__/monitor-v2.test.ts` — new — 15 scenarios
  1. MonitorV2 produces EnrichedMonitoringSignal with prediction error field
  2. Prediction error computed as normalized deviation from expectation model
  3. Expectation model updates incrementally via exponential moving average
  4. Precision weights amplify signals from reliable modules
  5. Precision weights damp signals from noisy modules (high variance)
  6. Adaptive threshold lowers after intervention cycle (Gratton effect)
  7. Adaptive threshold raises after clean cycle (Gratton effect)
  8. Threshold clamped to [thresholdFloor, thresholdCeiling]
  9. EOL signal populated when workspace complexity is high
  10. JOL signal derived from evaluator progress
  11. FOK signal set on partial memory retrieval
  12. RC signal computed from action success rate + prediction error
  13. Conflict energy computed from co-activated incompatible responses
  14. MonitorV2 produces v1-compatible MonitorReport (anomalies, escalation)
  15. MonitorV2 implements CognitiveModule interface — assignable to v1 Monitor slot

Checkpoint: `npm run build` passes. MonitorV2 is type-compatible with v1 Monitor slot.

### Phase 2: PriorityAttend + PrecisionAdapter

Attention and effort allocation.

Files:
- `packages/pacta/src/cognitive/modules/priority-attend.ts` — new — prioritySalienceFunction, PriorityAttendConfig, PriorityScore, SelectionOutcome tracking
- `packages/pacta/src/cognitive/algebra/precision-adapter.ts` — new — createPrecisionAdapter() factory, PrecisionConfig, precisionToConfig()
- `packages/pacta/src/cognitive/algebra/workspace-types.ts` — modified — extend SalienceContext with optional selectionOutcomes and activeSubgoals fields

Tests:
- `packages/pacta/src/cognitive/modules/__tests__/priority-attend.test.ts` — new — 10 scenarios
  1. Priority score computed from all three factors (stimulus, goal, history)
  2. Stimulus salience increases for novel entries
  3. Goal relevance increases for entries matching active subgoals
  4. Selection history boosts entries that led to successful actions
  5. Selection history suppresses entries that led to failures
  6. Winner suppression reduces salience of non-selected entries
  7. Default weights (0.3, 0.4, 0.3) produce balanced scoring
  8. Custom weights respected
  9. Selection history bounded to maxHistoryEntries
  10. prioritySalienceFunction matches SalienceFunction signature
- `packages/pacta/src/cognitive/algebra/__tests__/precision-adapter.test.ts` — new — 6 scenarios
  1. precisionToConfig maps 0.0 to minimal config (low tokens, high temp, minimal prompt)
  2. precisionToConfig maps 1.0 to thorough config (high tokens, low temp, thorough prompt)
  3. precisionToConfig maps 0.5 to standard config
  4. PrecisionAdapter wraps ProviderAdapter — invoke() delegates correctly
  5. PrecisionAdapter adjusts pact template based on precision value
  6. Custom PrecisionAdapterConfig overrides defaults

Checkpoint: `npm run build` passes. PriorityAttend produces valid SalienceFunction. PrecisionAdapter wraps ProviderAdapter.

### Phase 3: ReasonerActorV2 + EVC Control

Impasse detection and cost-benefit control gating.

Files:
- `packages/pacta/src/cognitive/modules/reasoner-actor-v2.ts` — new — createReasonerActorV2() factory, impasse detection, auto-subgoal generation
- `packages/pacta/src/cognitive/engine/evc-policy.ts` — new — evcThresholdPolicy() factory, EVCConfig

Tests:
- `packages/pacta/src/cognitive/modules/__tests__/reasoner-actor-v2.test.ts` — new — 12 scenarios
  1. Tie impasse detected when LLM hedges between alternatives
  2. Tie impasse generates comparison subgoal
  3. No-change impasse detected when action repeats from previous cycle
  4. No-change impasse generates alternative-listing subgoal
  5. Rejection impasse detected on tool failure with no alternative
  6. Rejection impasse generates tool-alternative subgoal
  7. Stall impasse detected when action entropy drops below threshold
  8. Stall impasse generates problem-restatement subgoal
  9. Auto-subgoal injected into workspace with high salience
  10. ImpasseSignal included in ReasonerActorV2Monitoring
  11. Non-impasse cycles produce standard ReasonerActorMonitoring (no impasse field)
  12. ReasonerActorV2 implements CognitiveModule interface — assignable to v1 ReasonerActor slot
- `packages/pacta/src/cognitive/engine/__tests__/evc-policy.test.ts` — new — 6 scenarios
  1. EVC policy returns shouldIntervene = true when prediction error exceeds cost
  2. EVC policy returns shouldIntervene = false when cost exceeds payoff
  3. EVC policy returns shouldIntervene = false when prediction error below minimum
  4. EVC policy respects bias term (positive bias favors intervention)
  5. EVC policy reads enriched signals when available
  6. EVC policy falls back to v1 signal fields when enriched signals absent

Checkpoint: `npm run build` passes. ReasonerActorV2 detects all four impasse types. EVC policy is a valid ThresholdPolicy.

### Phase 4: Presets + Integration

Compose everything and verify end-to-end.

Files:
- `packages/pacta/src/cognitive/presets/enriched.ts` — new — enrichedPreset composing all v2 modules with sensible defaults
- `packages/pacta/src/cognitive/presets/index.ts` — new — preset barrel
- `packages/pacta/src/cognitive/index.ts` — modified — export v2 modules and presets
- `packages/pacta/src/index.ts` — modified — add v2 exports

Tests:
- `packages/pacta/src/cognitive/presets/__tests__/enriched.test.ts` — new — 6 scenarios
  1. enrichedPreset creates a valid CognitiveAgent configuration
  2. enrichedPreset uses MonitorV2, ReasonerActorV2, PriorityAttend, PrecisionAdapter, EVC policy
  3. enrichedPreset agent runs a complete cycle without error
  4. A/B test: v1 preset and enrichedPreset produce compatible outputs on same input
  5. v2 modules are individually replaceable (mix v1 monitor with v2 reasoner-actor)
  6. enrichedPreset respects custom overrides for any module config

Dependencies: Phases 1-3.

Checkpoint: `npm run build` passes. `npm test` passes across all packages. enrichedPreset produces working cognitive agent.

## Acceptance Criteria

### AC-01: MonitorV2 emits prediction errors when module behavior deviates from expectation

**Given** a MonitorV2 with an established expectation model (5+ cycles of stable confidence ~0.8)
**When** a Reasoner signal arrives with confidence 0.2 (3+ standard deviations from expected)
**Then** the MonitorV2 output includes `predictionError > 0` in the EnrichedMonitoringSignal and the anomaly report includes a prediction-error anomaly
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/monitor-v2.test.ts` scenario 2
**Automatable:** yes

### AC-02: MonitorV2 produces distinct metacognitive signals (EOL, JOL, FOK, RC)

**Given** a MonitorV2 receiving aggregated signals from multiple modules
**When** the signals include a memory retrieval with partial match (relevanceScore > 0, retrievalCount = 0)
**Then** the EnrichedMonitoringSignal includes `fok: true`, and other metacognitive fields (eol, jol, rc) are populated based on their respective signal sources
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/monitor-v2.test.ts` scenarios 9-12
**Automatable:** yes

### AC-03: Precision weighting amplifies reliable signals and damps noisy ones

**Given** two modules: ModuleA (historically stable, variance 0.01) and ModuleB (historically noisy, variance 0.5)
**When** both emit anomaly signals of equal magnitude
**Then** ModuleA's signal receives higher precision weight than ModuleB's, and MonitorV2's anomaly decision is dominated by ModuleA's signal
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/monitor-v2.test.ts` scenarios 4-5
**Automatable:** yes

### AC-04: Adaptive thresholds lower after intervention, raise after clean cycle

**Given** a MonitorV2 with `baseConfidenceThreshold: 0.3` and `grattonDelta: 0.05`
**When** cycle N triggers an intervention, followed by cycle N+1 with no anomalies
**Then** the adaptive threshold at the start of cycle N+1 is 0.25 (lowered) and at the start of cycle N+2 is 0.30 (raised back), clamped to `[thresholdFloor, thresholdCeiling]`
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/monitor-v2.test.ts` scenarios 6-8
**Automatable:** yes

### AC-05: PriorityAttend ranks entries by stimulus salience + goal relevance + selection history

**Given** three workspace entries: EntryA (novel, goal-irrelevant, no history), EntryB (old, goal-relevant, positive history), EntryC (old, goal-irrelevant, negative history)
**When** PriorityAttend computes priority scores with default weights (0.3, 0.4, 0.3)
**Then** EntryB ranks highest (strong goal + positive history), EntryA ranks second (strong stimulus), EntryC ranks lowest (negative history drags score down)
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/priority-attend.test.ts` scenario 1
**Automatable:** yes

### AC-06: Selection history boosts entries that previously led to successful actions

**Given** a workspace with EntryX that was attended in cycle 3 and led to a successful tool execution
**When** PriorityAttend computes scores in cycle 4
**Then** EntryX's `selectionHistory` component is positive, increasing its composite priority above what stimulus salience and goal relevance alone would produce
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/priority-attend.test.ts` scenario 4
**Automatable:** yes

### AC-07: ReasonerActorV2 detects tie impasse and generates comparison subgoal

**Given** a ReasonerActorV2 receiving an LLM response with hedging language or multiple candidate actions in the `<action>` block
**When** the step completes
**Then** the monitoring output includes `impasse: { type: 'tie', candidates: [...], autoSubgoal: '...' }` and the subgoal is injected into the workspace with salience >= 0.9
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/reasoner-actor-v2.test.ts` scenarios 1-2
**Automatable:** yes

### AC-08: ReasonerActorV2 detects no-change impasse and generates alternative-listing subgoal

**Given** a ReasonerActorV2 whose previous cycle executed action "Read" on file "foo.ts"
**When** the current cycle also executes action "Read" on file "foo.ts" (same action and input)
**Then** the monitoring output includes `impasse: { type: 'no-change', autoSubgoal: '...' }` instructing the agent to list alternative approaches
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/reasoner-actor-v2.test.ts` scenarios 3-4
**Automatable:** yes

### AC-09: PrecisionAdapter maps precision 0.0 to minimal config and 1.0 to thorough config

**Given** a PrecisionAdapter with default configuration
**When** `precisionToConfig(0.0)` is called
**Then** the result has `maxOutputTokens: 1024`, `temperature: 1.0`, `promptDepth: 'minimal'`
**And when** `precisionToConfig(1.0)` is called
**Then** the result has `maxOutputTokens: 8192`, `temperature: 0.3`, `promptDepth: 'thorough'`
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/precision-adapter.test.ts` scenarios 1-2
**Automatable:** yes

### AC-10: EVC policy skips intervention when cost exceeds expected payoff

**Given** an EVC policy with default configuration and a cycle budget that is 90% exhausted
**When** aggregated signals show a moderate prediction error (0.3)
**Then** the EVC policy returns `shouldIntervene: false` because the remaining budget makes intervention cost exceed expected improvement
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/evc-policy.test.ts` scenario 2
**Automatable:** yes

### AC-11: v2 modules are drop-in replacements for v1 (same CognitiveModule interface)

**Given** a cognitive agent configuration using v1 Monitor and v1 ReasonerActor
**When** the v1 Monitor is replaced with MonitorV2 and the v1 ReasonerActor with ReasonerActorV2
**Then** `createCognitiveAgent()` accepts the configuration without errors, and the agent runs a complete cycle producing valid output
**Test location:** `packages/pacta/src/cognitive/presets/__tests__/enriched.test.ts` scenario 5
**Automatable:** yes

### AC-12: enrichedPreset composes all v2 modules into a working cognitive agent

**Given** a RecordingProvider and a ToolProvider with standard tools
**When** `enrichedPreset` is used to create a cognitive agent
**Then** the agent uses MonitorV2, ReasonerActorV2, PriorityAttend salience, PrecisionAdapter, and EVC policy, and successfully completes a multi-cycle task
**Test location:** `packages/pacta/src/cognitive/presets/__tests__/enriched.test.ts` scenario 2
**Automatable:** yes

## Success Metrics

| Metric | Target | Method | Baseline |
|--------|--------|--------|----------|
| Monitor false positive rate | <15% | Test battery with known-good cycles (no anomaly expected). Count cycles where MonitorV2 raises a false alarm. | v1: ~30% estimated (fixed thresholds trigger on normal variance) |
| Impasse detection accuracy | >90% | Test battery with known impasse scenarios (tie, no-change, rejection, stall). Count correctly identified impasses. | v1: 0% (no impasse detection capability) |
| Stuck-agent recovery rate | >70% | Comparison test: run v1 and v2 agents on tasks designed to induce stuck states. Measure percentage that recover. | v1: 0% (no auto-recovery mechanism) |
| Module step overhead | <50ms per step excluding LLM calls | Benchmark MonitorV2 step with 10 module signals. Measure wall-clock excluding provider invocation. | v1: ~10ms (simpler logic) |
| API compatibility | 100% | Type check: v2 modules assignable to v1 slots without casts. `tsc --noEmit` with explicit slot assignment. | N/A (new requirement) |
| Prediction error calibration | Normalized PE within [0, 3] for 95% of cycles | Run v2 agent on diverse task battery. Histogram prediction errors. Values > 3 suggest model drift. | N/A (no prediction errors in v1) |

## Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| Expectation model cold-start: MonitorV2 has no expectation model for the first N cycles, producing unreliable prediction errors | Medium | High | False anomalies on early cycles until model stabilizes | Use a warm-up period (configurable, default: 3 cycles) where prediction errors are suppressed. Expectation model initialized with generous confidence range [0.1, 0.9] to avoid triggering on normal first-cycle variance. |
| Precision weighting over-damps legitimate signals from historically noisy modules | High | Medium | Real anomalies from variable modules get ignored | Set a precision floor — no module's precision drops below 0.1 regardless of variance history. Add a "signal override" path: signals above an absolute magnitude threshold bypass precision gating. |
| Auto-subgoal injection floods workspace with high-salience entries | Medium | Medium | Legitimate workspace content evicted to make room for subgoals | Cap subgoal injection to 1 per cycle. Subgoal entries have a short TTL (3 cycles). Track subgoal count in state; suppress new subgoals if previous subgoal is still active and unresolved. |
| EVC policy under-intervenes when budget estimation is inaccurate | Medium | Medium | Agent continues with flawed strategy because cost estimate is too high | EVC policy includes a configurable bias term (default: 0.0) that can be tuned toward intervention. Minimum prediction error threshold ensures obviously wrong cycles always trigger intervention regardless of budget. |
| Three-factor salience introduces interaction effects that are hard to debug | Low | Medium | Priority scores behave unexpectedly when factors conflict | PriorityScore is a transparent struct with all three components visible. Testkit assertions expose individual factor contributions. Selection history has a bounded window and explicit decay. |
| v2 modules increase step latency enough to affect cycle timing | Medium | Low | Agent cycles take noticeably longer, eating into token budget | Benchmark each v2 module step against v1 baseline. Prediction error computation and impasse detection are O(1) per module signal — no algorithmic complexity concern. The overhead is constant per cycle, not per module count. |

## Dependencies & Cross-Domain Impact

### Depends On

- **PRD 030 (Pacta Cognitive Composition):** All v2 modules implement the `CognitiveModule` contract, use the workspace engine, and compose via the existing operators. PRD 030 must be implemented before v2 modules can be built.

### Enables

- **PRD 037 (Affect Module):** The Affect module uses `EnrichedMonitoringSignal` fields (prediction error, precision) to compute arousal, and uses MonitorV2's adaptive threshold to modulate its own sensitivity. Without enriched signals, the Affect module would need to duplicate monitoring logic.

### Blocks / Blocked By

Nothing. PRD 030 is implemented.

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `docs/arch/cognitive-monitoring-v2.md` | Create | Prediction error model, metacognitive taxonomy, Gratton effect adaptive thresholds, EVC control gating. Architecture-level explanation of the feedback loop: monitoring → precision → effort → action → monitoring. |
| `docs/guides/cognitive-module-catalog.md` | Create | Module catalog listing all v1 and v2 modules with configuration options, performance characteristics, and migration guide (v1 → v2). Includes decision matrix: "when to use v1 vs v2." |
| `docs/guides/cognitive-composition.md` | Update | Add section on v2 modules, enrichedPreset usage, and PrecisionAdapter configuration. |
| `docs/arch/pacta.md` | Update | Add v2 module layer to the cognitive architecture diagram. |

## Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | What is the right warm-up period for MonitorV2's expectation model? 3 cycles may be too few for modules with high natural variance. | Implementation agent | Phase 1 |
| OQ-2 | Should PriorityAttend's selection history persist across sessions (via workspace state serialization) or reset per session? | PO | Phase 2 |
| OQ-3 | How should the EVC policy estimate "expected payoff" when no enriched signals are available (mixed v1/v2 composition)? | Implementation agent | Phase 3 |

## Neuroscience References

### Metacognition

- Nelson, T.O. & Narens, L. (1990). "Metamemory: A Theoretical Framework and New Findings." *The Psychology of Learning and Motivation*, Vol. 26. — Object/meta-level architecture, monitoring taxonomy (EOL, JOL, FOK, RC), control responses.
- Flavell, J.H. (1979). "Metacognition and cognitive monitoring." *American Psychologist*, 34(10). — Foundational metacognition framework.
- Dunlosky, J. & Metcalfe, J. (2009). *Metacognition*. SAGE Publications. — Comprehensive review of metacognitive monitoring and control.
- Steyvers, M. & Peters, M.A.K. (2025). "Metacognition and Uncertainty Communication in Humans and LLMs." *Current Directions in Psychological Science*. — LLM metacognitive sensitivity comparable to humans; internal representations contain better uncertainty signals than verbal outputs.
- 2025 arXiv:2505.13763: "Language Models Are Capable of Metacognitive Monitoring and Control of Their Internal Activations." — LLMs monitor only a small subset of activations; external scaffolding adds genuine value.
- 2025 OpenReview: "Towards Understanding Metacognition in Large Reasoning Models." — LRMs fail to detect stuck states, switch strategies, or revise incorrect reasoning. Primary motivation for impasse detection.

### Predictive Processing

- Friston, K. (2009). "The free-energy principle: a rough guide to the brain?" *Trends in Cognitive Sciences*. — Prediction error as the fundamental monitoring signal.
- Friston, K. (2010). "The free-energy principle: a unified brain theory?" *Nature Reviews Neuroscience*. — Precision weighting as attention; prediction error minimization.
- Clark, A. (2013). "Whatever next? Predictive brains, situated agents, and the future of cognitive science." *Behavioral and Brain Sciences*. — Accessible synthesis of predictive processing for cognitive systems.
- Da Costa, L. et al. (2024). "The Many Roles of Precision in Action." *Entropy*, 26(9). — Precision IS attention IS effort. Formal grounding for PrecisionAdapter.

### Cognitive Control

- Botvinick, M.M., Braver, T.S., Barch, D.M., Carter, C.S., & Cohen, J.D. (2001). "Conflict monitoring and cognitive control." *Psychological Review*, 108(3). — ACC conflict detection, Gratton effect, conflict-control feedback loop.
- Botvinick, M.M., Cohen, J.D., & Carter, C.S. (2004). "Conflict monitoring and anterior cingulate cortex: an update." *Trends in Cognitive Sciences*, 8(12). — Updated conflict monitoring model.
- Shenhav, A., Botvinick, M.M., & Cohen, J.D. (2013). "The Expected Value of Control: An Integrative Theory of Anterior Cingulate Cortex Function." *Neuron*, 79(2). — EVC equation, cost-benefit control allocation, dACC as monitor and specifier.
- Shenhav, A. et al. (2017). "Toward a Rational and Mechanistic Account of Mental Effort." *Annual Review of Neuroscience*, 40. — Effort allocation as rational cost-benefit computation.

### Attention

- Desimone, R. & Duncan, J. (1995). "Neural mechanisms of selective visual attention." *Annual Review of Neuroscience*, 18. — Biased competition model: bottom-up salience + top-down goal relevance.
- Awh, E., Belopolsky, A.V., & Theeuwes, J. (2012). "Top-down versus bottom-up attentional control: a failed theoretical dichotomy." *Trends in Cognitive Sciences*. — Selection history as third independent attention factor.
- Bisley, J.W. & Goldberg, M.E. (2010). "Attention, intention, and priority in the parietal lobe." *Annual Review of Neuroscience*, 33. — Priority maps integrating salience, goals, and history.

### Impasse Detection

- Laird, J.E., Newell, A., & Rosenbloom, P.S. (1987). "SOAR: An Architecture for General Intelligence." *Artificial Intelligence*, 33(1). — Automatic impasse detection (tie, no-change, rejection), subgoal generation from impasse type.

### Validated Agent Architectures

- Webb, T., Mondal, S.S. et al. (2025). "The MAP architecture: Brain-inspired metacognitive planner." *Nature Communications*. — Monitor + Predictor + Evaluator validated on Tower of Hanoi (11% → 74% accuracy, 0% invalid moves vs 31% hallucination baseline).

## Validation Results (2026-03-29)

Four experiments (R-04 through R-07) validated the v2 modules delivered by this PRD. Results from overnight research session (6 waves, 12 agents).

### R-04: MonitorV2 — Metacognitive Error Detection

N=120 evaluations across 4 error types (E1-E4), conditions A (no monitor), B (v1), C (v2).

| Error Type | Baseline (A) | v1 Monitor (B) | v2 MonitorV2 (C) | v2 FPR |
|------------|-------------|----------------|-------------------|--------|
| E1 (contradiction) | 100% | 100% | 100% | 14.6% |
| E2 (action-mismatch) | 100% | 100% | 100% | 26.3% |
| E3 (confidence miscalibration) | 0% | 3.4% | **37.9%** | 21.8% |
| E4 (planning error) | 100% | 100% | 100% | 18.1% |

- **Key finding:** MonitorV2 is **11x better** than v1 on the only genuinely hard error type (E3). E1/E2/E4 leak explicit failure flags — any threshold detector catches them.
- **FPR tradeoff:** v2 mean FPR 20.2% vs v1 0%. Prediction-error tracking introduces false positives.
- **Gates:** G1 PASS, G2 FAIL (v2 FPR), G3 PASS.
- **Log:** `experiments/log/2026-03-29-exp-metacognitive-error-full.yaml`

### R-05: PriorityAttend — Workspace Efficiency (Strongest Result)

N=41 runs across 3 tasks, conditions A (unlimited), B (default-8), E (PriorityAttend-8).

| Metric | Unlimited (A) | Default-8 (B) | PriorityAttend-8 (E) |
|--------|--------------|----------------|---------------------|
| Success rate | 73% (11/15) | 73% (11/15) | **91% (10/11)** |
| Tokens (median) | 21,651 | 17,434 | **15,735** |
| Token savings vs A | — | 19.5% | **27.3%** |
| Eviction salience (mean) | — | 0.518 | **0.387** |
| Monitor interventions | 6.7 | 6.9 | **5.8** |

- **Key finding:** PriorityAttend three-factor salience (stimulus 0.3 + goal 0.4 + history 0.3) saves 27% tokens while achieving higher success. Evicts entries with 25% lower salience — discards less important information.
- **Gates:** G0 PASS, G1 PASS, G2 PARTIAL PASS (E saves 9.7% more than B; incomplete T3 data).
- **Log:** `experiments/log/2026-03-29-exp-workspace-efficiency-core.yaml`

### R-06: EVC Policy — Interventionist Cost

N=45 runs across 3 tasks, conditions A (no monitor), B (always-on), C (EVC interventionist).

| Metric | No-Monitor (A) | Always-On (B) | EVC Interventionist (C) |
|--------|---------------|----------------|------------------------|
| Success rate | **93%** (14/15) | **93%** (14/15) | 67% (10/15) |
| Cost multiplier vs A | 1.00x | **1.07x** | 1.42x |
| Interventions/cycle | 0 | 11.4 | 8.9 |

- **Key finding:** Always-on monitoring is essentially free (1.07x) because MonitorV2 is rule-based. EVC interventionist costs 1.42x and degrades success to 67%. Root cause: minPredictionError=0.1 is too sensitive, triggering on nearly every cycle. forceReplan directives on low-severity anomalies cause spiraling.
- **Gate:** PARTIAL — cost target met (<1.5x), quality target missed (67%/93% = 0.72 < 0.80).
- **Recommendation:** Increase minPredictionError to 0.25-0.3; separate anomaly severity levels; add warm-up period.
- **Log:** `experiments/log/2026-03-29-exp-interventionist-cost-core.yaml`

### R-07: Full Pattern Composition (Negative Result)

N=17 runs across 3 tasks, conditions A (baseline 8-module), E (all v2 patterns active).

| Metric | Baseline (A) | All Patterns (E) |
|--------|-------------|------------------|
| Success rate | **75%** (6/8) | 22% (2/9) |
| Tokens (mean) | 19,583 | 25,299 |
| Token ratio | 1.00x | 1.29x |

- **Key finding:** All patterns combined **degrades performance** from 75% to 22%. Root causes: context pollution (50-200 extra tokens/cycle per pattern), workspace saturation (pattern injections evict task-relevant content), and overhead without adaptation (affect/memory signals injected but not acted upon).
- **Gate:** FAIL. Selective activation required.
- **Log:** `experiments/log/2026-03-29-exp-advanced-patterns-core.yaml`

### Emerging Thesis

**Selective metacognition > maximal metacognition.** The cognitive architecture benefits from targeted module activation gated on task complexity, not always-on full instrumentation. Individual v2 modules provide clear value (MonitorV2 on subtle errors, PriorityAttend on token efficiency, always-on monitoring at near-zero cost). Combining all patterns simultaneously creates context pollution that degrades the core reasoning signal. The path forward is complexity-adaptive composition: simple tasks use minimal modules, hard tasks progressively activate v2 capabilities.
