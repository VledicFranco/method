---
type: prd
title: "PRD 045: Workspace Composition — RFC 003 Completion"
date: "2026-04-01"
status: draft
domains: [algebra, partitions, engine, modules]
surfaces: [PartitionWriteAdapter, TypeResolver, ModuleContextBinding]
depends_on: [PRD 044, PRD 043]
---

# PRD 045: Workspace Composition — RFC 003 Completion

## Problem

The RFC 003 partition architecture is 80% implemented: all 7 surface types are frozen, all implementations exist, the read-path is wired in the cycle orchestrator (`buildModuleContext()` with per-module `ContextSelector`). But the system doesn't compose:

1. **Write-path disconnected.** Module writes go to the legacy `WorkspaceWritePort` — a monolithic workspace buffer. The `PartitionSystem.write()` method and `EntryRouter` exist but are never invoked from the canonical cycle in `engine/cycle.ts`. Consequence: partitions never accumulate entries through normal cycle execution. The experiment runners (`run-slm-cycle.ts`) had to duplicate the entire cycle loop and manually wire partition reads and writes, creating a parallel code path that drifts from the canonical cycle.

2. **Modules coupled to partition names.** `ContextSelector.sources` is `PartitionId[]` — modules declare which partitions they need by name (`['constraint', 'operational']`). Adding a new partition (e.g., `'patient'` or `'communication'`) requires updating every module's selector. RFC 003 Q5 explicitly identifies this as a coupling defect and proposes modules should declare entry *type* requirements only, with the system resolving types to partitions.

3. **Dual-workspace redundancy.** When `CycleConfig.partitionSystem` is provided, both the legacy `Workspace` and the `PartitionSystem` exist in the cycle. Modules read from partitions (via `buildModuleContext`) but write to the legacy workspace. This dual-write produces inconsistent state — the partitions the modules read from never receive the entries the modules write.

**Who has the problem:** Any consumer of `engine/cycle.ts` who wants partition benefits. Currently zero consumers — every partitioned experiment manually rewires the cycle.

**What happens if we don't solve it:** The canonical cycle remains partition-unaware. Every new experiment or condition that wants partitions duplicates the cycle loop. The `run-slm-cycle.ts` experiment file already has 6 condition functions (~1800 lines) with copy-pasted cycle logic. Each drifts independently.

## Constraints

1. **PRD 044 surfaces are frozen.** The 7 interfaces in `partition-types.ts` (EvictionPolicy, PartitionReadPort, ContextSelector, PartitionSignal, EntryRouter, PartitionSystem, PartitionMonitor) must not change their shape. New interfaces may be added; existing ones may gain optional fields only.
2. **Backward compatibility.** The cycle must work identically when `CycleConfig.partitionSystem` is absent. The legacy `Workspace` path is the default.
3. **No new LLM calls.** Entry routing remains deterministic (rule-based `DefaultEntryRouter`).
4. **`EntryContentType` is a closed union** (PRD 043 D7): `'constraint' | 'goal' | 'operational'`. Must not be expanded without a new PRD justification.
5. **Module input types are frozen.** `ReasonerActorInput`, `ObserverInput`, `EvaluatorInput` shapes unchanged.

## Success Criteria

1. **Canonical cycle routes writes through partitions.** When `CycleConfig.partitionSystem` is present, module writes go through `EntryRouter` → `PartitionSystem.write()`. No legacy workspace writes.
2. **Modules declare context needs by entry type, not partition name.** A module created with `contextBinding: { types: ['constraint', 'goal'], budget: 4096, strategy: 'all' }` receives constraint and goal entries regardless of which partitions hold them.
3. **`run-slm-cycle.ts` partitioned conditions can use the canonical cycle.** The custom cycle loops for `partitioned-cognitive` and `partitioned-smart` reduce to configuration, not code duplication.
4. **`partitionLastWriteCycle` tracking works.** Partition monitors correctly detect stagnation because write events are tracked.

## Scope

### In Scope

- Write-path adapter: intercept `WorkspaceWritePort.write()` and route through `PartitionSystem.write()`
- Type-driven context resolution: resolve `EntryContentType[]` → `PartitionId[]` using partition configs
- Module context binding: modules declare their type requirements at creation time
- Cycle integration: single code path that works with or without partitions
- `partitionLastWriteCycle` tracking in the cycle
- Legacy workspace suppression when partitions are active

### Out of Scope

- Dynamic partition creation/lifecycle (Q2 from RFC 003)
- LLM/SLM-based entry routing (Phase 2+)
- Communication partition (speculative)
- Formal algebra for ⊕ composition (Q4 from RFC 003)
- Expanding `EntryContentType` to fine-grained types (separate PRD if needed)
- Diversity selection strategy implementation (separate concern)
- SLM retraining (existing SLMs work with typed context)

## Domain Map

Four domains in `packages/pacta/src/cognitive/`:

```
algebra/     ──defines types──→  partitions/        (consumed)
algebra/     ──defines types──→  modules/           (consumed)
algebra/     ──defines types──→  engine/            (consumed)

partitions/  ──implements──→     algebra/            (concrete impls of frozen interfaces)
partitions/  ──emits signals──→  engine/             (PartitionSignal)

modules/     ──writes entries──→ partitions/  (NEW)  (via PartitionWriteAdapter → EntryRouter)
modules/     ──reads context──→  partitions/         (via ContextSelector → buildContext)
modules/     ──declares binding──→ engine/   (NEW)   (ModuleContextBinding at creation)

engine/      ──orchestrates──→   modules/            (step() calls)
engine/      ──builds context──→ partitions/ (EXISTING) (buildModuleContext)
engine/      ──routes writes──→  partitions/ (NEW)   (PartitionWriteAdapter)
engine/      ──resolves types──→ partitions/ (NEW)   (TypeResolver)
```

**New cross-domain interactions (3 surfaces needed):**

| From → To | Interaction | Status |
|-----------|-------------|--------|
| engine/ → partitions/ | Write routing via adapter | NEW surface |
| engine/ → partitions/ | Type→partition resolution | NEW surface |
| modules/ → engine/ | Context binding declaration | NEW surface |

---

## Surfaces (Primary Deliverable)

### S-8: PartitionWriteAdapter

**Complexity:** TRIVIAL — 2 methods, adapter pattern, unidirectional

An adapter that satisfies the `WorkspaceWritePort` interface but routes entries through `PartitionSystem.write()` instead of the legacy workspace. This is the bridge between modules (which write via `WorkspaceWritePort`) and the partition system (which requires `PartitionSystem.write(entry, source)`).

```typescript
/**
 * Adapts WorkspaceWritePort to route writes through a PartitionSystem.
 *
 * Modules call writePort.write(entry) as before. The adapter:
 * 1. Calls partitionSystem.write(entry, source) — EntryRouter classifies and stores
 * 2. Tracks which partition received the write (for partitionLastWriteCycle)
 *
 * Owner: engine/ (created in cycle orchestrator, injected into modules)
 * Producer: engine/cycle.ts
 * Consumer: all cognitive modules via WorkspaceWritePort
 */
interface PartitionWriteAdapter extends WorkspaceWritePort {
  /** Write an entry, routing through the partition system's EntryRouter. */
  write(entry: WorkspaceEntry): void;

  /** Returns which partitions received writes since last reset. */
  getWrittenPartitions(): Map<PartitionId, number>;  // partition → last cycle written

  /** Reset per-cycle tracking. Called at cycle start. */
  resetCycleTracking(): void;
}
```

**Gate:** G-PORT — `PartitionWriteAdapter` implements `WorkspaceWritePort` (type check). Module writes routed to correct partition in tests.

**Status: FROZEN**

---

### S-9: TypeResolver

**Complexity:** TRIVIAL — 1 method, pure function, unidirectional

Resolves `EntryContentType[]` to `PartitionId[]` by looking up which partitions declare those types in their `acceptedTypes` config. This decouples modules from partition names.

```typescript
/**
 * Resolves entry content types to the partitions that store them.
 *
 * Uses partition configs (constraint/config.ts, operational/config.ts, task/config.ts)
 * as the registry. The mapping is static — derived from partition definitions at
 * system creation time.
 *
 * Owner: partitions/
 * Producer: createPartitionSystem() or standalone factory
 * Consumer: engine/ (resolveContextSelector)
 */
interface TypeResolver {
  /**
   * Given entry content types, return the partitions that accept entries of those types.
   *
   * Resolution rules:
   *   'constraint' → ['constraint']       (ConstraintPartition accepts 'constraint')
   *   'goal'       → ['task']             (TaskPartition accepts 'goal')
   *   'operational' → ['operational']     (OperationalPartition accepts 'operational')
   *   ['constraint', 'goal'] → ['constraint', 'task']
   *
   * When EntryContentType is extended in a future PRD, the resolver automatically
   * picks up new mappings from partition configs.
   */
  resolve(types: EntryContentType[]): PartitionId[];
}
```

**Gate:** G-BOUNDARY — resolver correctly maps all 3 current `EntryContentType` values. Adding a partition with new `acceptedTypes` does NOT require resolver code changes.

**Status: FROZEN**

---

### S-10: ModuleContextBinding

**Complexity:** STANDARD — 4 fields, affects module creation + cycle orchestrator

The per-module declaration of what context a module needs, expressed in entry types (not partition names). Replaces the hardcoded `DEFAULT_MODULE_SELECTORS` map in `cycle.ts`.

```typescript
/**
 * A module's declaration of what context it needs from the workspace.
 *
 * Expressed in entry content types — decoupled from partition identity.
 * The cycle orchestrator uses TypeResolver to map types → partitions,
 * then builds a ContextSelector to query the PartitionSystem.
 *
 * Owner: algebra/ (type definition)
 * Producer: module factory functions (createReasonerActor, createObserver, etc.)
 * Consumer: engine/cycle.ts (resolves binding → ContextSelector → buildContext)
 */
interface ModuleContextBinding {
  /** What entry types this module needs to see. */
  types: EntryContentType[];

  /** Maximum token budget for this module's context window. */
  budget: number;

  /** Selection strategy within the budget. */
  strategy: SelectStrategy;
}
```

**Resolution pipeline in the cycle orchestrator:**

```
Module declares:       { types: ['constraint', 'goal'], budget: 4096, strategy: 'all' }
                              ↓ TypeResolver.resolve(['constraint', 'goal'])
Types resolved to:     sources = ['constraint', 'task']
                              ↓
ContextSelector built: { sources: ['constraint', 'task'], types: ['constraint', 'goal'],
                         budget: 4096, strategy: 'all' }
                              ↓ PartitionSystem.buildContext(selector)
Module receives:       WorkspaceEntry[] (constraints + goals, budget-truncated)
```

**How modules declare bindings:**

Option A — on the CognitiveModule interface itself:
```typescript
interface CognitiveModule<I, O, S, M, K> {
  id: ModuleId;
  contextBinding?: ModuleContextBinding;  // NEW optional field
  initialState(): S;
  step(input: I, state: S, control: K): Promise<StepResult<O, S, M>>;
}
```

Option B — passed as config to module factories:
```typescript
const reasoner = createReasonerActor(adapter, tools, writePort, {
  contextBinding: { types: ['constraint', 'goal', 'operational'], budget: 8192, strategy: 'salience' },
});
```

**Decision: Option A.** Adding `contextBinding?` to `CognitiveModule` is backward compatible (optional field). The cycle orchestrator checks `module.contextBinding` first, then falls back to `DEFAULT_MODULE_SELECTORS` for modules that don't declare one. This keeps the binding co-located with the module rather than requiring external registration.

**Gate:** G-BOUNDARY — modules with `contextBinding` receive context matching their declaration. Modules without `contextBinding` receive default context (backward compat).

**Status: FROZEN**

---

### Surface Summary

| Surface | Owner | Producer → Consumer | Complexity | Status | Gate |
|---------|-------|---------------------|------------|--------|------|
| S-8 `PartitionWriteAdapter` | engine/ | engine → modules | TRIVIAL | **FROZEN** | G-PORT |
| S-9 `TypeResolver` | partitions/ | partitions → engine | TRIVIAL | **FROZEN** | G-BOUNDARY |
| S-10 `ModuleContextBinding` | algebra/ | modules → engine | STANDARD | **FROZEN** | G-BOUNDARY |

### Entity Changes

| Entity | Location | Change | Impact |
|--------|----------|--------|--------|
| `CognitiveModule` | `algebra/module.ts` | Add optional `contextBinding?: ModuleContextBinding` | All module factories, cycle orchestrator |
| `PartitionSystem` | `algebra/partition-types.ts` | Add optional `typeResolver?: TypeResolver` | Factory only |
| `CycleConfig` | `engine/cycle.ts` | No change needed — already has `partitionSystem?: PartitionSystem` | None |
| `DEFAULT_MODULE_SELECTORS` | `engine/cycle.ts` | Becomes fallback only — prefer `module.contextBinding` | Deprecation path |

---

## Per-Domain Architecture

### algebra/ — Type Definitions

**Layer:** L2 (pure types, no implementations)

**Changes:**
1. Add `ModuleContextBinding` interface to `partition-types.ts`
2. Add `TypeResolver` interface to `partition-types.ts`
3. Add optional `contextBinding?: ModuleContextBinding` to `CognitiveModule` in `module.ts`
4. Re-export new types from `index.ts`

**Verification:** `npm run build` — types compile, existing tests pass.

---

### partitions/ — Type Resolver Implementation

**Layer:** L2/L3 (domain logic)

**New file:** `partitions/type-resolver.ts`

```typescript
import { CONSTRAINT_PARTITION_CONFIG } from './constraint/config.js';
import { OPERATIONAL_PARTITION_CONFIG } from './operational/config.js';
import { TASK_PARTITION_CONFIG } from './task/config.js';
import type { EntryContentType, PartitionId, TypeResolver } from '../algebra/partition-types.js';

/**
 * Creates a TypeResolver from the partition configs.
 *
 * Builds a reverse index: entryType → partitionId[].
 * The mapping is static — derived once from partition definitions.
 */
export function createTypeResolver(): TypeResolver {
  // Build reverse index: 'constraint' → ['constraint'], 'goal' → ['task'], etc.
  const typeToPartitions = new Map<string, PartitionId[]>();

  for (const config of [CONSTRAINT_PARTITION_CONFIG, OPERATIONAL_PARTITION_CONFIG, TASK_PARTITION_CONFIG]) {
    for (const acceptedType of config.acceptedTypes) {
      const existing = typeToPartitions.get(acceptedType) ?? [];
      existing.push(config.id);
      typeToPartitions.set(acceptedType, existing);
    }
  }

  // Map coarse EntryContentType to partition using the partition that "owns" that type
  // 'constraint' → constraint partition, 'goal' → task partition, 'operational' → operational partition
  const coarseMapping = new Map<EntryContentType, PartitionId[]>([
    ['constraint', ['constraint']],
    ['goal', ['task']],
    ['operational', ['operational']],
  ]);

  return {
    resolve(types: EntryContentType[]): PartitionId[] {
      const partitions = new Set<PartitionId>();
      for (const t of types) {
        const targets = coarseMapping.get(t);
        if (targets) {
          for (const p of targets) partitions.add(p);
        }
      }
      return [...partitions];
    },
  };
}
```

**Test file:** `partitions/__tests__/type-resolver.test.ts`

**Verification:** G-BOUNDARY — `resolve(['constraint'])` returns `['constraint']`, `resolve(['goal', 'operational'])` returns `['task', 'operational']`. All coarse types map correctly.

---

### engine/ — Cycle Integration (Write Path + Type Resolution)

**Layer:** L4 (application wiring)

**Changes to `engine/cycle.ts`:**

1. **Create PartitionWriteAdapter** when `config.partitionSystem` is present:

```typescript
function createPartitionWriteAdapter(
  partitionSystem: PartitionSystem,
  source: ModuleId,
): PartitionWriteAdapter {
  const writtenPartitions = new Map<PartitionId, number>();

  return {
    write(entry: WorkspaceEntry): void {
      const targetPartition = partitionSystem.write(entry, source);
      writtenPartitions.set(targetPartition, Date.now());
    },
    getWrittenPartitions() { return writtenPartitions; },
    resetCycleTracking() { writtenPartitions.clear(); },
  };
}
```

2. **Replace legacy workspace writes when partitions enabled:**

```typescript
// In cycle setup:
const writePort = config.partitionSystem
  ? createPartitionWriteAdapter(config.partitionSystem, moduleId)
  : workspace.getWritePort(moduleId);
```

3. **Build context from module binding:**

```typescript
function resolveModuleContext(
  module: CognitiveModule<any, any, any, any, any>,
  partitions: PartitionSystem,
  fallbackSelectors: Record<string, ContextSelector>,
): ReadonlyWorkspaceSnapshot {
  if (module.contextBinding) {
    // Type-driven resolution
    const resolver = createTypeResolver();
    const sources = resolver.resolve(module.contextBinding.types);
    const selector: ContextSelector = {
      sources,
      types: module.contextBinding.types,
      budget: module.contextBinding.budget,
      strategy: module.contextBinding.strategy,
    };
    return partitions.buildContext(selector);
  }

  // Fallback to DEFAULT_MODULE_SELECTORS
  const key = String(module.id);
  const selector = fallbackSelectors[key];
  return selector ? partitions.buildContext(selector) : partitions.snapshot();
}
```

4. **Track `partitionLastWriteCycle`:**

```typescript
// After each module step:
if (writeAdapter) {
  for (const [partId, _ts] of writeAdapter.getWrittenPartitions()) {
    partitionLastWriteCycle.set(partId, cycleNumber);
  }
  writeAdapter.resetCycleTracking();
}
```

**Test file:** `engine/__tests__/cycle-composition.test.ts`

**Verification:**
- G-PORT: modules receive correct partition context when `contextBinding` declared
- G-BOUNDARY: module writes routed through partitions, `partitionLastWriteCycle` updated
- G-LAYER: legacy path unchanged when `partitionSystem` absent

---

### modules/ — Context Binding Declaration

**Layer:** L3 (module domain)

**Changes:** Each module factory gains an optional `contextBinding` parameter that gets attached to the returned module object:

```typescript
// In createReasonerActor:
export function createReasonerActor(
  adapter: ProviderAdapter,
  tools: ToolProvider,
  writePort: WorkspaceWritePort,
  config?: ReasonerActorConfig,
): CognitiveModule<...> {
  const id = moduleId(config?.id ?? 'reasoner-actor');

  return {
    id,
    contextBinding: config?.contextBinding,  // NEW — type-driven declaration
    initialState() { ... },
    async step(...) { ... },
  };
}
```

Default bindings (replace hardcoded `DEFAULT_MODULE_SELECTORS`):

| Module | types | budget | strategy |
|--------|-------|--------|----------|
| observer | `['goal']` | 1024 | all |
| reasoner-actor | `['goal', 'constraint', 'operational']` | 8192 | salience |
| monitor | `['constraint', 'operational']` | 2048 | all |
| evaluator | `['goal', 'operational']` | 2048 | salience |
| planner | `['goal', 'constraint']` | 4096 | salience |
| reflector | `['goal', 'operational']` | 2048 | recency |

These become the DEFAULT values in each module factory's config type, overridable per-instance.

---

## Phase Plan

### Wave 0: Surfaces (1 day)

**Deliverables:**
- `ModuleContextBinding` type in `algebra/partition-types.ts`
- `TypeResolver` interface in `algebra/partition-types.ts`
- `PartitionWriteAdapter` interface in `algebra/partition-types.ts` (or `engine/`)
- `contextBinding?: ModuleContextBinding` field on `CognitiveModule` interface
- Re-exports in `algebra/index.ts`
- Gate: `npm run build` passes, existing tests pass

**Changes no business logic.** Creates the type fabric.

### Wave 1: Type Resolver + Write Adapter (2 days)

**Deliverables:**
- `partitions/type-resolver.ts` — `createTypeResolver()` implementation
- `partitions/__tests__/type-resolver.test.ts` — resolution tests
- `engine/partition-write-adapter.ts` — adapter implementation
- `engine/__tests__/partition-write-adapter.test.ts` — routing tests
- Gate: G-BOUNDARY, G-PORT pass

### Wave 2: Cycle Integration (2-3 days)

**Deliverables:**
- `engine/cycle.ts` modifications:
  - Use `PartitionWriteAdapter` when partitions enabled
  - Use `resolveModuleContext()` with type-driven resolution
  - Track `partitionLastWriteCycle` from write adapter
  - Suppress legacy workspace writes when partitions active
- `engine/__tests__/cycle-composition.test.ts` — integration tests
- Gate: existing `cycle-partitioned.test.ts` passes, new composition tests pass

### Wave 3: Module Bindings (1 day)

**Deliverables:**
- Add `contextBinding` to each module factory config type
- Add default binding values to each module factory
- Gate: `npm run build`, module tests pass

### Wave 4: Experiment Migration + Validation (2-3 days)

**Deliverables:**
- Refactor `run-slm-cycle.ts` `runPartitionedCognitive` and `runPartitionedSmart` to use canonical cycle with `CycleConfig.partitionSystem` instead of manual wiring
- Run T01-T06 experiment to validate parity with manual wiring
- Gate: T01-T05 ≥ 70%, T06 ≥ previous best (8 writes in 30 cycles)

### Wave 5: Deprecation + Cleanup (1 day)

**Deliverables:**
- Mark `DEFAULT_MODULE_SELECTORS` as deprecated (fallback only)
- Add JSDoc to `CycleConfig.partitionSystem` documenting the composition model
- Update `FINDINGS.md` with composition validation results

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Write adapter breaks module isolation (modules see writes from other modules via partition reads) | Medium | Low | This is INTENDED — cross-module visibility through partitions is the RFC 003 composition model. Monitor via partition monitors. |
| Type-driven resolution too coarse (3 types → 3 partitions = trivially equivalent) | Medium | Low | The value is in decoupling, not granularity. Fine-grained types (future PRD) would add real selectivity. |
| Experiment regression when switching from manual to canonical cycle | Medium | High | Run experiments in parallel (old code + new code) and compare before removing manual cycle loops. |
| `PartitionWriteAdapter` performance overhead on write path | Low | Low | Adapter is trivial — one function call delegation. No measurable overhead. |
