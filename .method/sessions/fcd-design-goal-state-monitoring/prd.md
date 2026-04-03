---
session: fcd-design-goal-state-monitoring
status: complete
date: 2026-04-03
prd: docs/prds/045-goal-state-monitoring.md
rfc: docs/rfcs/004-goal-state-monitoring.md
---

# FCD Design Session: Goal-State Monitoring

## Summary

PRD 045 designed via FCD surface-first methodology. 4 surfaces defined and frozen
(GoalDiscrepancy, TerminateSignal, GoalRepresentation, CycleResult extension).
No new ports needed — all interactions follow existing algebra → module → engine
import patterns within @method/pacta.

## Surfaces Frozen

| Surface | Location | Type |
|---------|----------|------|
| GoalDiscrepancy | algebra/module.ts | MonitoringSignal extension |
| TerminateSignal | algebra/module.ts | MonitoringSignal extension |
| GoalRepresentation | algebra/goal-types.ts | New type file |
| CycleResult.terminated | engine/cycle.ts | Optional field extension |

## Phase Plan

- Wave 0: Algebra types + discrepancy function (surfaces)
- Wave 1: Evaluator redesign (goal-state comparison + fallback)
- Wave 2: Cycle integration (unconditional EVALUATE + TerminateSignal propagation)
- Wave 3: Experiment validation (R-20)

## Next Step

Invoke `/fcd-plan` to decompose into commissions, or `/fcd-commission` to begin Wave 0.
