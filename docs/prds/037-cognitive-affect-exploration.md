---
title: "PRD 037: Cognitive Affect & Exploration"
status: proposed
date: "2026-03-29"
tier: standard
depends_on: [30, 35]
enables: []
blocked_by: []
complexity: medium
domains_affected: [pacta, pacta-testkit]
---

# PRD 037: Cognitive Affect & Exploration

**Status:** Proposed
**Author:** PO + Lysica
**Date:** 2026-03-29
**Package:** `@method/pacta` (L3 -- library)
**Depends on:** PRD 030 (Pacta Cognitive Composition), PRD 035 (soft)
**Soft dependency on PRD 035:** Affect and Curiosity function with v1 Monitor (using confidence as proxy signals) but produce richer output with MonitorV2's enriched monitoring signals (prediction error, precision weighting).
**Research:** `tmp/20260328-cognitive-architecture-research.md`, `tmp/20260328-cognitive-module-proposals.md`
**Organization:** Vidtecci -- vida, ciencia y tecnologia

**Supersedes:** PRD 032 Phase 5 (P3 Emotional Metacognition). The `affect-module.ts` deliverable from PRD 032 is withdrawn in favor of the richer circumplex-based implementation specified here. PRD 032's simpler rule-based affect signal (discrete labels from behavioral patterns) is replaced by the continuous 2D valence/arousal model with somatic markers.

## Problem Statement

The cognitive architecture (PRD 030) delivers 8 modules spanning object-level processing (Observer, Memory, Reasoner, Actor) and meta-level monitoring (Monitor, Evaluator, Planner, Reflector). Two critical capabilities that neuroscience identifies as essential for adaptive behavior are absent:

1. **Affect/Emotion.** Damasio's somatic marker hypothesis (1994) demonstrates that patients with ventromedial prefrontal cortex damage -- whose reasoning is intact but whose emotional processing is impaired -- make catastrophically bad decisions under uncertainty (Iowa Gambling Task). Emotions bias processing *before* deliberation begins, narrowing the option space cheaply via learned situation-outcome associations ("gut feelings"). Without affect, the agent treats every situation with the same deliberative intensity: it wastes tokens on routine decisions and misses fast heuristic shortcuts. Russell's circumplex model (1980, 14,000+ citations) reduces all affective experience to two continuous dimensions -- valence and arousal -- making implementation tractable. Pattisapu et al. (2024) formalize this within active inference: valence = actual utility minus expected utility, arousal = entropy of posterior beliefs. These are directly computable from existing Evaluator and Monitor outputs.

2. **Curiosity/Exploration.** When standard approaches stall, agents have no principled mechanism for switching from exploitation to exploration. They either repeat the same failing strategy or escalate to the human. Oudeyer, Kaplan, and Hafner's (2007) learning progress model provides a validated curiosity signal: curiosity = rate of prediction error reduction, not absolute prediction error. This solves Schmidhuber's (1991) "noisy TV problem" -- pure surprise-seeking gets stuck on unlearnable noise, but learning progress correctly identifies domains where the agent's predictions are *improving*. Gottlieb et al. (2013) complement this with an information gain framework grounded in Bayesian surprise. Recent evidence (Gottlieb & Bhatt 2023, Nature Reviews Neuroscience) confirms that curiosity-driven states enhance hippocampal learning -- curiosity is a genuine cognitive enhancement mechanism, not exploration noise.

Both modules are **fully optional add-ons**. Agents work without them. They work better with them. No cycle changes are required -- both integrate through the existing workspace read/write port mechanism and compose via standard `sequential` or `parallel` operators.

## Objective

Deliver two new cognitive modules as optional add-ons that plug into any existing composition without modifying the cognitive cycle:

1. **Affect Module** -- Maintains a 2D affect state (valence + arousal) following Russell's circumplex model. Implements Damasio's somatic markers for fast decision biasing: learned associations between workspace content patterns and outcome valence that bias the Reasoner toward or away from approaches before deliberation.

2. **Curiosity Module** -- Tracks per-domain learning progress (Oudeyer 2007), computes information gain, and generates exploration sub-goals when exploitation stalls. Provides a principled explore/exploit decision based on whether the agent's predictions are improving, flat, or degrading.

Deliver three composition presets (`fullPreset`, `affectivePreset`, `exploratoryPreset`) and testkit extensions for affect/curiosity-aware testing.

## Architecture & Design

### Core Principle: Optional Composition, Zero Cycle Changes

Both modules execute as workspace-writing modules that influence other modules through workspace entries. No new phases are required. They hook into existing phases via the composition operators from PRD 030:

```typescript
// Without affect/curiosity (existing -- unchanged)
const agent = createCognitiveAgent({ modules: { ...baselinePreset } });

// With affect (optional add-on)
const agent = createCognitiveAgent({
  modules: { ...baselinePreset, affect: createAffectModule(config) }
});

// With curiosity (optional add-on)
const agent = createCognitiveAgent({
  modules: { ...baselinePreset, curiosity: createCuriosityModule(config) }
});

// With both (optional)
const agent = createCognitiveAgent({
  modules: {
    ...baselinePreset,
    affect: createAffectModule(config),
    curiosity: createCuriosityModule(config),
  }
});
```

**CycleModules Extension:** The existing `CycleModules` interface is a fixed 8-key struct. To support optional modules, it must be extended with optional keys:

```typescript
interface CycleModules {
  // ... existing 8 required keys ...

  // Optional extension modules (PRD 037)
  affect?: CognitiveModule<AffectInput, AffectOutput, AffectState, AffectMonitoring, AffectControl>;
  curiosity?: CognitiveModule<CuriosityInput, CuriosityOutput, CuriosityState, CuriosityMonitoring, CuriosityControl>;
}
```

The cycle engine invokes optional modules at their designated phase hooks when present (affect after OBSERVE, curiosity during CONTROL), and skips them when absent. This is a minimal engine change — two conditional invocations — that preserves full backward compatibility.

### Integration via Workspace (No Cycle Modification)

Both modules read from and write to the workspace through the same `WorkspaceReadPort` / `WorkspaceWritePort` interfaces that existing modules use. They influence other modules by writing typed workspace entries that downstream modules read during their normal execution:

- **Affect** writes entries like `SOMATIC_MARKER: avoid {approach}` or `CAUTION_NEEDED` or `ON_TRACK` -- the Reasoner, Planner, and Monitor read these as context during their own phases.
- **Curiosity** writes entries like `EXPLORE: {domain}` or `EXPLOITATION_STALL` -- the Planner reads these when generating sub-goals.

This is the same mechanism Observer uses to inject observations and Memory uses to inject retrieved knowledge. No new coupling patterns.

### Composition Patterns

Because both modules implement the standard `CognitiveModule` interface, they compose with existing operators:

```typescript
// Affect runs after Observer: appraises observation before ATTEND
const observeAndAppraise = sequential(observer, affect);

// Curiosity runs in parallel with Planner: curiosity goals compete with task goals
const planWithCuriosity = parallel(planner, curiosity, mergeGoals);

// Affect as hierarchical monitor over reasoner-actor
const affectiveReasoning = hierarchical(affect, reasonerActor);
```

The specific composition pattern is a consumer choice, not enforced by the modules themselves.

### Domain Placement

Both modules live in the existing `modules/` sub-domain of the cognitive domain:

```
packages/pacta/src/cognitive/
  modules/
    affect-module.ts        NEW -- Affect module
    curiosity-module.ts     NEW -- Curiosity module
    presets.ts              NEW -- fullPreset, affectivePreset, exploratoryPreset
  modules/__tests__/
    affect-module.test.ts   NEW
    curiosity-module.test.ts NEW
    presets.test.ts         NEW
```

**G-BOUNDARY compliance:** Both modules import only from `algebra/` (types, ports) -- never from `engine/` or other modules. They are leaf modules with no forbidden cross-domain dependencies.

## Modules to Deliver

### 1. Affect Module -- Valence/Arousal + Somatic Markers

Grounded in Damasio's somatic marker hypothesis (1994), Russell's circumplex model (1980), Pattisapu et al.'s active-inference formalization (2024), and Scherer's component process model (2001).

#### Type Definitions

```typescript
/**
 * 2D affect state following Russell's circumplex model.
 * Valence and arousal are the two continuous dimensions that capture
 * all affective experience (Russell 1980, 14,000+ citations).
 */
interface AffectState {
  /** Pleasant (+1) to unpleasant (-1). Computed as actual utility minus
   *  expected utility (Pattisapu et al. 2024). */
  valence: number;          // -1 to +1
  /** Activated (+1) to deactivated (0). Computed as entropy of belief
   *  state / confidence variance (Pattisapu et al. 2024). */
  arousal: number;          // 0 to 1
  /** Learned situation-outcome associations (Damasio 1994). */
  markers: SomaticMarker[];
  /** Maximum number of stored markers. Oldest/weakest evicted when full. Default: 50. */
  markerCapacity: number;
}

/**
 * A somatic marker: a learned association between a workspace content
 * pattern and an outcome valence. Implements Damasio's (1994) mechanism
 * where past emotional outcomes bias future decisions before deliberation.
 */
interface SomaticMarker {
  /** Hashed workspace content signature at the time of the outcome. */
  pattern: string;
  /** Outcome valence: positive (+1) or negative (-1). */
  valence: number;          // -1 to +1
  /** Association strength. Decays exponentially over time. */
  strength: number;         // 0 to 1
  /** When the marker was created or last reinforced. */
  timestamp: number;
  /** Number of times this marker has been accessed (for activation-based retrieval). */
  accessCount: number;
}

/**
 * Output of the Affect module per cycle step.
 */
interface AffectOutput {
  /** Current valence. */
  valence: number;
  /** Current arousal. */
  arousal: number;
  /** If a stored marker matches the current workspace pattern. */
  markerMatch?: SomaticMarker;
  /** Behavioral bias derived from marker match and current affect. */
  bias: 'approach' | 'avoid' | 'neutral';
  /** Modulation recommendations for other modules (written to workspace). */
  modulations: AffectModulation[];
}

/**
 * A modulation recommendation: how affect should influence a target module.
 * Written to workspace as typed entries that target modules can read.
 */
interface AffectModulation {
  /** Which module this modulation targets. */
  target: 'monitor' | 'planner' | 'reasoner' | 'reflector';
  /** Which parameter to modulate (e.g., 'sensitivity', 'riskTolerance', 'effort'). */
  parameter: string;
  /** Direction of modulation. */
  direction: 'increase' | 'decrease';
  /** Modulation magnitude (0-1). */
  magnitude: number;
}
```

#### Affect Configuration

```typescript
interface AffectConfig {
  /** Maximum number of somatic markers to store. Default: 50. */
  markerCapacity?: number;
  /** Marker strength decay rate (exponential). Default: 0.95 per cycle. */
  decayRate?: number;
  /** Minimum marker strength before eviction. Default: 0.1. */
  minMarkerStrength?: number;
  /** Threshold for marker match to trigger bias. Default: 0.5. */
  markerMatchThreshold?: number;
  /** Module ID override. Default: 'affect'. */
  id?: string;
}
```

#### Valence and Arousal Computation

Following Pattisapu et al. (2024) active-inference formalization:

- **Valence** = actual utility - expected utility. Computed from Evaluator's `estimatedProgress` (actual) vs Planner's predicted progress (expected). Positive valence means things are going better than expected; negative means worse.

- **Arousal** = entropy of belief state. Computed from Monitor precision signals or Reasoner confidence variance across recent cycles. High arousal means the agent is uncertain about what happens next; low arousal means confident.

Both signals are already available in the workspace from existing module outputs -- the Affect module reads them, computes the 2D state, and writes modulation entries.

**Data flow:** Affect reads the PREVIOUS cycle's Evaluator and Planner workspace entries (lagged by one cycle). On cycle 0 or when these entries are absent (e.g., Evaluator/Planner did not fire due to default-interventionist gating), valence defaults to 0.0 (neutral) and arousal defaults to 0.5 (moderate uncertainty). This lagged design ensures Affect does not depend on modules that execute later in the same cycle.

#### Somatic Marker Mechanism (Damasio 1994)

The core decision-biasing mechanism, validated via the Iowa Gambling Task:

1. **After each cycle's ACT phase outcome:** Hash the current workspace content into a pattern signature. If the outcome was positive (valence > 0), store or strengthen a positive marker. If negative (valence < 0), store or strengthen a negative marker. Markers associate the *situation* (workspace pattern) with the *outcome* (valence).

2. **Before deliberation (next cycle):** Hash current workspace content and check against stored markers. This is the "gut feeling" check -- it runs before the Reasoner engages in full deliberation.

3. **If a strong negative marker matches:** Write `AVOID: {approach description}` to workspace as a high-salience entry. This biases the Reasoner away from approaches that failed before, *before* investing tokens in reasoning about them.

4. **If a strong positive marker matches:** Write `APPROACH: {approach description}` to workspace. This biases the Reasoner toward approaches that succeeded before.

5. **Marker decay:** All markers decay exponentially by recency (`strength *= decayRate` per cycle). Old associations fade. This prevents overfitting to early experiences and allows the agent to re-evaluate approaches that failed long ago.

6. **Capacity enforcement:** When the marker store is full (`markerCapacity` reached), the weakest marker (lowest `strength`) is evicted.

In this implementation, 'somatic' refers to the functional mechanism (fast pre-deliberative biasing via learned situation-outcome associations), not to bodily states. The computational analogue captures Damasio's key insight — that decision-making benefits from rapid, experience-based biasing before full deliberation — without requiring a biological body.

#### How Affect Modulates Other Modules (via Workspace Entries)

| Affect State | Workspace Entry Written | Target Module Effect |
|---|---|---|
| High arousal (> 0.7) | `HIGH_UNCERTAINTY` | Monitor increases sensitivity -- more vigilant anomaly detection |
| Negative valence (< -0.3) | `CAUTION_NEEDED` | Planner adopts conservative strategy -- lower risk tolerance |
| Strong negative marker match | `AVOID: {approach}` | Reasoner avoids similar approaches before deliberation |
| Strong positive marker match | `APPROACH: {approach}` | Reasoner favors similar approaches |
| Positive valence + low arousal | `ON_TRACK` | Reflector does shallow reflection -- things going well, don't over-analyze |
| Extreme negative valence (< -0.7) | `DISTRESS` | Planner triggers replan -- current approach is failing badly |

All modulation is advisory -- target modules read workspace entries as context, not as commands. If a target module is not present in the composition, the entries are simply ignored.

### 2. Curiosity Module -- Learning Progress + Information Gain

Grounded in Schmidhuber's prediction error curiosity (1991), Oudeyer, Kaplan, and Hafner's learning progress model (2007), Gottlieb et al.'s information gain framework (2013), and Gottlieb & Bhatt's (2023) evidence that curiosity enhances hippocampal learning.

#### Type Definitions

```typescript
/**
 * Curiosity module state: tracks prediction errors and learning progress
 * per domain, following Oudeyer et al. (2007).
 */
interface CuriosityState {
  /** Per-domain prediction error history. Each domain is a category of
   *  workspace content (e.g., 'tool-usage', 'code-generation', 'planning'). */
  predictionErrors: Map<string, number[]>;
  /** Per-domain learning progress: rate of error reduction. */
  learningProgress: Map<string, number>;
  /** Remaining exploration actions before forced return to exploitation.
   *  Prevents unbounded exploration. */
  explorationBudget: number;
  /** Total exploration actions taken across all cycles. */
  totalExplorations: number;
  /** Last observed exploit progress (for stall detection). */
  lastExploitProgress: number;
}

/**
 * Output of the Curiosity module per cycle step.
 */
interface CuriosityOutput {
  /** Curiosity signal strength (0-1). Higher = more curious. */
  signal: number;
  /** Domain with highest curiosity (most learning progress potential). */
  domain?: string;
  /** Generated exploration sub-goal, if mode is 'explore'. */
  explorationGoal?: string;
  /** Recommendation: continue current approach or explore. */
  mode: 'exploit' | 'explore';
}

/**
 * Configuration for the Curiosity module.
 */
interface CuriosityConfig {
  /** Maximum consecutive exploration cycles before forced return to exploit. Default: 3. */
  maxExplorationBudget?: number;
  /** Number of recent cycles to average over for learning progress computation. Default: 5. */
  learningProgressWindow?: number;
  /** Exploit progress below this triggers explore mode. Default: 0.1. */
  exploitStallThreshold?: number;
  /** Learning progress below this is treated as noise (noisy TV filter). Default: 0.02. */
  noiseFloor?: number;
  /** Module ID override. Default: 'curiosity'. */
  id?: string;
}
```

#### Learning Progress Computation (Oudeyer et al. 2007)

The core curiosity signal -- not absolute prediction error (Schmidhuber 1991), but the *rate of change* of prediction error. This solves the noisy TV problem: random processes generate high prediction error but zero learning progress.

```
learningProgress(domain) = mean(errors[t-n..t-1]) - mean(errors[t-2n..t-n])
```

- **Positive learning progress:** Predictions are improving in this domain. The agent is learning. Continue exploring.
- **Zero learning progress:** Nothing more to learn here. The domain is either mastered or unlearnable. Stop exploring.
- **Negative learning progress:** Predictions are getting worse. This might be noise (noisy TV). Do not explore.

Learning progress is computed per domain. Domains are categories extracted from workspace content: the type of task, the tools being used, the problem structure. This allows curiosity to be selective -- explore domains where learning is happening, ignore domains that are mastered or noisy.

#### Explore vs. Exploit Decision

A three-tier decision hierarchy:

1. **If Evaluator's `estimatedProgress` is rising:** Exploit. The current approach is working. Do not interrupt it with exploration. Curiosity signal is low.

2. **If progress is flat AND learning progress > noiseFloor in some domain:** Explore that domain. The agent is not making task progress, but there is a domain where its predictions are improving -- it has something to learn that might help. Generate an exploration sub-goal targeting that domain.

3. **If all progress is flat AND all learning progress below noiseFloor:** Escalate. The agent is genuinely stuck. This is not an exploration opportunity -- it is a failure mode. Emit a high-urgency curiosity signal but do *not* generate an exploration sub-goal. Let the Monitor/Control layer handle escalation.

#### Exploration Sub-Goal Generation

When the module decides to explore, it generates a sub-goal injected into the workspace as a high-salience entry. Sub-goal templates are selected by stall type:

| Stall Type | Sub-Goal Template |
|---|---|
| Tie (multiple approaches, none progressing) | "Compare approaches X and Y -- which has better expected outcome?" |
| Stall (same approach repeated, no progress) | "Step back. What information am I missing? List 3 things I could investigate." |
| Unknown domain (high prediction error, positive learning progress) | "Before proceeding, explore {domain} to reduce uncertainty." |
| Budget exhausted (forced return to exploit) | "Exploration budget spent. Apply best insight from exploration: {summary}." |

#### Relationship to PRD 035 Impasse Detection

When composed with ReasonerActorV2 (PRD 035), impasse sub-goals take priority over curiosity exploration sub-goals. The Curiosity module checks the workspace for existing impasse signals (from ReasonerActorV2) before generating its own sub-goals. If an impasse signal is present, Curiosity suppresses its sub-goal generation for that cycle — the impasse mechanism already handles the immediate recovery. Curiosity generates exploration goals only for cross-cycle domain-level stalls (declining learning progress over multiple cycles), not for within-cycle action impasses.

#### Exploration Budget

To prevent curiosity-driven exploration from consuming unbounded tokens, the module enforces an exploration budget: `maxExplorationBudget` consecutive explore cycles (default: 3). After the budget is exhausted, the module forces a return to exploit mode. The budget resets when the agent transitions back to exploit voluntarily (i.e., when exploitation starts making progress again).

## Composition Presets

Three new presets that compose optional modules with the existing baseline:

```typescript
/**
 * Full preset: all v2 modules + affect + curiosity.
 * Maximum cognitive capability. Higher token overhead.
 */
export const fullPreset = {
  ...enrichedPreset,
  affect: createAffectModule(),
  curiosity: createCuriosityModule(),
};

/**
 * Affective preset: baseline + affect module.
 * Adds somatic markers and valence/arousal modulation without curiosity.
 */
export const affectivePreset = {
  ...baselinePreset,
  affect: createAffectModule(),
};

/**
 * Exploratory preset: baseline + curiosity module.
 * Adds learning progress tracking and exploration sub-goals without affect.
 */
export const exploratoryPreset = {
  ...baselinePreset,
  curiosity: createCuriosityModule(),
};

// Maximal preset: all v2 modules from PRDs 035 + 036 + 037
export const maximalPreset = {
  ...enrichedPreset,          // PRD 035: MonitorV2, ReasonerActorV2, PriorityAttend, PrecisionAdapter
  ...memoryPreset.modules,    // PRD 036: MemoryV3, Consolidator
  affect: createAffectModule(),     // PRD 037
  curiosity: createCuriosityModule(), // PRD 037
};
```

The `maximalPreset` composes all modules from PRDs 035, 036, and 037 into a single cognitive agent configuration. It requires the shared `InMemoryDualStore` from PRD 036's `createMemoryPreset()` to be passed as the memory port.

**Phase mapping for full composition:**

| Phase | Module(s) | Notes |
|-------|-----------|-------|
| OBSERVE | Observer | Standard |
| APPRAISE | Affect (optional) | Reads previous cycle's evaluator/planner entries |
| ATTEND | PriorityAttend | Three-factor scoring with selection history |
| REMEMBER | MemoryV3 | ACT-R activation retrieval from dual store |
| REASON | ReasonerActorV2 | With impasse detection |
| MONITOR | MonitorV2 | Prediction error + metacognitive taxonomy |
| CONTROL | EVC policy + Curiosity (optional) | Curiosity defers to impasse signals |
| ACT | (via ReasonerActorV2) | Tool execution |
| EVALUATE | Evaluator | Progress assessment |
| LEARN | Consolidator | Online episode storage + shallow lessons |

When optional modules are absent, their phases are skipped — the cycle degrades gracefully to the 8-phase baseline.

## Alternatives Considered

### Alternative 1: Add affect as a new cycle phase (APPRAISE)

Insert an APPRAISE phase between OBSERVE and ATTEND, as proposed in the research document's LEARN Cycle v2 (Section C1).

**Pros:** Cleaner theoretical mapping to Scherer's appraisal process model. Guarantees affect runs before attention.
**Cons:** Requires modifying the cycle orchestrator (PRD 030), which is production infrastructure. Breaks the 8-phase contract. Forces all agents to pay the cost of an APPRAISE phase even if they don't use affect.
**Why rejected:** The workspace-mediated approach achieves the same functional outcome (affect biasing attention) without modifying the cycle. The composition operators already support `sequential(observer, affect)` for consumers who want pre-attention appraisal. Cycle modification can be reconsidered if validation experiments demonstrate that workspace-mediated integration is insufficient.

### Alternative 2: Full OCC emotion model (22 discrete emotions)

Implement the Ortony, Clore, and Collins (1988) model with 22 emotion types based on appraisal of events (desirability), agents (praiseworthiness), and objects (appealingness).

**Pros:** More expressive than 2D circumplex. Captures discrete emotional categories (anger, joy, fear, etc.) with distinct behavioral profiles.
**Cons:** 22 emotion types is over-engineered for an agent that has no phenomenological experience. Each emotion type would need distinct modulation logic. The mapping from workspace content to 22 appraisal dimensions is speculative for LLM agents.
**Why rejected:** Russell's 2D circumplex captures >80% of the variance in human affect ratings with just two dimensions. For a computational agent, valence and arousal are sufficient to generate the key behavioral modulations (approach/avoid, caution/confidence, vigilance/relaxation). If 2D proves insufficient, discrete categories can be added as a follow-up without changing the module interface.

### Alternative 3: Curiosity as a Monitor enhancement (not a separate module)

Embed learning progress tracking and explore/exploit decisions within the existing Monitor module.

**Pros:** No new module. Simpler system. Monitor already reads all signals.
**Cons:** Violates FCA's single-responsibility principle. Monitor already has a well-defined role (anomaly detection, metacognitive signaling). Adding curiosity would conflate "something is wrong" (Monitor) with "something is interesting" (Curiosity). These are distinct cognitive functions with different neural substrates (ACC for conflict monitoring vs. mesolimbic dopaminergic circuits for curiosity).
**Why rejected:** Separating curiosity preserves the Monitor's focused role and allows agents to opt into curiosity independently of monitoring. The modules can still be composed (`parallel(monitor, curiosity, merge)`) when both are desired.

## Scope

### In-Scope

- Affect module implementation (`affect-module.ts`): AffectState, valence/arousal computation, somatic marker store (CRUD + decay), workspace modulation writes
- Curiosity module implementation (`curiosity-module.ts`): CuriosityState, learning progress computation, explore/exploit decision, sub-goal generation, exploration budget enforcement
- All type definitions: AffectState, SomaticMarker, AffectOutput, AffectModulation, AffectConfig, CuriosityState, CuriosityOutput, CuriosityConfig
- Three composition presets: `fullPreset`, `affectivePreset`, `exploratoryPreset`
- Testkit extensions: `RecordingAffectModule`, `RecordingCuriosityModule`, `assertAffectModulation`, `assertExplorationTriggered`
- Unit tests for both modules (30+ scenarios total)
- Integration tests with existing modules via presets

### Out-of-Scope

- Phenomenological emotion modeling -- this is computational affect (utility signals), not simulated subjective experience
- Theory of Mind -- modeling other agents' or users' emotional states is a separate concern (see research document Section 9)
- CLARION-style drive/motivation system -- intrinsic drives (autonomy, competence, relatedness) are a higher-level concern that would build on top of affect and curiosity
- Creative/divergent thinking module -- exploratory thinking for novel generation is distinct from curiosity-driven information seeking
- Cycle phase modifications -- both modules integrate via workspace, not via new phases
- Bridge integration -- L3 library only, bridge promotion is a follow-up
- Validation experiments -- this PRD builds infrastructure; EXP-series validates it

### Non-Goals

- Simulating human emotional experience -- affect is a computational signal, not phenomenological
- Replacing deliberative reasoning with intuition -- somatic markers *bias* reasoning, they do not replace it
- Guaranteeing that affect improves agent performance -- this is a research hypothesis, not a promise. The modules are designed to be testable via A/B comparison
- Unbounded exploration -- the curiosity module explicitly budgets exploration to prevent token waste

## Implementation Phases

### Phase 1: Affect Module Core

Files:
- `packages/pacta/src/cognitive/modules/affect-module.ts` -- new -- AffectState, AffectOutput, AffectModulation, AffectConfig, valence/arousal computation, workspace modulation writes, createAffectModule() factory
- `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` -- new -- 12 scenarios

Tests:
1. createAffectModule returns valid CognitiveModule with correct id
2. Valence computed from outcome vs expectation (positive outcome = positive valence)
3. Valence computed from outcome vs expectation (negative outcome = negative valence)
4. Arousal computed from confidence variance (high variance = high arousal)
5. Arousal computed from confidence variance (low variance = low arousal)
6. High arousal writes `HIGH_UNCERTAINTY` entry to workspace
7. Negative valence writes `CAUTION_NEEDED` entry to workspace
8. Positive valence + low arousal writes `ON_TRACK` entry to workspace
9. Extreme negative valence writes `DISTRESS` entry to workspace
10. AffectOutput includes correct `bias` field based on affect state
11. State invariant: valence in [-1, 1], arousal in [0, 1], markers array bounded
12. Module step with no prior signals produces neutral affect (valence=0, arousal=0.5)

Checkpoint: `npm run build` passes. Affect module computes valence/arousal from workspace context and writes modulation entries.

### Phase 2: Somatic Marker Learning

Files:
- `packages/pacta/src/cognitive/modules/affect-module.ts` -- extend -- SomaticMarker type, marker store (add, match, decay), pattern hashing, approach/avoid bias generation
- `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` -- extend -- 8 additional scenarios

Tests:
13. Positive outcome stores/strengthens positive marker with workspace pattern hash
14. Negative outcome stores/strengthens negative marker with workspace pattern hash
15. Marker match: current workspace matches stored negative marker -> bias = 'avoid'
16. Marker match: current workspace matches stored positive marker -> bias = 'approach'
17. No marker match -> bias = 'neutral'
18. Marker decay: strength decreases by `decayRate` each cycle
19. Markers below `minMarkerStrength` are evicted
20. Marker capacity: when full, weakest marker is evicted on new store

Checkpoint: `npm run build` passes. Somatic markers are stored, matched, and decayed correctly. Approach/avoid biases are generated and written to workspace.

### Phase 3: Curiosity Module

Files:
- `packages/pacta/src/cognitive/modules/curiosity-module.ts` -- new -- CuriosityState, CuriosityOutput, CuriosityConfig, learning progress computation, explore/exploit decision, sub-goal generation, exploration budget, createCuriosityModule() factory
- `packages/pacta/src/cognitive/modules/__tests__/curiosity-module.test.ts` -- new -- 10 scenarios

Tests:
1. createCuriosityModule returns valid CognitiveModule with correct id
2. Learning progress computed correctly: positive when errors decreasing
3. Learning progress computed correctly: zero when errors stable
4. Learning progress computed correctly: negative when errors increasing
5. Explore mode triggered when exploit stalls AND learning progress > noiseFloor
6. Exploit mode maintained when estimatedProgress is rising
7. Escalation (no sub-goal) when all progress flat and below noiseFloor
8. Exploration sub-goal generated and written to workspace with high salience
9. Exploration budget enforced: forced return to exploit after maxExplorationBudget cycles
10. State invariant: explorationBudget >= 0, totalExplorations >= 0

Checkpoint: `npm run build` passes. Curiosity module tracks learning progress, makes explore/exploit decisions, generates sub-goals, and enforces budget.

### Phase 4: Presets + Integration

Files:
- `packages/pacta/src/cognitive/modules/presets.ts` -- new -- fullPreset, affectivePreset, exploratoryPreset
- `packages/pacta/src/cognitive/modules/__tests__/presets.test.ts` -- new -- 6 scenarios
- `packages/pacta/src/cognitive/modules/index.ts` -- modified -- export affect, curiosity, presets
- `packages/pacta-testkit/src/cognitive-builders.ts` -- modified -- add RecordingAffectModule, RecordingCuriosityModule
- `packages/pacta-testkit/src/cognitive-assertions.ts` -- modified -- add assertAffectModulation, assertExplorationTriggered
- `docs/guides/cognitive-affect-exploration.md` -- new -- usage guide for affect and curiosity modules

Tests:
1. fullPreset includes all baseline modules + affect + curiosity
2. affectivePreset includes baseline + affect, no curiosity
3. exploratoryPreset includes baseline + curiosity, no affect
4. Agent created with fullPreset composes and runs a cycle without error
5. Agent created without affect/curiosity (baselinePreset) is unaffected by new code
6. RecordingAffectModule and RecordingCuriosityModule capture step invocations

Checkpoint: `npm run build` passes. `npm test` passes across pacta and pacta-testkit. All presets compose correctly. Backward compatibility verified.

## Success Criteria

### Functional

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Valence accuracy | Valence correlates with outcome quality in test scenarios | affect-module.test.ts scenarios 2-3 |
| Arousal accuracy | Arousal correlates with confidence variance in test scenarios | affect-module.test.ts scenarios 4-5 |
| Somatic marker storage | Markers stored with correct pattern, valence, and strength | affect-module.test.ts scenarios 13-14 |
| Marker matching | Correct bias (approach/avoid/neutral) from marker lookup | affect-module.test.ts scenarios 15-17 |
| Marker decay | Old markers weaken, below-threshold markers evicted | affect-module.test.ts scenarios 18-19 |
| Learning progress | Correctly computed from prediction error history | curiosity-module.test.ts scenarios 2-4 |
| Explore/exploit decision | Correct mode selection based on progress + learning | curiosity-module.test.ts scenarios 5-7 |
| Budget enforcement | Forced return to exploit after budget exhaustion | curiosity-module.test.ts scenario 9 |

### Non-Functional

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Token overhead | < 10% overhead from affect/curiosity vs baseline | Benchmark: fullPreset vs baselinePreset on standard scenario |
| Backward compatibility | All existing pacta + pacta-testkit tests pass unchanged | `npm test` |
| G-BOUNDARY | affect-module.ts and curiosity-module.ts import only from algebra/ | gates.test.ts |
| Optional composition | Agent works identically with or without affect/curiosity modules | presets.test.ts scenario 5 |

### Experimental (Post-Implementation)

| Metric | Target | Method | Baseline |
|--------|--------|--------|----------|
| Decision quality under uncertainty | > 20% improvement on uncertain scenarios | A/B test: with/without affect | No affect baseline |
| Stuck-scenario recovery via exploration | > 50% of stall scenarios trigger exploration | Curiosity module test battery | 0% (no curiosity) |
| Token efficiency | < 10% overhead from affect/curiosity modules | Benchmark comparison | Baseline without modules |
| Somatic marker accuracy | > 70% of markers correctly predict outcome direction | Marker validation test | N/A (new) |

## Acceptance Criteria

### AC-01: Affect module computes valence from outcome vs expectation

**Given** an Affect module that has received Evaluator output (estimatedProgress = 0.8) and Planner prediction (expectedProgress = 0.5)
**When** the module's step() is called
**Then** valence is positive (actual > expected), and the output reflects this
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` scenario 2
**Automatable:** yes

### AC-02: Affect module computes arousal from belief entropy

**Given** an Affect module that has received Monitor signals with high confidence variance (some modules confident, others uncertain)
**When** the module's step() is called
**Then** arousal is high (reflecting uncertainty), and the output reflects this
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` scenario 4
**Automatable:** yes

### AC-03: Somatic marker stored after positive outcome

**Given** an Affect module processing an ACT phase outcome with positive valence
**When** the module updates its state
**Then** a new SomaticMarker is stored with the workspace content pattern hash, positive valence, and initial strength
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` scenario 13
**Automatable:** yes

### AC-04: Somatic marker stored after negative outcome

**Given** an Affect module processing an ACT phase outcome with negative valence
**When** the module updates its state
**Then** a new SomaticMarker is stored with the workspace content pattern hash, negative valence, and initial strength
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` scenario 14
**Automatable:** yes

### AC-05: Marker match triggers avoid bias

**Given** an Affect module with a stored negative marker (valence = -0.8, strength = 0.9) whose pattern matches the current workspace content
**When** the module's step() is called
**Then** output.bias is `'avoid'`, and a workspace entry `AVOID: {approach}` is written
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` scenario 15
**Automatable:** yes

### AC-06: Markers decay over time

**Given** an Affect module with stored markers of varying ages
**When** the module's step() is called
**Then** each marker's strength is multiplied by decayRate (default: 0.95), and markers below minMarkerStrength (default: 0.1) are evicted
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` scenario 18
**Automatable:** yes

### AC-07: Affect modulations written to workspace influence downstream modules

**Given** an Affect module that computes high arousal (> 0.7)
**When** the module's step() writes a `HIGH_UNCERTAINTY` entry to workspace
**Then** the entry is present in the workspace snapshot available to subsequent modules (Monitor, Planner)
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/affect-module.test.ts` scenario 6
**Automatable:** yes

### AC-08: Curiosity signal positive when exploit stalls but learning progress positive

**Given** a Curiosity module where Evaluator.estimatedProgress has been flat for 3 cycles AND learning progress in domain 'tool-usage' is 0.15 (above noiseFloor)
**When** the module's step() is called
**Then** output.signal > 0, output.mode is `'explore'`, output.domain is `'tool-usage'`
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/curiosity-module.test.ts` scenario 5
**Automatable:** yes

### AC-09: Curiosity mode is exploit when progress is rising

**Given** a Curiosity module where Evaluator.estimatedProgress has increased over the last 3 cycles
**When** the module's step() is called
**Then** output.mode is `'exploit'`, output.signal is low (< 0.2)
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/curiosity-module.test.ts` scenario 6
**Automatable:** yes

### AC-10: Exploration sub-goal generated and injected into workspace

**Given** a Curiosity module in explore mode for domain 'code-generation'
**When** the module's step() writes to workspace
**Then** a high-salience workspace entry containing the exploration sub-goal is written
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/curiosity-module.test.ts` scenario 8
**Automatable:** yes

### AC-11: Curiosity respects exploration budget

**Given** a Curiosity module with maxExplorationBudget = 3 that has explored for 3 consecutive cycles
**When** the module's step() is called
**Then** output.mode is `'exploit'` (forced), explorationBudget is 0
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/curiosity-module.test.ts` scenario 9
**Automatable:** yes

### AC-12: Both modules are fully optional

**Given** an agent created with `baselinePreset` (no affect, no curiosity)
**When** the agent runs a cognitive cycle
**Then** the cycle completes identically to the PRD 030 baseline -- no errors, no missing modules, no behavioral changes
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/presets.test.ts` scenario 5
**Automatable:** yes

### AC-13: fullPreset composes all modules into working agent

**Given** an agent created with `fullPreset` (baseline + affect + curiosity)
**When** the agent runs a cognitive cycle
**Then** all modules execute, affect writes modulation entries to workspace, curiosity provides explore/exploit recommendation, and the cycle completes without error
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/presets.test.ts` scenario 4
**Automatable:** yes

## Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| Simulated emotions may not transfer to LLM agents -- the circumplex model is validated for human phenomenology, not computational utility signals | High | Medium | Affect module adds overhead without improving decisions | Both modules are purely computational (utility signals, not phenomenological). Valence = utility delta. Arousal = entropy. These are well-defined mathematical quantities. A/B validation experiments will test whether they improve decisions. If not, the module is simply not composed into the agent. |
| Curiosity-driven exploration wastes tokens on unproductive tangents | Medium | Medium | Token budget consumed without task progress | Exploration budget (default: 3 cycles max) strictly limits consecutive exploration. The noiseFloor filter prevents exploration of unlearnable domains (noisy TV problem). Forced return to exploit after budget exhaustion. Budget is configurable per agent. |
| Somatic markers overfit to early experiences -- first few outcomes dominate future decisions | Medium | High | Agent avoids viable approaches because of one early failure | Three mitigations: (1) exponential decay weakens old markers (default rate 0.95/cycle); (2) marker capacity limit (default 50) evicts weakest markers; (3) strength threshold (0.1) prunes near-zero markers. These ensure the marker store reflects recent, strong associations -- not ossified early biases. |
| Workspace pollution -- affect and curiosity modules write too many entries, evicting task-relevant content | Medium | Medium | Critical workspace entries evicted by modulation entries | Per-module write quotas (from PRD 030) limit how many entries each module can write per cycle. Affect modulation entries use moderate salience -- they bias processing but don't dominate the workspace. Curiosity sub-goals use high salience only in explore mode. |
| Interaction effects between affect and curiosity produce unpredictable behavior | Low | Medium | Two modules writing competing workspace entries confuse the Reasoner | Affect and curiosity serve complementary functions: affect biases toward/away from known approaches, curiosity drives toward unknown domains. In the full preset, they naturally partition the behavioral space. Integration tests verify that combined composition produces coherent behavior. |
| Pattern hashing for somatic markers produces false matches -- different workspace states hash to same pattern | Low | Low | Wrong marker triggers bias, agent avoids a good approach or approaches a bad one | Use content-aware hashing (not just string hash) that captures workspace entry types, sources, and key content features. Marker match requires strength above threshold (default 0.5) to trigger bias -- weak matches are ignored. False match rate can be measured in validation experiments. |

## Dependencies & Cross-Domain Impact

### Depends On

- PRD 030: Pacta Cognitive Composition -- cognitive module type system, workspace ports, composition operators, cycle orchestrator
- PRD 035 (soft): Affect and Curiosity function with v1 Monitor but produce richer output with MonitorV2's enriched monitoring signals

### Enables

- Validation experiments comparing cognitive agents with/without affect and curiosity
- Full cognitive preset (baseline + all optional modules) for maximum capability
- Future PRDs for drive/motivation systems that build on affect signals

### Blocks / Blocked By

None. PRD 030 is implemented.

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `docs/guides/cognitive-affect-exploration.md` | Create | Usage guide: configuring affect/curiosity, composing with presets, tuning parameters |
| `docs/arch/cognitive-composition.md` | Update | Add affect and curiosity modules to the module catalog |
| `CLAUDE.md` | Update | Note optional modules in cognitive domain description |

## Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | What is the optimal marker decay rate for LLM agent sessions (typically 5-50 cycles)? | Validation experiment | Post-implementation |
| OQ-2 | Should curiosity domain categories be manually specified or automatically inferred from workspace content? | Implementation agent | Phase 3 |
| OQ-3 | Is the noiseFloor threshold (0.02) calibrated correctly, or does it need per-task tuning? | Validation experiment | Post-implementation |

## References

- Damasio, A.R. (1994). *Descartes' Error: Emotion, Reason, and the Human Brain*. Putnam.
- Damasio, A.R. (1996). "The somatic marker hypothesis and the possible functions of the prefrontal cortex." *Philosophical Transactions of the Royal Society B*, 351(1346).
- Russell, J.A. (1980). "A circumplex model of affect." *Journal of Personality and Social Psychology*, 39(6), 1161-1178.
- Scherer, K.R. (2001). "Appraisal Considered as a Process of Multilevel Sequential Checking." In *Appraisal Processes in Emotion: Theory, Methods, Research*. Oxford University Press.
- Ortony, A., Clore, G.L., & Collins, A. (1988). *The Cognitive Structure of Emotions*. Cambridge University Press.
- Pattisapu, V.K. et al. (2024). "Free Energy in a Circumplex Model of Emotion." *International Workshop on Active Inference (IWAI) 2024*.
- Schmidhuber, J. (1991). "Curious model-building control systems." *Proceedings of the International Joint Conference on Neural Networks*.
- Oudeyer, P.Y., Kaplan, F., & Hafner, V.V. (2007). "Intrinsic motivation systems for autonomous mental development." *IEEE Transactions on Evolutionary Computation*, 11(2), 265-286.
- Gottlieb, J., Oudeyer, P.Y., Lopes, M., & Baranes, A. (2013). "Information-seeking, curiosity, and attention: computational and neural mechanisms." *Trends in Cognitive Sciences*, 17(11), 585-593.
- Gottlieb, J. & Bhatt, M. (2023). "Curiosity: primate neural circuits for novelty and information seeking." *Nature Reviews Neuroscience*.
- ACL 2025. "Curiosity-Driven Reinforcement Learning from Human Feedback."

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Affect Module Core | pending | Valence/arousal computation, workspace modulation |
| Phase 2: Somatic Marker Learning | pending | Pattern hashing, marker store, approach/avoid bias |
| Phase 3: Curiosity Module | pending | Learning progress, explore/exploit, sub-goals, budget |
| Phase 4: Presets + Integration | pending | 3 presets, testkit extensions, integration tests, docs |
