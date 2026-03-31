# Realization Plan — PRD 044: Workspace Partition Architecture

## PRD Summary

**Objective:** Implement RFC 003 Phase 1 — split the monolithic workspace into typed partitions (Constraint, Operational, Task) with independent eviction policies, per-module context selection, entry routing, and per-partition deterministic monitors.

**Success Criteria:**
1. T06 pass rate >= 60% (from 0/3 at 30 cycles) — goal drift mitigated
2. T01-T05 pass rate >= 70% — no regression
3. Per-module context size measurably reduced — instrumented and reported

**Source PRD:** `.method/sessions/prd-design-044-workspace-partitions/prd.md`

## FCA Partition Map

```
Package: @method/pacta (packages/pacta/)

Cognitive sub-domains (packages/pacta/src/cognitive/):
  algebra/      L2  Pure types, composition operators, workspace engine
  modules/      L2  28 cognitive modules (observer, monitor, evaluator, etc.)
  engine/       L3  Cycle orchestrator, agent creation, flat adapter
  config/       L2  Persona templates (untouched)
  presets/      L2  Module bundles (untouched)
  partitions/   L2  NEW — partition implementations, router, monitors

Ports (packages/pacta/src/ports/):
  agent-provider.ts, tool-provider.ts, memory-port.ts,
  embedding-port.ts, attention-port.ts (all untouched)

Experiments (experiments/exp-slm/phase-5-cycle/):
  run-slm-cycle.ts  Experiment runner (Phase C-4 target)

Shared surfaces (orchestrator-owned — Wave 0):
  algebra/partition-types.ts        NEW — all 7 frozen surface definitions
  algebra/constraint-utils.ts       NEW — promoted from modules/constraint-classifier.ts
  algebra/index.ts                  MOD — re-export partition types + constraint utils
  modules/constraint-classifier.ts  MOD — backward compat re-export from algebra/
```

**Layer dependencies:** `engine/ (L3) → partitions/ (L2) → algebra/ (L2)`. Never reverse.

## Commission Summary

| Commission | Domain | Wave | Title | Depends On | Est. Tasks |
|------------|--------|------|-------|------------|-----------|
| — | algebra/, modules/ | 0 | Surface types + utility promotion | — | orchestrator |
| C-1 | partitions/ | 1 | Eviction policies + generic partition workspace | Wave 0 | 4 |
| C-2 | partitions/ | 2 | Partition system + router + monitors | C-1 | 8 |
| C-3 | engine/ | 3 | Cycle integration (partitioned path) | C-2 | 5 |
| C-4 | experiments/ | 4 | Experiment runner + T01-T06 validation | C-3 | 4 |

**Topology:** Linear chain. No parallelism (single-package refactoring where each layer builds on the previous).

```
Wave 0 (surfaces) → Wave 1 (C-1) → Wave 2 (C-2) → Wave 3 (C-3) → Wave 4 (C-4)
```

---

## Wave 0 — Shared Surfaces (Mandatory)

All types, interfaces, and utility promotions. Zero business logic.

### Port Interfaces

All 7 surfaces are frozen from the fcd-design session. Co-design record:
`.method/sessions/prd-design-044-workspace-partitions/prd.md` § Surfaces.

**New file: `packages/pacta/src/cognitive/algebra/partition-types.ts`**

Contains:
- `PartitionId` — `'constraint' | 'operational' | 'task'`
- `SelectStrategy` — `'all' | 'recency' | 'salience' | 'diversity'`
- `PartitionSelectOptions` — `{ types?, budget?, strategy? }`
- `EvictionPolicy` — `{ selectForEviction(entries): number | null }`
- `PartitionReadPort` — `{ id, select(options?), count(), snapshot() }`
- `ContextSelector` — `{ sources, types?, budget, strategy }`
- `PartitionSignalType` — `'constraint-violation' | 'stagnation' | 'goal-stale' | 'capacity-warning'`
- `PartitionSignal` — `{ severity, partition, type, detail }`
- `EntryRouter` — `{ route(content, source): PartitionId }`
- `PartitionMonitorContext` — `{ cycleNumber, lastWriteCycle, actorOutput? }`
- `PartitionMonitor` — `{ check(entries, context): PartitionSignal[] }`
- `PartitionSystem` — `{ getPartition, write, buildContext, checkPartitions, snapshot, resetCycleQuotas }`

### Utility Promotion

**New file: `packages/pacta/src/cognitive/algebra/constraint-utils.ts`**

Promote from `modules/constraint-classifier.ts`:
- `extractProhibitions(constraintContent: string): RegExp[]`
- `checkConstraintViolations(pinnedConstraints, actorOutput): ConstraintViolation[]`
- `ConstraintViolation` interface
- `CONSTRAINT_PATTERNS` constant (needed by both the router and the promoted functions)

These are pure functions with zero module dependencies — they belong in algebra/ (L2).

**Modified: `modules/constraint-classifier.ts`**

Add backward-compat re-exports:
```typescript
export { extractProhibitions, checkConstraintViolations, CONSTRAINT_PATTERNS } from '../algebra/constraint-utils.js';
export type { ConstraintViolation } from '../algebra/constraint-utils.js';
```

The `classifyEntry()` function and `ClassificationResult` type stay in `modules/constraint-classifier.ts` — they are module-level logic (classification is Observer behavior, not pure algebra).

### Barrel Export Updates

**Modified: `packages/pacta/src/cognitive/algebra/index.ts`**

Add section:
```typescript
// ── Partition types (PRD 044 — RFC 003 Phase 1) ────────────────
export type {
  PartitionId,
  SelectStrategy,
  PartitionSelectOptions,
  EvictionPolicy,
  PartitionReadPort,
  ContextSelector,
  PartitionSignalType,
  PartitionSignal,
  EntryRouter,
  PartitionMonitorContext,
  PartitionMonitor,
  PartitionSystem,
} from './partition-types.js';

// ── Constraint utilities (promoted from modules/) ──────────────
export { extractProhibitions, checkConstraintViolations, CONSTRAINT_PATTERNS } from './constraint-utils.js';
export type { ConstraintViolation } from './constraint-utils.js';
```

### Verification

After Wave 0:
- `npm run build` passes (TypeScript compiles)
- `npm test` passes (no behavior changes, only type additions + re-exports)
- All new types importable from `@method/pacta`

---

## Wave 1 — Eviction Policies + Generic Partition

### C-1: Eviction Policies + Generic Partition Workspace

Implements the foundational partition storage layer: three pluggable eviction policies and a generic partition workspace that parameterizes over them.

---

## Wave 2 — Partition System + Router + Monitors

### C-2: Partition System + Entry Router + Per-Partition Monitors

Wires three concrete partitions (Constraint, Operational, Task) into a PartitionSystem with entry routing and deterministic monitoring.

---

## Wave 3 — Cycle Integration

### C-3: Cycle Orchestrator Partitioned Path

Adds the opt-in partitioned context path to `engine/cycle.ts`. When `partitionSystem` is provided in config, each module receives typed context via `buildContext()` instead of `workspace.snapshot()`.

---

## Wave 4 — Experiment Validation

### C-4: Experiment Runner + T01-T06 Validation

Updates the SLM cognitive cycle experiment runner to use partitioned workspace. Runs T01-T06 to validate pass rates and measure per-module context reduction.

---

## Commission Cards

### C-1: Eviction Policies + Generic Partition Workspace

```yaml
id: C-1
phase: C-1
title: "Eviction policies + generic partition workspace"
domain: "cognitive/partitions"
wave: 1
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/partitions/eviction-policies.ts"
    - "packages/pacta/src/cognitive/partitions/partition-workspace.ts"
    - "packages/pacta/src/cognitive/partitions/__tests__/eviction-policies.test.ts"
    - "packages/pacta/src/cognitive/partitions/__tests__/partition-workspace.test.ts"
  forbidden_paths:
    - "packages/pacta/src/cognitive/algebra/**"
    - "packages/pacta/src/cognitive/engine/**"
    - "packages/pacta/src/cognitive/modules/**"
    - "packages/pacta/src/cognitive/index.ts"
    - "packages/pacta/src/ports/**"
    - "packages/pacta/package.json"
depends_on: ["Wave 0"]
parallel_with: []
consumed_ports:
  - name: "EvictionPolicy"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "PartitionReadPort"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "WorkspaceEntry"
    status: frozen
    source: "algebra/workspace-types.ts"
produced_ports: []
deliverables:
  - "partitions/eviction-policies.ts — NoEvictionPolicy, RecencyEvictionPolicy, GoalSalienceEvictionPolicy"
  - "partitions/partition-workspace.ts — PartitionWorkspace class (generic, parametric over EvictionPolicy)"
  - "partitions/__tests__/eviction-policies.test.ts"
  - "partitions/__tests__/partition-workspace.test.ts"
acceptance_criteria:
  - "AC-1: NoEvictionPolicy.selectForEviction() always returns null → PRD G-EVICTION-1"
  - "AC-2: NoEvictionPolicy safety valve evicts oldest when count >= maxEntries → PRD G-EVICTION-1"
  - "AC-3: RecencyEvictionPolicy evicts entry with oldest timestamp → PRD G-EVICTION-2"
  - "AC-4: GoalSalienceEvictionPolicy evicts 'strategy' entries before 'goal' entries → PRD G-EVICTION-3"
  - "AC-5: GoalSalienceEvictionPolicy preserves entries with contentType 'goal' → PRD G-EVICTION-3"
  - "AC-6: PartitionWorkspace.select() respects budget + strategy options → PRD G-PORT-1"
  - "AC-7: PartitionWorkspace implements PartitionReadPort interface → PRD G-PORT-1"
  - "AC-8: npm run build passes, npm test passes"
estimated_tasks: 4
branch: "feat/prd044-c1-eviction-policies"
status: pending
```

### C-2: Partition System + Entry Router + Per-Partition Monitors

```yaml
id: C-2
phase: C-2
title: "Partition system + entry router + per-partition monitors"
domain: "cognitive/partitions"
wave: 2
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/partitions/constraint/**"
    - "packages/pacta/src/cognitive/partitions/operational/**"
    - "packages/pacta/src/cognitive/partitions/task/**"
    - "packages/pacta/src/cognitive/partitions/entry-router.ts"
    - "packages/pacta/src/cognitive/partitions/partition-system.ts"
    - "packages/pacta/src/cognitive/partitions/index.ts"
    - "packages/pacta/src/cognitive/partitions/__tests__/partition-system.test.ts"
    - "packages/pacta/src/cognitive/partitions/__tests__/entry-router.test.ts"
    - "packages/pacta/src/cognitive/partitions/__tests__/monitors.test.ts"
  forbidden_paths:
    - "packages/pacta/src/cognitive/algebra/**"
    - "packages/pacta/src/cognitive/engine/**"
    - "packages/pacta/src/cognitive/modules/**"
    - "packages/pacta/src/cognitive/index.ts"
    - "packages/pacta/src/ports/**"
    - "packages/pacta/package.json"
depends_on: ["C-1"]
parallel_with: []
consumed_ports:
  - name: "PartitionSystem"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "EntryRouter"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "PartitionMonitor"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "PartitionSignal"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "PartitionReadPort"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "EvictionPolicy (implementations from C-1)"
    status: frozen
    source: "partitions/eviction-policies.ts"
  - name: "PartitionWorkspace (from C-1)"
    status: frozen
    source: "partitions/partition-workspace.ts"
  - name: "extractProhibitions, checkConstraintViolations"
    status: frozen
    source: "algebra/constraint-utils.ts"
  - name: "classifyEntry"
    status: frozen
    source: "modules/constraint-classifier.ts"
produced_ports:
  - name: "PartitionSystem (implementation)"
  - name: "EntryRouter (implementation)"
deliverables:
  - "partitions/constraint/config.ts — capacity: 10, NoEviction, accepted types"
  - "partitions/constraint/monitor.ts — post-Write violation check (promotes checkConstraintViolations)"
  - "partitions/operational/config.ts — capacity: 12, RecencyEviction, accepted types"
  - "partitions/operational/monitor.ts — stagnation detection (consecutive read-only cycles)"
  - "partitions/task/config.ts — capacity: 6, GoalSalience, accepted types"
  - "partitions/task/monitor.ts — goal staleness (no progress for N cycles)"
  - "partitions/entry-router.ts — rule-based router wrapping classifyEntry + D3 tool-result rule"
  - "partitions/partition-system.ts — PartitionSystemImpl: wire 3 partitions, buildContext, checkPartitions"
  - "partitions/index.ts — barrel export for partitions domain"
  - "partitions/__tests__/partition-system.test.ts"
  - "partitions/__tests__/entry-router.test.ts"
  - "partitions/__tests__/monitors.test.ts"
acceptance_criteria:
  - "AC-1: EntryRouter routes 'must NOT import X' → constraint partition → PRD G-PORT-3"
  - "AC-2: EntryRouter routes tool results → operational partition (regardless of content) → PRD G-PORT-3"
  - "AC-3: EntryRouter routes 'your task: ...' → task partition → PRD G-PORT-3"
  - "AC-4: PartitionSystem.buildContext() returns entries from declared sources only → PRD G-PORT-2"
  - "AC-5: PartitionSystem.buildContext() respects token budget → PRD G-PORT-2"
  - "AC-6: Constraint monitor detects violation patterns in actorOutput → PRD G-MONITOR-1"
  - "AC-7: Operational monitor detects 3+ consecutive read-only actions → PRD G-MONITOR-2"
  - "AC-8: Task monitor fires when no progress entries for N cycles → PRD G-MONITOR-3"
  - "AC-9: No imports from engine/ or modules/ in partitions/ → PRD G-BOUNDARY-1"
  - "AC-10: npm run build passes, npm test passes"
estimated_tasks: 8
branch: "feat/prd044-c2-partition-system"
status: pending
```

### C-3: Cycle Orchestrator Partitioned Path

```yaml
id: C-3
phase: C-3
title: "Cycle orchestrator partitioned path"
domain: "cognitive/engine"
wave: 3
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/engine/cycle.ts"
    - "packages/pacta/src/cognitive/engine/index.ts"
    - "packages/pacta/src/cognitive/engine/__tests__/cycle-partitioned.test.ts"
  forbidden_paths:
    - "packages/pacta/src/cognitive/algebra/**"
    - "packages/pacta/src/cognitive/modules/**"
    - "packages/pacta/src/cognitive/partitions/**"
    - "packages/pacta/src/ports/**"
    - "packages/pacta/package.json"
depends_on: ["C-2"]
parallel_with: []
consumed_ports:
  - name: "PartitionSystem"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "ContextSelector"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "PartitionSignal"
    status: frozen
    source: "algebra/partition-types.ts"
  - name: "PartitionSystem (implementation from C-2)"
    status: frozen
    source: "partitions/partition-system.ts"
produced_ports: []
deliverables:
  - "engine/cycle.ts — Add partitionSystem? + moduleSelectors? to CycleConfig; buildModuleContext per module; partition signal aggregation; legacy path preserved"
  - "engine/index.ts — Re-export new config types if needed"
  - "engine/__tests__/cycle-partitioned.test.ts — Partitioned cycle: typed context per module, signal handling, backward compat, critical signal → RESTRICT + REPLAN"
acceptance_criteria:
  - "AC-1: CycleConfig accepts optional partitionSystem + moduleSelectors"
  - "AC-2: When partitionSystem provided, each module receives buildContext output (not snapshot) → PRD G-BOUNDARY-2"
  - "AC-3: When partitionSystem NOT provided, legacy workspace.snapshot() path unchanged → PRD G-BOUNDARY-2"
  - "AC-4: Existing cycle tests pass without modification (backward compat) → PRD G-BOUNDARY-2"
  - "AC-5: Partition signals with severity 'critical' trigger RESTRICT + REPLAN"
  - "AC-6: Partition signals with severity 'high' trigger REPLAN after 2+ consecutive occurrences"
  - "AC-7: Default selectors: Reasoner sees all 3 partitions, Monitor sees constraint+operational, Actor sees operational+task"
  - "AC-8: npm run build passes, npm test passes"
estimated_tasks: 5
branch: "feat/prd044-c3-cycle-integration"
status: pending
```

### C-4: Experiment Runner + T01-T06 Validation

```yaml
id: C-4
phase: C-4
title: "Experiment runner update + T01-T06 validation"
domain: "experiments"
wave: 4
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts"
    - "experiments/exp-slm/phase-5-cycle/src/**"
    - "experiments/log/2026-*-exp-slm-r17-*.yaml"
  forbidden_paths:
    - "packages/**"
    - "experiments/exp-cognitive-baseline/**"
    - "experiments/PROTOCOL.md"
    - "experiments/AGENDA.md"
depends_on: ["C-3"]
parallel_with: []
consumed_ports:
  - name: "PartitionSystem (from C-2, via engine cycle from C-3)"
    status: frozen
    source: "partitions/partition-system.ts"
  - name: "createPartitionSystem factory"
    status: frozen
    source: "partitions/index.ts"
produced_ports: []
deliverables:
  - "run-slm-cycle.ts — Replace createWorkspace() with createPartitionSystem(); wire into cognitive cycle; add per-module context profiling"
  - "experiments/log/YYYY-MM-DD-exp-slm-r17-partitioned.yaml — Experiment results"
acceptance_criteria:
  - "AC-1: T06 pass rate >= 60% (2/3 or better) at MAX_CYCLES=30 → PRD SC-1"
  - "AC-2: T01-T05 pass rate >= 70% (no regression) → PRD SC-2"
  - "AC-3: Per-module context size logged and shows reduction vs monolithic baseline → PRD SC-3"
  - "AC-4: Experiment log written to experiments/log/ with full metrics"
estimated_tasks: 4
branch: "feat/prd044-c4-experiment-validation"
status: pending
```

---

## Acceptance Gates

| PRD Criterion | Commissions | Gate |
|---------------|-------------|------|
| SC-1: T06 >= 60% at 30 cycles | C-4 AC-1 | **R-17 experiment** |
| SC-2: T01-T05 >= 70% | C-4 AC-2 | **R-17 experiment** |
| SC-3: Per-module context size reduced | C-4 AC-3 | **R-17 instrumentation** |
| G-EVICTION-1: NoEviction works | C-1 AC-1, AC-2 | **Unit test** |
| G-EVICTION-2: RecencyEviction works | C-1 AC-3 | **Unit test** |
| G-EVICTION-3: GoalSalience works | C-1 AC-4, AC-5 | **Unit test** |
| G-PORT-1: PartitionReadPort.select | C-1 AC-6, AC-7 | **Unit test** |
| G-PORT-2: buildContext respects budget | C-2 AC-4, AC-5 | **Integration test** |
| G-PORT-3: Router classifies correctly | C-2 AC-1, AC-2, AC-3 | **Unit test** |
| G-BOUNDARY-1: No upward imports | C-2 AC-9 | **Static analysis** |
| G-BOUNDARY-2: Backward compat | C-3 AC-3, AC-4 | **Existing tests pass** |
| G-MONITOR-1/2/3: Partition monitors | C-2 AC-6, AC-7, AC-8 | **Unit test** |

---

## Status Tracker

```
Total: 4 commissions, 5 waves (including Wave 0)
Completed: 4 / 4

Wave 0: DONE (orchestrator — partition-types.ts, constraint-utils.ts, barrel updates)
Wave 1: DONE (C-1 — eviction-policies.ts, partition-workspace.ts, 25 tests pass)
Wave 2: DONE (C-2 — partition-system.ts, entry-router.ts, 3 monitors, 65 tests pass)
Wave 3: DONE (C-3 — cycle.ts partitioned path, cycle-partitioned.test.ts, 7 tests pass)
Wave 4: DONE (C-4 — partitioned-cognitive condition, R-17 experiment: T01 3/3 at 30cyc, context 30-67% reduction)
```
