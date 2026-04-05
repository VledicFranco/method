---
type: prd
title: "PRD 050: Meta-Cognitive Router — Task-Aware Architecture Selection"
date: "2026-04-05"
status: draft
tier: heavyweight
depends_on: [48, 44, 45]
enables: []
blocked_by: []
complexity: medium
domains: [algebra, modules/router, experiments/exp-slm]
surfaces: [RoutingDecision, TaskFeatures, RouterMonitoring, createRouter]
rfc: "docs/rfcs/006-anticipatory-monitoring.md"
---

# PRD 050: Meta-Cognitive Router — Task-Aware Architecture Selection

## Problem

R-28 (cognitive N=5: 37%) vs R-29 (flat N=5: 57%) revealed that the cognitive
architecture is **task-dependent**:

| Task | Flat N=5 | Cognitive N=5 | Delta |
|------|----------|---------------|-------|
| T01 circular-dep | 40% | 60% | **+20pp cognitive wins** |
| T02 bug-fix | 100% | 20% | **-80pp cognitive hurts** |
| T03 config-migration | 0% | 20% | **+20pp cognitive wins** |
| T04 api-versioning | 100% | 20% | **-80pp cognitive hurts** |
| T05 dead-code | 100% | 100% | tied |
| T06 multi-module | 0% | 0% | tied |

The cognitive architecture helps structural/multi-file tasks and hurts
straightforward tasks the base model handles natively. Running the full
cognitive stack unconditionally pays overhead that's actively
counter-productive 33% of the time.

Agents need a meta-cognitive routing layer that decides *before* execution
whether to engage the cognitive modules. This converts a task-dependent
architecture into a composite architecture that should exceed both pure
strategies.

## Constraints

- **Backward compatible.** `flat` and `unified-memory` conditions unchanged. Router is a new `meta-cognitive` condition.
- **Low routing cost.** Decision must be ≤ 1K tokens (5% of average task run).
- **Algebra-compliant.** Router is a `CognitiveModule` with standard contract.
- **FCA-compliant.** Router domain: `cognitive/modules/router.ts`. Types in algebra.
- **Graceful degradation.** LLM failures fall back to `flat` (safer/cheaper default).

## Success Criteria

1. **Classification accuracy ≥ 80%.** Router routes T01/T03 → `unified-memory`, T02/T04 → `flat`, T05/T06 → `flat`. Measured: per-task routing decisions vs empirical best-architecture from R-28/R-29.

2. **Composite pass rate ≥ 70%.** Meta-cognitive condition N=5 beats both flat (57%) and cognitive (37%) by selecting the right architecture per task. Measured: R-30 N=5 total pass rate.

3. **Routing overhead ≤ 5%.** Router tokens / total tokens < 0.05 averaged across tasks. Measured: R-30 token accounting.

## Scope

**In scope:**
- Pre-execution task assessment → single routing decision (no mid-execution re-routing)
- Binary routing (`flat` vs `unified-memory`) for v1
- LLM-based classification with structured XML output
- Rule-based feature extraction as fallback
- New `meta-cognitive` condition in experiment runner

**Out of scope:**
- Training a routing SLM (future, PRD 049-style pipeline)
- Dynamic mid-execution re-routing (start flat → escalate if stuck)
- Multi-agent collaboration routing
- Cross-model-tier routing (Haiku/Sonnet/Opus selection)
- Continuous scoring (P(cognitive helps)) — binary for v1

## Domain Map

```
experiments/exp-slm (runner)
  └── calls Router once at setup
      └── dispatches to runFlat() OR runUnifiedMemory()

cognitive/modules/router.ts (NEW)
  └── consumes: ProviderAdapter (frozen)
  └── produces: RoutingDecision

cognitive/algebra
  └── router-types.ts (NEW) — RoutingDecision, TaskFeatures
  └── module.ts — RouterMonitoring added to union
```

## Surfaces (Primary Deliverable)

### `RoutingDecision` (algebra/router-types.ts — frozen)

```typescript
export interface RoutingDecision {
  architecture: 'flat' | 'unified-memory';
  features: TaskFeatures;
  confidence: number;
  rationale: string;
  tokensUsed: number;
}
```

### `TaskFeatures` (algebra/router-types.ts — frozen)

```typescript
export interface TaskFeatures {
  isMultiFile: boolean;
  isStructural: boolean;
  hasImplicitConstraints: boolean;
  isSingleFileEdit: boolean;
  goalCount: number;
  estimatedDifficulty: 'trivial' | 'simple' | 'moderate' | 'complex';
}
```

### `RouterMonitoring` (algebra/module.ts extension — frozen)

```typescript
export interface RouterMonitoring extends MonitoringSignal {
  type: 'router';
  architectureSelected: 'flat' | 'unified-memory';
  confidence: number;
}
// Added to ModuleMonitoringSignal union
```

### Router CognitiveModule surfaces (modules/router.ts — frozen)

```typescript
export interface RouterInput {
  goal: GoalRepresentation;
  taskDescription: string;
}

export interface RouterOutput { decision: RoutingDecision }

export interface RouterState { lastDecision: RoutingDecision | null }

export interface RouterControl extends ControlDirective { forceReroute?: boolean }

export interface RouterConfig {
  id?: string;
  provider: ProviderAdapter;
  cognitiveThreshold?: number;
}

export function createRouter(config: RouterConfig):
  CognitiveModule<RouterInput, RouterOutput, RouterState, RouterMonitoring, RouterControl>;
```

## Per-Domain Architecture

### `cognitive/algebra/router-types.ts` (L1)

Pure types. No runtime behavior. Exported via `algebra/index.ts`.

### `cognitive/modules/router.ts` (L2)

```
createRouter()
  └── step(input, state, control)
      ├── extractFeatures(goal, taskDescription) → TaskFeatures
      │     — rule-based: count file paths, detect structural keywords,
      │       identify constraints from text patterns
      ├── classifyWithLLM(features, goal, provider) → {difficulty, confidence}
      │     — optional LLM call to refine difficulty estimate
      ├── decide(features) → 'flat' | 'unified-memory'
      │     — rule-based decision logic
      └── return RoutingDecision
```

**Decision rules (v1):**
- `isMultiFile && isStructural` → `unified-memory`
- `hasImplicitConstraints && estimatedDifficulty === 'complex'` → `unified-memory`
- `isSingleFileEdit` → `flat`
- `estimatedDifficulty === 'trivial'` → `flat`
- default → `flat` (cheaper, don't engage cognitive unless confident)

**Verification:** 10+ unit tests covering feature extraction, decision rules, LLM fallback, each task classification.

### `experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts` (L3)

New `meta-cognitive` condition:
1. Call `router.step()` with goal + task description at setup
2. Based on `decision.architecture`, dispatch to `runFlat()` or `runUnifiedMemory()`
3. Add `routingDecision` to `RunResult`
4. Log decision: `[router] T01 → unified-memory (conf=0.85, rationale: multi-file structural refactor)`

## Phase Plan

### Wave 0 — Surfaces (30 min)

- Create `algebra/router-types.ts` with all type definitions
- Extend `algebra/module.ts` with `RouterMonitoring`
- Update `algebra/index.ts` barrel exports
- **Gate:** Build passes, existing tests pass.

### Wave 1 — Router Module (2-3 hr)

- Implement `modules/router.ts` with feature extraction + LLM classification + decision logic
- Write 10+ unit tests
- **Gates:** All router tests pass; router correctly routes T01-T06 against empirical truth table.

### Wave 2 — Experiment Integration (1-2 hr)

- Add `meta-cognitive` condition to runner
- Dispatch logic based on routing decision
- **Gate:** Meta-cognitive condition runs all 6 tasks without errors.

### Wave 3 — R-30 Validation (30 min + experiment run)

- Run `--condition=meta-cognitive --task=all --runs=5 --max-cycles=15`
- Log R-30 results with per-task routing decisions
- **Gates:** SC-1, SC-2, SC-3 all met.

## Risks

- **Feature generalization:** TaskFeatures may not generalize beyond T01-T06. Mitigation: features designed as general signals (file count, structural hints) not task-specific heuristics.
- **LLM classification stability:** Structured XML output may be unreliable. Mitigation: rule-based fallback extracts features from goal description without LLM.
- **v1 is binary:** Real routing is probably continuous (P(cognitive helps)). v1 proves the mechanism; v2 can add scoring.
- **Router itself has overhead:** If decision LLM call is expensive, defeats purpose. Mitigation: use rule-based extraction first; only call LLM when rules are ambiguous.

## Relationship to Existing Work

- **R-28/R-29 (empirical):** Provides the truth table for router validation.
- **PRD 048 (Verification Loop):** Verifier is part of `unified-memory` architecture; router decides whether to engage it at all.
- **PRD 049 (KPI Checker SLM):** Same SLM compilation pipeline could train a router SLM in v2.
- **RFC 006 (Anticipatory Monitoring):** Router extends anticipatory monitoring one level up — "should we even engage the anticipatory monitoring system?"
