---
type: prd
title: "PRD 045: Goal-State Monitoring"
date: "2026-04-03"
status: draft
tier: heavyweight
depends_on: [30, 44]
enables: []
blocked_by: []
complexity: high
domains: [algebra, modules/evaluator, engine/cycle, experiments]
surfaces: [GoalDiscrepancy, TerminateSignal, GoalRepresentation, CycleResult-extension]
rfc: "docs/rfcs/004-goal-state-monitoring.md"
---

# PRD 045: Goal-State Monitoring

## Problem

The cognitive architecture monitors for process anomalies (low confidence, stagnation,
conflict) but has no mechanism for detecting goal satisfaction. No module compares
current state to goal state. No signal type carries "the task is done." The cycle
exhausts all allocated cycles regardless of whether the task completed at cycle 3 or
never will complete.

Empirically: R-18 showed partitioned workspace regresses T02/T04 because the agent
loses goal context under partition pressure. R-16 showed the agent loops 30 cycles
on T06 without detecting it's stuck. All conditions waste cycles on T05 (trivially
solvable, burns all 15 cycles anyway).

The root cause is a compositional gap: the Evaluator estimates progress from signal
quality (`avg(confidence + success)`), not from goal-state comparison. It's measuring
vibrations instead of checking GPS.

## Constraints

- **Backward compatible.** Existing tests, experiment runners, and cognitive agent
  configurations must continue to work without modification. New behavior is opt-in
  via GoalRepresentation in Evaluator state.
- **No new LLM calls.** The goal-state evaluation must be rule-based (< 1ms). LLM-backed
  evaluation is a future SLM compilation target (RFC 002), not this PRD.
- **Algebra-compliant.** All new types must fit the existing `CognitiveModule.step(I, S, κ)`
  contract. No new step argument signatures.
- **FCA-compliant.** Changes to algebra types stay in `algebra/`. Module changes stay in
  `modules/`. Cycle changes stay in `engine/`. No cross-layer imports.

## Success Criteria

1. **Early termination on solved tasks.** T05 (dead-code-removal) terminates before
   MAX_CYCLES in ≥ 80% of runs. Measured: cycle number at TerminateSignal.
2. **Stuck detection.** T06 at 30 cycles emits `goal-unreachable` TerminateSignal before
   cycle 25 in ≥ 60% of runs. Measured: cycle number at signal.
3. **No regression.** T01-T05 pass rates under `partitioned-cognitive` condition with
   goal-state monitoring ≥ flat baseline (73% from R-15). Measured: pass rate comparison.
4. **False positive rate.** Premature `goal-satisfied` TerminateSignal on incomplete
   tasks < 15% across T01-T06 × N=3. Measured: TerminateSignal on failed runs.

## Scope

**In scope:**
- GoalDiscrepancy signal type in algebra
- TerminateSignal monitoring signal type in algebra
- GoalRepresentation type in algebra
- Evaluator module redesign (goal-state comparison in state, unconditional execution)
- CycleResult extension with `terminated` field
- Cycle orchestrator: unconditional EVALUATE phase, TerminateSignal propagation
- Rule-based discrepancy function (keyword overlap + constraint satisfaction + write activity)
- Satisficing dynamics (aspiration level adaptation)
- Experiment runner integration (break on TerminateSignal)
- R-20 experiment: validate on T01-T06

**Out of scope:**
- LLM-backed evaluation (future SLM target)
- Adaptive context selection (RFC 004 §4 — separate PRD once evaluation is validated)
- Observer goal extraction redesign (use existing constraint classifier for goal detection)
- System 1/2 compilation of the evaluator
- Formal F1-FTH embedding (acknowledged as open obligation in RFC 004)

## Domain Map

```
algebra/          ──→  modules/evaluator   (GoalDiscrepancy, GoalRepresentation, TerminateSignal)
                  ──→  engine/cycle        (CycleResult, TerminateSignal)
modules/evaluator ──→  engine/cycle        (unconditional phase wiring)
engine/cycle      ──→  experiments/        (CycleResult.terminated propagation)
```

All cross-domain interactions use existing patterns:
- `algebra/ → modules/`: types imported, implementations provided (existing pattern)
- `algebra/ → engine/`: types imported, cycle orchestrator consumes (existing pattern)
- `engine/ → experiments/`: CycleResult returned, experiment runner reads (existing pattern)

**No new ports needed.** All interactions follow existing import patterns within the
`@methodts/pacta` package. The surfaces are new *types* added to existing barrel exports,
not new *ports* between domains.

## Surfaces (Primary Deliverable)

### S-1: GoalDiscrepancy (algebra/module.ts)

```typescript
/** Goal-state discrepancy signal — Evaluator monitoring output. */
export interface GoalDiscrepancy extends MonitoringSignal {
  type: 'goal-discrepancy';
  /** Distance from goal state [0, 1]. 0 = satisfied. */
  discrepancy: number;
  /** Rate of discrepancy change per cycle. Positive = improving. */
  rate: number;
  /** Reliability of this estimate [0, 1]. */
  confidence: number;
  /** Whether discrepancy < aspiration level. */
  satisfied: boolean;
  /** Human-readable description of what was compared. */
  basis: string;
}
```

**Status:** New type. Joins `ModuleMonitoringSignal` union. Exported from `algebra/index.ts`.

### S-2: TerminateSignal (algebra/module.ts)

```typescript
/** Termination signal emitted by Evaluator in monitoring channel (μ). */
export interface TerminateSignal extends MonitoringSignal {
  type: 'terminate';
  reason: 'goal-satisfied' | 'goal-unreachable' | 'budget-exhausted';
  confidence: number;
  evidence: GoalDiscrepancy;
}
```

**Status:** New type. Read by cycle orchestrator from `CycleResult`. Exported from `algebra/index.ts`.

### S-3: GoalRepresentation (algebra/module.ts or new file)

```typescript
/** Persistent goal state — stored in Evaluator internal state (S). */
export interface GoalRepresentation {
  /** Natural language goal statement. */
  objective: string;
  /** Extracted prohibitions and requirements. */
  constraints: string[];
  /** Decomposed sub-objectives (optional, populated by Planner). */
  subgoals: SubGoal[];
  /** Satisficing threshold [0, 1]. Default 0.80. */
  aspiration: number;
}

export interface SubGoal {
  description: string;
  satisfied: boolean;
  evidence?: string;
}
```

**Status:** New type. Consumed by Evaluator as part of `EvaluatorState`. Exported from `algebra/index.ts`.

### S-4: CycleResult Extension (engine/cycle.ts)

```typescript
export interface CycleResult {
  output: unknown;
  traces: TraceRecord[];
  signals: AggregatedSignals;
  cycleNumber: number;
  phasesExecuted: string[];
  aborted?: { phase: string; reason: string };
  /** NEW — set when Evaluator emits TerminateSignal. */
  terminated?: TerminateSignal;
}
```

**Status:** Extension of existing type. Backward compatible (new optional field).

### Surface Summary

| Surface | Location | Type | Status |
|---------|----------|------|--------|
| GoalDiscrepancy | algebra/module.ts | New MonitoringSignal | freeze |
| TerminateSignal | algebra/module.ts | New MonitoringSignal | freeze |
| GoalRepresentation | algebra/goal-types.ts | New type | freeze |
| CycleResult.terminated | engine/cycle.ts | Optional field extension | freeze |

## Per-Domain Architecture

### Domain 1: algebra/ (L0 — pure types)

**Changes:**
- Add `GoalDiscrepancy`, `TerminateSignal` to `module.ts`
- Add both to `ModuleMonitoringSignal` union
- Create `goal-types.ts` with `GoalRepresentation`, `SubGoal`
- Add `discrepancy-function.ts` with pure rule-based discrepancy computation
- Export all from `index.ts`

**Layer:** L0 (pure types + pure functions, zero side effects)

**Tests:** Unit tests for discrepancy function in `algebra/__tests__/discrepancy.test.ts`

### Domain 2: modules/evaluator (L1 — module implementation)

**Changes:**
- Extend `EvaluatorState` with `goal?: GoalRepresentation`, `discrepancyHistory: GoalDiscrepancy[]`, `aspirationLevel: number`
- Extend `EvaluatorOutput` with `discrepancy?: GoalDiscrepancy`, `terminateSignal?: TerminateSignal`
- Modify `createEvaluator()`:
  - Accept optional `goalRepresentation` in config (injected into initial state)
  - When `state.goal` is defined: compute discrepancy via `algebra/discrepancy-function.ts`
  - When `state.goal` is undefined: fall back to existing signal-aggregation behavior
  - Compute satisficing dynamics (aspiration level adaptation)
  - Emit `TerminateSignal` when conditions met
- `EvaluatorMonitoring` extended: `discrepancy?: GoalDiscrepancy`

**Layer:** L1 (module implementation, imports from algebra/)

**Backward compatibility:** When `goal` is absent from state, behavior is identical to current. All existing tests pass unchanged.

**Tests:** `modules/__tests__/evaluator-goal.test.ts` — discrepancy computation, satisficing dynamics, TerminateSignal emission, fallback behavior.

### Domain 3: engine/cycle (L2 — orchestration)

**Changes:**
- Add `terminated?: TerminateSignal` to `CycleResult`
- Add `EVALUATE` to PHASES array (between MONITOR and CONTROL, or as unconditional phase)
- In `run()`: after all module steps, check Evaluator's monitoring output for `type === 'terminate'`. If present, set `result.terminated` and skip ACT/LEARN phases.
- `CycleConfig` gains optional `unconditionalEvaluate?: boolean` (default: false for backward compat, true when goal-state monitoring is enabled)

**Layer:** L2 (orchestration, imports from algebra/ and modules/)

**Backward compatibility:** `unconditionalEvaluate` defaults to false. Existing configurations unchanged.

**Tests:** `engine/__tests__/cycle-terminate.test.ts` — TerminateSignal propagation, phase skipping, backward compatibility.

### Domain 4: experiments/ (L4 — application)

**Changes:**
- `run-slm-cycle.ts`: Extract goal from task prompt at cycle 0, pass to Evaluator config
- All condition runners: check `cycleResult.terminated` and break loop
- Add `partitioned-cognitive-goal` condition: partitioned workspace + goal-state monitoring
- R-20 experiment design: T01-T06, N=3, compare `partitioned-cognitive-goal` vs `flat` vs `partitioned-cognitive`

**Layer:** L4 (application, imports from all lower layers)

## Phase Plan

### Wave 0: Surfaces (algebra types)

1. Add `GoalDiscrepancy`, `TerminateSignal` to `algebra/module.ts`
2. Add both to `ModuleMonitoringSignal` union
3. Create `algebra/goal-types.ts` with `GoalRepresentation`, `SubGoal`
4. Create `algebra/discrepancy-function.ts` (pure, rule-based)
5. Export all from `algebra/index.ts`
6. Add `terminated?: TerminateSignal` to `CycleResult` in `engine/cycle.ts`
7. Unit tests for discrepancy function

**Gate:** `npm run build` passes. New types exported. Discrepancy function tests green.

### Wave 1: Evaluator Redesign

1. Extend `EvaluatorState`, `EvaluatorOutput`, `EvaluatorMonitoring`
2. Modify `createEvaluator()` — goal-state comparison path + fallback
3. Satisficing dynamics implementation
4. TerminateSignal emission logic
5. Tests: discrepancy computation, satisficing, termination, fallback

**Gate:** All existing evaluator tests pass (backward compat). New goal-state tests green. `npm test` green.

### Wave 2: Cycle Integration

1. Add unconditional EVALUATE phase to cycle orchestrator
2. TerminateSignal propagation through CycleResult
3. Phase skipping (skip ACT/LEARN when terminated)
4. Tests: cycle-terminate tests

**Gate:** All existing cycle tests pass. TerminateSignal propagation tested. `npm test` green.

### Wave 3: Experiment Validation (R-20)

1. Goal extraction from task prompts in experiment runner
2. `partitioned-cognitive-goal` condition wiring
3. Run R-20: T01-T06 × N=3, three conditions
4. Log results, update AGENDA

**Gate:** Success criteria from this PRD met (early termination, stuck detection, no regression, false positive rate).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Keyword-overlap discrepancy too crude for T02 | High | Medium | Accept T02 as reasoning-bound (RFC 004 acknowledged). Measure false positive rate. SLM evaluator is the real fix (future). |
| Premature termination on partially-complete tasks | Medium | High | Satisficing floor 0.60, confidence gate 0.85 when aspiration lowered. Validation criterion: < 15% false positives. |
| Unconditional EVALUATE adds latency | Low | Low | Rule-based, < 1ms. No LLM call. Profile if concerned. |
| CycleResult extension breaks downstream consumers | Low | Medium | Optional field, backward compatible. Experiment runners updated in Wave 3. |
