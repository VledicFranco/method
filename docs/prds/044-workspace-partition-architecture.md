---
type: prd
title: "PRD 044: Workspace Partition Architecture"
date: "2026-03-31"
status: implemented
tier: heavyweight
depends_on: [30, 43]
enables: []
blocked_by: []
complexity: high
domains_affected: ["cognitive/algebra", "cognitive/partitions (new)", "cognitive/engine", "cognitive/modules"]
surfaces:
  - EvictionPolicy
  - PartitionReadPort
  - ContextSelector
  - PartitionSignal
  - EntryRouter
  - PartitionSystem
  - PartitionMonitor
---

# PRD 044: Workspace Partition Architecture

## Problem Statement

The cognitive cycle's single monolithic workspace becomes a structural bottleneck on tasks requiring 20+ cycles. Workspace capacity (8 entries) saturates with operational context (file reads, tool output), evicting goal and strategy entries. Every module receives `workspace.snapshot()` — a flat dump of all entries — when most need only a typed subset.

**Evidence:**

- **R-16 (T06, N=3, 30 cycles): 0% pass rate.** All 3 runs spent 30 cycles in Read/Grep loops without ever creating the extraction target (`src/event-bus.ts`). Workspace context profile: 8 entries saturated at 3-5K tokens (4.5x larger than T01-T05 average of 672 tokens). The Monitor flagged stagnation repeatedly but the agent couldn't recover because the goal context was already evicted.

- **R-15: Observer-every-cycle pollution (fixed).** T01 went 33% → 100% by switching Observer to cycle0 mode. The fix was cycle-gating (don't write noisy entries), but the root cause was monolithic workspace — Observer attention signals competing with tool results for the same 8 slots.

- **Phase 0 (PRD 043): constraint blindness solved.** Pin flag fixed T04 (0% → 100%). But pinning is a degenerate 2-partition system (pinned vs unpinned). Goal drift and monolithic context waste remain unsolved.

**Structural diagnosis:** A single eviction policy cannot serve all information types. Constraints need permanent retention. Tool results need aggressive recency. Goals need salience-based persistence. The workspace must be partitioned by information type with independent eviction policies.

## Objective

Implement RFC 003 Phase 1 — split the monolithic workspace into typed partitions with independent eviction policies, per-module context selection, entry routing, and per-partition deterministic monitors. The cognitive cycle produces agents that maintain goal context across 30+ cycles while keeping operational context fresh and constraints always visible.

**Both R-17 outcomes are valuable:**
- **T06 ≥ 60%:** Goal drift mitigated by TaskPartition with GoalSalience eviction. Validates RFC 003 Phase 1. Opens path to ARC-AGI integration.
- **T06 < 60% despite goals in context:** Goal drift is not a workspace problem — the Reasoner ignores goals even when present. Diagnostic instrumentation (per-module context profiles) tells us exactly where the pipeline broke.

## Success Criteria

1. **T06 pass rate ≥ 60%** (from 0/3 at 30 cycles) — goal drift mitigated
2. **T01-T05 pass rate ≥ 70%** — no regression from partition introduction
3. **Per-module context size measurably reduced** — instrumented and reported in R-17

## Scope

**In scope:**
- Partition types, eviction policies, PartitionReadPort
- Three partitions: Constraint, Operational, Task
- Per-module ContextSelector configs + buildContext
- Entry router (rule-based, promoting existing classifyEntry)
- Per-partition deterministic monitors + PartitionSignal aggregation
- Cycle orchestrator integration (opt-in path, backward compatible)
- Experiment runner update + T01-T06 validation

**Out of scope:**
- LLM/SLM-based entry routing (Phase 2+ — when keyword routing error rate is measured and insufficient)
- Dynamic partition creation/lifecycle (Phase 2+ — no evidence of need)
- Communication partition (speculative — no observed communication failures)
- Formal algebra for partition composition ⊕ (Phase 2+ — after empirical patterns emerge)
- SLM retraining (existing SLMs work with typed context subsets)
- ARC-AGI integration (separate research line, depends on this PRD)

## Architecture

### Domain Map

All work within `@method/pacta/src/cognitive/`:

```
algebra/  ──defines types──→  partitions/     (types consumed by implementations)
modules/  ──routes entries──→ partitions/     (router classifies entries)
engine/   ──reads context──→  partitions/     (buildContext via PartitionReadPort)
engine/   ──wires selectors──→ modules/       (ContextSelector per module)
partitions/ ──emits signals──→ engine/        (PartitionSignals aggregated in cycle)
```

**Layer placement:**
- `algebra/partition-types.ts` — L2 (pure types, zero deps)
- `partitions/` — L2 (domain implementations, depend only on algebra/ types)
- `engine/cycle.ts` — L3 (consumes partitions via ports)
- `modules/constraint-classifier.ts` — L2 (consumed by router, unchanged)

### Design Decisions

**D1: Partitions are storage domains, not cognitive modules.**
Partitions are typed workspace buffers with eviction policies and deterministic monitors. They are NOT RFC 001 cognitive modules — they have no `step()`, no monitoring signals, no control directives. They are infrastructure that modules consume via ports.

**D2: Opt-in partition path in cycle.ts.**
The `CycleConfig` gains an optional `partitionSystem?: PartitionSystem`. When provided, `buildContext(selector, partitions)` replaces `workspace.snapshot()` for each module's input. When absent, the legacy monolithic path is unchanged. This preserves backward compatibility and allows gradual migration.

**D3: Generic partition workspace parametric over EvictionPolicy.**
A single `PartitionWorkspace` class handles storage, capacity, and eviction — parameterized by an `EvictionPolicy` implementation. The three concrete partitions differ only in config (capacity, accepted types) and policy. No class-per-partition duplication.

**D4: Entry router wraps existing classifyEntry.**
The `classifyEntry()` function from PRD 043 already returns `contentType: 'constraint' | 'goal' | 'operational'`. The router maps this 1:1 to `PartitionId`. Tool results (from Actor) always route to `'operational'` regardless of content (D3 from PRD 043 — prevents false positives on source code).

**D5: Per-partition monitors are deterministic functions, not LLM modules.**
Each partition co-locates a pure function monitor. The constraint monitor promotes the existing `checkConstraintViolations()` from PRD 043. The operational monitor extracts stagnation detection from Monitor V1. The task monitor adds goal staleness detection (no progress entries for N cycles). These functions run after ACT, producing `PartitionSignal` objects aggregated by severity.

**D6: Capacity increase with budget-controlled visibility.**
Total workspace capacity increases from 8 to ~28 entries (Constraint: 10, Operational: 12, Task: 6). But per-module token budgets in `ContextSelector` control how much each module actually sees. More storage does NOT mean more context per LLM call — it means better retention with selective retrieval.

**D7: GoalSalience eviction preserves entries with `contentType: 'goal'` and evicts entries with `contentType: 'strategy'` when superseded.**
The TaskPartition accepts both goals and strategies. Goals persist (similar to pinning). Strategies evict by recency when capacity is reached. A strategy entry is "superseded" when a newer strategy entry with the same goal reference exists.

## Surfaces (Primary Deliverable)

### S-1: EvictionPolicy

```typescript
// algebra/partition-types.ts

export interface EvictionPolicy {
  /** Select index of entry to evict, or null if none should be evicted. */
  selectForEviction(entries: ReadonlyArray<WorkspaceEntry>): number | null;
}
```

Three implementations in `partitions/eviction-policies.ts`:
- `NoEvictionPolicy` — always returns null (constraints never evicted; safety valve at `maxEntries` evicts oldest)
- `RecencyEvictionPolicy` — evicts entry with oldest timestamp
- `GoalSalienceEvictionPolicy` — evicts oldest `strategy` entries first; `goal` entries protected

**Status:** Frozen. Gate: G-BOUNDARY.

### S-2: PartitionReadPort

```typescript
// algebra/partition-types.ts

export type PartitionId = 'constraint' | 'operational' | 'task';

export type SelectStrategy = 'all' | 'recency' | 'salience' | 'diversity';

export interface PartitionSelectOptions {
  types?: EntryContentType[];
  budget?: number;          // Estimated token budget
  strategy?: SelectStrategy;
}

export interface PartitionReadPort {
  readonly id: PartitionId;
  select(options?: PartitionSelectOptions): WorkspaceEntry[];
  count(): number;
  snapshot(): ReadonlyArray<WorkspaceEntry>;
}
```

Each partition implements this. The cycle orchestrator reads from partitions exclusively through this port. Modules never access partition internals.

**Status:** Frozen. Gate: G-PORT.

### S-3: ContextSelector

```typescript
// algebra/partition-types.ts

export interface ContextSelector {
  sources: PartitionId[];
  types?: EntryContentType[];
  budget: number;
  strategy: SelectStrategy;
}
```

Configuration type — each module declares what context it needs. Wired at composition time in the cycle orchestrator.

**Default selectors:**

| Module | Sources | Budget | Strategy |
|--------|---------|--------|----------|
| Reasoner | task, constraint, operational | 8192 | salience |
| Monitor | constraint, operational | 2048 | all |
| Actor | operational, task | 4096 | recency |
| Observer | task | 1024 | all |
| Evaluator | task, operational | 2048 | salience |
| Planner | task, constraint | 4096 | salience |

**Status:** Frozen. Gate: G-BOUNDARY.

### S-4: PartitionSignal

```typescript
// algebra/partition-types.ts

export type PartitionSignalType =
  | 'constraint-violation'
  | 'stagnation'
  | 'goal-stale'
  | 'capacity-warning';

export interface PartitionSignal {
  severity: 'critical' | 'high' | 'medium' | 'low';
  partition: PartitionId;
  type: PartitionSignalType;
  detail: string;
}
```

Signals flow to the cycle orchestrator for severity-based aggregation:
- `critical` → RESTRICT + REPLAN (constraint violation)
- `high` → REPLAN if persistent (repeated stagnation)
- `medium` → flag for next cycle (goal staleness)
- `low` → log only (capacity warning)

**Status:** Frozen. Gate: G-BOUNDARY.

### S-5: EntryRouter

```typescript
// algebra/partition-types.ts

export interface EntryRouter {
  route(content: unknown, source: ModuleId): PartitionId;
}
```

Single method. Tool results (Actor output) always route to `'operational'`. Task input routes through `classifyEntry()` (PRD 043) which maps `contentType → PartitionId`.

**Status:** Frozen. Gate: G-PORT.

### S-6: PartitionSystem

```typescript
// algebra/partition-types.ts

export interface PartitionSystem {
  getPartition(id: PartitionId): PartitionReadPort;
  write(entry: WorkspaceEntry, source: ModuleId): void;
  buildContext(selector: ContextSelector): WorkspaceEntry[];
  checkPartitions(context: PartitionMonitorContext): PartitionSignal[];
  snapshot(): ReadonlyArray<WorkspaceEntry>;
  resetCycleQuotas(): void;
}
```

Top-level aggregate. `write()` uses EntryRouter to classify → route → store. `buildContext()` iterates selector sources, calls `partition.select()`, concatenates, truncates to budget. `checkPartitions()` runs all partition monitors and aggregates signals.

**Status:** Frozen. Gate: G-PORT.

### S-7: PartitionMonitor

```typescript
// algebra/partition-types.ts

export interface PartitionMonitorContext {
  cycleNumber: number;
  lastWriteCycle: Map<PartitionId, number>;
  actorOutput?: string;
}

export interface PartitionMonitor {
  check(
    entries: ReadonlyArray<WorkspaceEntry>,
    context: PartitionMonitorContext,
  ): PartitionSignal[];
}
```

Pure function interface. Each partition co-locates an implementation:
- Constraint: checks actorOutput against pinned prohibition patterns
- Operational: detects consecutive read-only cycles (stagnation)
- Task: detects no progress entries for N cycles (goal staleness)

**Status:** Frozen. Gate: G-BOUNDARY.

### Surface Summary

| Surface | Type | Producer → Consumer | Status | Gate |
|---------|------|--------------------| -------|------|
| `EvictionPolicy` | Interface | 3 policies → PartitionWorkspace | **Frozen** | G-BOUNDARY |
| `PartitionReadPort` | Port | 3 partitions → cycle orchestrator | **Frozen** | G-PORT |
| `ContextSelector` | Config | module configs → buildContext | **Frozen** | G-BOUNDARY |
| `PartitionSignal` | Event | 3 monitors → cycle orchestrator | **Frozen** | G-BOUNDARY |
| `EntryRouter` | Port | router impl → PartitionSystem.write | **Frozen** | G-PORT |
| `PartitionSystem` | Port | PartitionSystemImpl → cycle orchestrator | **Frozen** | G-PORT |
| `PartitionMonitor` | Interface | 3 monitors → PartitionSystem.checkPartitions | **Frozen** | G-BOUNDARY |

## Per-Domain Architecture

### algebra/ — Types (L2)

**New file:** `algebra/partition-types.ts`
- All 7 surface type definitions + supporting types
- Pure types, zero runtime dependencies

**Modified:** `algebra/index.ts` — re-export partition types

### partitions/ — New Domain (L2)

```
partitions/
  eviction-policies.ts          — NoEviction, RecencyEviction, GoalSalienceEviction
  partition-workspace.ts        — Generic partition (parametric over EvictionPolicy)
  constraint/
    config.ts                   — capacity: 10, types: ['constraint', 'invariant', 'boundary', 'rule']
    monitor.ts                  — Post-Write violation check (promoted from cycle.ts)
  operational/
    config.ts                   — capacity: 12, types: ['tool-result', 'observation', 'error', 'file-content']
    monitor.ts                  — Stagnation detection (extracted from monitor.ts)
  task/
    config.ts                   — capacity: 6, types: ['goal', 'strategy', 'progress', 'milestone']
    monitor.ts                  — Goal staleness (no progress for N cycles)
  partition-system.ts           — PartitionSystemImpl
  entry-router.ts               — Rule-based, wraps classifyEntry
  __tests__/
    eviction-policies.test.ts
    partition-workspace.test.ts
    partition-system.test.ts
    entry-router.test.ts
    monitors.test.ts
```

**Boundary rule:** `partitions/` imports from `algebra/` only. No imports from `engine/` or `modules/` (L2 cannot depend on L3). The constraint monitor does NOT import `checkConstraintViolations` from `modules/constraint-classifier.ts` — it reimplements the pattern matching locally (or the function is moved to `algebra/` as a pure utility). Preferred: promote `extractProhibitions` and `checkConstraintViolations` to a shared utility in `algebra/constraint-utils.ts` since both `partitions/constraint/monitor.ts` and the legacy cycle.ts path need it.

### engine/ — Cycle Integration (L3)

**Modified:** `engine/cycle.ts`

1. `CycleConfig` gains:
   ```typescript
   partitionSystem?: PartitionSystem;
   moduleSelectors?: Map<ModuleId, ContextSelector>;
   ```

2. Per-module context construction:
   ```typescript
   function buildModuleContext(
     moduleId: ModuleId,
     partitions: PartitionSystem,
     selectors: Map<ModuleId, ContextSelector>,
   ): WorkspaceEntry[] {
     const selector = selectors.get(moduleId) ?? DEFAULT_SELECTORS[moduleId.value];
     if (!selector) return partitions.snapshot(); // fallback
     return partitions.buildContext(selector);
   }
   ```

3. Post-ACT: `partitions.checkPartitions(context)` replaces inline violation check. Critical signals → RESTRICT + REPLAN.

4. Legacy path: if `partitionSystem` is not in config, existing `workspace.snapshot()` path is unchanged.

**New test file:** `engine/__tests__/cycle-partitioned.test.ts`

### modules/ — No Interface Changes

Modules are unchanged. Their `step(input, state, control)` signature doesn't change. The `input` they receive is now a typed subset (built by `buildModuleContext`) rather than a monolithic snapshot, but the type is the same (`WorkspaceEntry[]` or similar).

**Extraction only:** `checkConstraintViolations` and `extractProhibitions` promoted to `algebra/constraint-utils.ts` (shared between legacy path and partition monitor). `modules/constraint-classifier.ts` re-exports from the new location for backward compat.

## Phase Plan

### Wave 0: Surfaces (1 day)

| File | Content |
|------|---------|
| `algebra/partition-types.ts` | All 7 surface definitions + PartitionId, SelectStrategy, etc. |
| `algebra/index.ts` | Re-export partition types |

**Gate:** `npm run build` passes. Types importable from `@method/pacta`.

### Phase C-1: Eviction Policies + Generic Partition (2-3 days)

| File | Content |
|------|---------|
| `partitions/eviction-policies.ts` | NoEviction, RecencyEviction, GoalSalienceEviction |
| `partitions/partition-workspace.ts` | Generic partition: store, select (budget + strategy), evict |
| `partitions/__tests__/eviction-policies.test.ts` | Each policy in isolation |
| `partitions/__tests__/partition-workspace.test.ts` | Generic partition × each policy |

**Gate:** G-EVICTION-1/2/3. Partition stores, selects, evicts correctly per policy.

### Phase C-2: Partition System + Router + Monitors (2-3 days)

| File | Content |
|------|---------|
| `partitions/constraint/config.ts` | Constraint partition config |
| `partitions/constraint/monitor.ts` | Violation check |
| `partitions/operational/config.ts` | Operational partition config |
| `partitions/operational/monitor.ts` | Stagnation detection |
| `partitions/task/config.ts` | Task partition config |
| `partitions/task/monitor.ts` | Goal staleness |
| `partitions/entry-router.ts` | Rule-based router |
| `partitions/partition-system.ts` | PartitionSystemImpl |
| `algebra/constraint-utils.ts` | Promoted extractProhibitions + checkConstraintViolations |
| `partitions/__tests__/partition-system.test.ts` | Routing, buildContext, monitors |
| `partitions/__tests__/entry-router.test.ts` | Classification accuracy |
| `partitions/__tests__/monitors.test.ts` | Each partition monitor |

**Gate:** G-PORT-1/2/3, G-BOUNDARY-1, G-MONITOR-1/2/3.

### Phase C-3: Cycle Integration (2-3 days)

| File | Content |
|------|---------|
| `engine/cycle.ts` | PartitionSystem + moduleSelectors in CycleConfig; buildModuleContext per module; partition signal aggregation; legacy path preserved |
| `engine/__tests__/cycle-partitioned.test.ts` | Partitioned cycle: typed context, signal handling, backward compat |
| `modules/constraint-classifier.ts` | Re-export from algebra/constraint-utils.ts (backward compat) |

**Gate:** G-BOUNDARY-2 — existing cycle tests still pass. Partitioned cycle tests pass. `npm test` green.

### Phase C-4: Experiment Validation (2-3 days)

| File | Content |
|------|---------|
| `experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts` | Create PartitionSystem; wire into cognitive cycle; context profiling per module |
| `experiments/log/YYYY-MM-DD-exp-slm-r17-partitioned.yaml` | Results |

**Gate:**
- T06 ≥ 60% (2/3 or better) at 30 cycles
- T01-T05 ≥ 70% — no regression
- Per-module context size measured and reported

## Risks

| Risk | Probability | Mitigation |
|------|------------|------------|
| GoalSalience eviction too aggressive (evicts useful strategies) | Medium | Conservative defaults + tunable config. Validate on T01-T05 before T06. |
| Entry router misclassifies (constraint → operational) | Low | Same patterns as PRD 043 (validated in R-13). Measured in C-2 tests. |
| Backward compat break in cycle.ts | Low | Partitioned path is opt-in. Existing tests run on legacy path. |
| T06 still fails (reasoning limit, not workspace) | Medium | R-16 workspace profiles confirm saturation. Diagnostic instrumentation reveals whether goals are in context. Both outcomes informative. |
| Capacity tuning wrong (too many/few slots) | Medium | Configs are per-partition, easily tunable. Start conservative, measure, adjust. |

## Relationship to RFC 003

This PRD implements **RFC 003 Phase 1** — the minimum useful version of partitioned workspace composition. It does NOT implement:

- **Phase 2+ generalizations** — LLM-based routing, dynamic partitions, formal algebra
- **Communication partition** — speculative, no observed failures
- **SLM-compiled router** — future SLM compilation target (RFC 002 synergy)

RFC 003 status should update from "Phase 0 validated" to "Phase 1 implementing" upon PRD approval.
