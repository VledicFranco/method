---
guide: 33
title: "Cognitive Affect & Curiosity"
domain: pacta
audience: [agent-operators, contributors]
summary: >-
  Affect module (emotional metacognition), curiosity module (learning progress), and composition presets.
prereqs: [26, 27, 32]
touches:
  - packages/pacta/src/cognitive/modules/affect-module.ts
  - packages/pacta/src/cognitive/modules/curiosity-module.ts
  - packages/pacta/src/cognitive/presets/affect-explore.ts
---

# Guide 33 — Cognitive Affect & Curiosity

Two cognitive modules that give agents metacognitive awareness: the **Affect** module computes emotional signals from behavioral patterns, and the **Curiosity** module tracks learning progress to decide explore vs exploit. Both are deterministic and rule-based (zero LLM calls).

This is PRD 037 — Cognitive Affect & Exploration.

## Affect Module

The Affect module computes emotional state from observable behavioral traces — not self-report. It produces a valence/arousal signal plus context-appropriate guidance text.

Grounded in: Damasio's somatic marker hypothesis, Schwarz's feelings-as-information theory.

### Affect Signal

Each cycle produces an `AffectSignal`:

| Field | Range | Meaning |
|-------|-------|---------|
| `valence` | -1 to +1 | Emotional polarity (negative to positive) |
| `arousal` | 0 to 1 | Activation level (calm to urgent) |
| `label` | enum | Discrete state: `confident`, `anxious`, `frustrated`, `curious`, `neutral` |

### Detection Rules

Labels are assigned by priority (first match wins):

| Label | Condition | Guidance |
|-------|-----------|----------|
| **frustrated** | Cycles since last write >= 3 AND unique actions <= 2 | "Step back and reconsider assumptions" |
| **anxious** | Confidence declining 3+ cycles AND no recent successes | "Verify current assumptions before proceeding" |
| **confident** | >= 3 of last 5 actions succeeded AND confidence stable/rising | "Continue with current approach" |
| **curious** | Novel info discovered AND action diversity > 2 | "Understand implications before acting" |
| **neutral** | No conditions matched | (no guidance) |

### Input

The module requires behavioral traces from recent cycles:

```typescript
interface AffectInput {
  recentActions: Array<{ name: string; success: boolean }>;  // last 5
  confidenceTrend: number[];     // last 5 confidence scores
  uniqueActionsInWindow: number; // action diversity
  cyclesSinceLastWrite: number;  // progress signal
  novelInfoDiscovered: boolean;  // novelty signal
}
```

### Usage

```typescript
import { createAffectModule } from '@methodts/pacta/cognitive/modules/affect-module.js';

const affectModule = createAffectModule({
  confidentSuccessThreshold: 3,      // min successes for confident (default: 3)
  frustratedWriteThreshold: 3,       // min cycles since write for frustrated (default: 3)
  frustratedDiversityThreshold: 2,   // max unique actions for frustrated (default: 2)
  anxiousDeclineCycles: 3,           // min declining cycles for anxious (default: 3)
});
```

The `computeAffect()` function is also exported as a standalone pure function for direct use without the module wrapper.

## Curiosity Module

The Curiosity module tracks prediction errors per domain, computes learning progress, and decides whether the agent should explore (try a new approach) or exploit (continue the current one).

Grounded in: Oudeyer, Kaplan & Hafner (2007) — intrinsic motivation via learning progress; Schmidhuber (2010) — formal theory of curiosity.

### Core Concepts

**Learning progress** is the derivative of prediction error. For each domain, the module splits the error window into older and recent halves and computes `LP = mean(recent) - mean(older)`:

- Positive LP: errors increasing — new complexity to learn (high curiosity)
- Negative LP: errors decreasing — converging (low curiosity)
- Near-zero LP: stagnation — trigger exploration

**Explore/exploit decision:**
- **Explore** when |LP| < noise floor (stagnating) AND exploration budget > 0
- **Exploit** when |LP| >= noise floor (meaningful progress) OR budget exhausted

### Configuration

```typescript
import { createCuriosityModule } from '@methodts/pacta/cognitive/modules/curiosity-module.js';

const curiosityModule = createCuriosityModule({
  windowSize: 10,            // prediction errors per domain (default: 10)
  noiseFloor: 0.05,          // LP below this = stagnation (default: 0.05)
  explorationBudgetMax: 5,   // max explore steps before forced exploit (default: 5)
  enabled: true,             // toggle (default: true)
});
```

### Input and Output

```typescript
// Input: prediction errors from the latest cycle
interface CuriosityInput {
  predictionErrors: Map<string, number>;  // domain -> error value
}

// Output: curiosity signal and decision
interface CuriosityOutput {
  signal: number;              // 0-1 curiosity intensity
  domain: string;              // most interesting domain
  mode: 'exploit' | 'explore'; // current decision
  explorationGoal?: string;    // suggested sub-goal when exploring
}
```

### Budget Enforcement

The exploration budget prevents infinite exploration. Each explore step decrements the budget by 1. When the budget hits 0, the module forces exploit mode regardless of learning progress. The budget is set at initialization and counts down over the agent's lifetime.

### Standalone Functions

All core computations are exported as pure functions:

```typescript
import {
  computeLearningProgress,
  decideMode,
  computeCuriositySignal,
  findMostCuriousDomain,
  generateExplorationGoal,
} from '@methodts/pacta/cognitive/modules/curiosity-module.js';
```

## Composition Presets

Three presets extend the enriched baseline (PRD 035 v2 modules) with affect and curiosity:

| Preset | Modules Added | Slot | Use Case |
|--------|--------------|------|----------|
| `affectivePreset` | Affect | evaluator | Emotional self-awareness, stuck-loop detection |
| `exploratoryPreset` | Curiosity | planner | Learning-driven exploration, stagnation detection |
| `fullPreset` | Affect + Curiosity | evaluator + planner | Complete metacognitive stack |

All presets preserve the enriched baseline core: MonitorV2, PriorityAttend, ReasonerActorV2, PrecisionAdapter, and EVC policy.

### Usage

```typescript
import { affectivePreset, exploratoryPreset, fullPreset } from '@methodts/pacta/cognitive/presets/affect-explore.js';

// Affective only — adds emotional metacognition
const config = affectivePreset(
  { adapter, tools, writePort },
  { affect: { frustratedWriteThreshold: 5 } },
);

// Exploratory only — adds curiosity-driven exploration
const config = exploratoryPreset(
  { adapter, tools, writePort },
  { curiosity: { explorationBudgetMax: 8 } },
);

// Full — both affect and curiosity
const config = fullPreset(
  { adapter, tools, writePort },
  {
    affect: { confidentSuccessThreshold: 4 },
    curiosity: { windowSize: 15 },
  },
);
```

### When to Use Each

- **affectivePreset** — when the agent tends to get stuck in loops or you want guidance injected based on behavioral patterns. Good for long-running debugging or implementation tasks.
- **exploratoryPreset** — when the agent needs to balance depth vs breadth. Good for research, investigation, or tasks where the right approach is not obvious upfront.
- **fullPreset** — when you want the complete metacognitive stack. The affect and curiosity signals complement each other: affect detects frustration, curiosity detects stagnation, and together they give the agent rich self-awareness.

### Custom Slot Overrides

All presets accept a `moduleOverrides` parameter that takes highest priority:

```typescript
const config = fullPreset(
  { adapter, tools, writePort },
  {},
  { evaluator: myCustomEvaluator },  // replaces affect in the evaluator slot
);
```

## Key Files

- `packages/pacta/src/cognitive/modules/affect-module.ts` — affect module implementation
- `packages/pacta/src/cognitive/modules/curiosity-module.ts` — curiosity module implementation
- `packages/pacta/src/cognitive/presets/affect-explore.ts` — composition presets
