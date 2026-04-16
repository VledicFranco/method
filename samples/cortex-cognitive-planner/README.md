# sample-cortex-cognitive-planner

PRD-068 Wave 1 Skeleton — the Planner cognitive module as a Cortex tenant app
(`category: agent`, Tier 2).

## What this sample demonstrates

- Composition via `createMethodAgent` with a `resumable` pact (PlannerPact).
- Joining the cortical workspace via `withCorticalWorkspaceMembership`.
- Reacting to `method.cortex.workspace.anomaly` events and emitting
  `plan_updated`, `goal`, and optionally `memory_query` to the shared
  cortical-workspace topic family (S10).
- Medium per-module fixed budget (0.35 USD ceiling) —
  Planner is the biggest reasoning cost in the cognitive cohort.

## Research gate

Full Planner cognitive behavior — goal decomposition, impasse-triggered
re-planning, ACT-R goal buffer semantics — is NOT wired in this Wave 1
scaffold. Gated on R-26c per PRD-068 §10 D4.

## Run the tests

```bash
npm --workspace=sample-cortex-cognitive-planner test
```
