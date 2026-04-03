# Realization Plan — PRD 045: Workspace Composition (RFC 003 Completion)

## PRD Summary

**Objective:** Complete RFC 003's workspace composition vision by wiring the partition write-path in the canonical cycle, implementing type-driven context selection (modules declare entry types not partition names), and eliminating the experiment code duplication.

**Success Criteria:**
1. SC-1: Canonical cycle routes writes through `EntryRouter → PartitionSystem.write()` when partitions enabled
2. SC-2: Modules declare context needs by `EntryContentType`, not `PartitionId`
3. SC-3: `run-slm-cycle.ts` partitioned conditions reduce to cycle config, not code duplication
4. SC-4: `partitionLastWriteCycle` tracking enables partition monitors to detect stagnation

## FCA Partition

| Commission | Domain | Wave | Title | Depends On | Consumed Ports |
|------------|--------|------|-------|------------|----------------|
| — | algebra/ | 0 | Surface types | — | — |
| C-1 | partitions/ | 1 | Type resolver implementation | Wave 0 | TypeResolver (frozen) |
| C-2 | engine/ | 2 | Write adapter + cycle integration | Wave 0, C-1 | PartitionWriteAdapter, TypeResolver, ModuleContextBinding (all frozen) |
| C-3 | modules/ | 3 | Context binding declarations | Wave 0, C-2 | ModuleContextBinding (frozen) |
| C-4 | experiments/ | 4 | Migration + validation | C-2, C-3 | All surfaces (frozen) |

---

## Wave 0 — Shared Surfaces (Mandatory)

**Orchestrator applies these directly. No commissions — pure type fabric.**

### Port Interfaces

**S-8: PartitionWriteAdapter** — `algebra/partition-types.ts`
```typescript
/** Adapts WorkspaceWritePort to route writes through PartitionSystem. */
interface PartitionWriteAdapter {
  /** Write entry through EntryRouter → PartitionSystem. */
  write(entry: WorkspaceEntry): void;
  /** Partitions that received writes since last reset. Map<PartitionId, cycleNumber>. */
  getWrittenPartitions(): Map<PartitionId, number>;
  /** Reset per-cycle write tracking. */
  resetCycleTracking(): void;
}
```

**S-9: TypeResolver** — `algebra/partition-types.ts`
```typescript
/** Resolves EntryContentType[] → PartitionId[] using partition configs. */
interface TypeResolver {
  resolve(types: EntryContentType[]): PartitionId[];
}
```

**S-10: ModuleContextBinding** — `algebra/partition-types.ts`
```typescript
/** Module's declaration of what context it needs, by entry type. */
interface ModuleContextBinding {
  types: EntryContentType[];
  budget: number;
  strategy: SelectStrategy;
}
```

### Entity Changes

**`CognitiveModule` in `algebra/module.ts`** — add optional field:
```typescript
contextBinding?: ModuleContextBinding;
```

### Barrel Exports

**`algebra/index.ts`** — re-export:
```typescript
export type { PartitionWriteAdapter, TypeResolver, ModuleContextBinding } from './partition-types.js';
```

### Verification

```bash
npm run build   # types compile
npm test        # existing tests pass — no behavior changes
```

---

## Wave 1 — Type Resolver (partitions/)

### C-1: Implement TypeResolver

```yaml
- id: C-1
  phase: Wave 1
  title: "Implement TypeResolver from partition configs"
  domain: partitions/
  wave: 1
  scope:
    allowed_paths:
      - "packages/pacta/src/cognitive/partitions/type-resolver.ts"
      - "packages/pacta/src/cognitive/partitions/__tests__/type-resolver.test.ts"
      - "packages/pacta/src/cognitive/partitions/index.ts"
    forbidden_paths:
      - "packages/pacta/src/cognitive/algebra/**"
      - "packages/pacta/src/cognitive/engine/**"
      - "packages/pacta/src/cognitive/modules/**"
  depends_on: [Wave-0]
  parallel_with: []
  consumed_ports:
    - name: "TypeResolver"
      status: frozen
      location: "algebra/partition-types.ts"
  produced_ports:
    - name: "createTypeResolver"
  deliverables:
    - "partitions/type-resolver.ts — createTypeResolver() factory"
    - "partitions/__tests__/type-resolver.test.ts — resolution tests"
    - "partitions/index.ts — re-export createTypeResolver"
  acceptance_criteria:
    - "resolve(['constraint']) → ['constraint'] → SC-2"
    - "resolve(['goal']) → ['task'] → SC-2"
    - "resolve(['operational']) → ['operational'] → SC-2"
    - "resolve(['goal', 'constraint']) → ['task', 'constraint'] (deduped) → SC-2"
    - "resolve([]) → [] (no partitions for empty types) → SC-2"
    - "npm test passes → gate"
  estimated_tasks: 3
  branch: "feat/prd045-c1-type-resolver"
  status: pending
```

---

## Wave 2 — Cycle Integration (engine/)

### C-2: Write Adapter + Cycle Wiring

```yaml
- id: C-2
  phase: Wave 2
  title: "Wire write-path and type-driven context resolution in canonical cycle"
  domain: engine/
  wave: 2
  scope:
    allowed_paths:
      - "packages/pacta/src/cognitive/engine/cycle.ts"
      - "packages/pacta/src/cognitive/engine/partition-write-adapter.ts"
      - "packages/pacta/src/cognitive/engine/__tests__/cycle-composition.test.ts"
      - "packages/pacta/src/cognitive/engine/__tests__/partition-write-adapter.test.ts"
      - "packages/pacta/src/cognitive/engine/index.ts"
    forbidden_paths:
      - "packages/pacta/src/cognitive/algebra/**"
      - "packages/pacta/src/cognitive/partitions/**"
      - "packages/pacta/src/cognitive/modules/**"
      - "experiments/**"
  depends_on: [Wave-0, C-1]
  parallel_with: []
  consumed_ports:
    - name: "PartitionWriteAdapter"
      status: frozen
      location: "algebra/partition-types.ts"
    - name: "TypeResolver"
      status: frozen
      location: "algebra/partition-types.ts"
    - name: "ModuleContextBinding"
      status: frozen
      location: "algebra/partition-types.ts"
    - name: "createTypeResolver"
      status: "implemented in C-1"
      location: "partitions/type-resolver.ts"
  produced_ports:
    - name: "createPartitionWriteAdapter"
  deliverables:
    - "engine/partition-write-adapter.ts — createPartitionWriteAdapter() factory"
    - "engine/__tests__/partition-write-adapter.test.ts — write routing + tracking tests"
    - "engine/cycle.ts — wire write adapter + resolveModuleContext + partitionLastWriteCycle"
    - "engine/__tests__/cycle-composition.test.ts — end-to-end partition composition tests"
  acceptance_criteria:
    - "When partitionSystem present, module writes route through EntryRouter → PartitionSystem.write() → SC-1"
    - "When partitionSystem absent, legacy WorkspaceWritePort unchanged → constraint"
    - "Module with contextBinding receives type-resolved context → SC-2"
    - "Module without contextBinding receives DEFAULT_MODULE_SELECTORS fallback → constraint"
    - "partitionLastWriteCycle updated after each module step → SC-4"
    - "Partition monitors produce correct stagnation signals → SC-4"
    - "Existing cycle-partitioned.test.ts passes → gate"
    - "npm test passes → gate"
  estimated_tasks: 7
  branch: "feat/prd045-c2-cycle-composition"
  status: pending
```

---

## Wave 3 — Module Bindings (modules/)

### C-3: Add contextBinding to Module Factories

```yaml
- id: C-3
  phase: Wave 3
  title: "Add contextBinding declarations to all module factories"
  domain: modules/
  wave: 3
  scope:
    allowed_paths:
      - "packages/pacta/src/cognitive/modules/reasoner-actor.ts"
      - "packages/pacta/src/cognitive/modules/reasoner-actor-v2.ts"
      - "packages/pacta/src/cognitive/modules/observer.ts"
      - "packages/pacta/src/cognitive/modules/monitor.ts"
      - "packages/pacta/src/cognitive/modules/evaluator.ts"
      - "packages/pacta/src/cognitive/modules/planner.ts"
      - "packages/pacta/src/cognitive/modules/reflector.ts"
      - "packages/pacta/src/cognitive/modules/reflector-v2.ts"
    forbidden_paths:
      - "packages/pacta/src/cognitive/algebra/**"
      - "packages/pacta/src/cognitive/engine/**"
      - "packages/pacta/src/cognitive/partitions/**"
      - "experiments/**"
  depends_on: [Wave-0, C-2]
  parallel_with: []
  consumed_ports:
    - name: "ModuleContextBinding"
      status: frozen
      location: "algebra/partition-types.ts"
  produced_ports: []
  deliverables:
    - "Each module factory: add contextBinding to config type, attach to returned module"
    - "Default bindings: observer=['goal'], reasoner=['goal','constraint','operational'], etc."
  acceptance_criteria:
    - "createReasonerActor() returns module with contextBinding field → SC-2"
    - "contextBinding is overridable via config parameter → SC-2"
    - "Modules created without contextBinding config have no contextBinding (fallback works) → constraint"
    - "npm run build && npm test → gate"
  estimated_tasks: 4
  branch: "feat/prd045-c3-module-bindings"
  status: pending
```

---

## Wave 4 — Experiment Migration + Validation (experiments/)

### C-4: Migrate run-slm-cycle.ts to Canonical Cycle

```yaml
- id: C-4
  phase: Wave 4
  title: "Migrate partitioned experiment conditions to canonical cycle"
  domain: experiments/
  wave: 4
  scope:
    allowed_paths:
      - "experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts"
      - "experiments/exp-slm/phase-5-cycle/src/**"
      - "experiments/exp-slm/phase-5-cycle/results/**"
      - "experiments/exp-slm/phase-5-cycle/FINDINGS.md"
      - "experiments/log/**"
    forbidden_paths:
      - "packages/**"
  depends_on: [C-2, C-3]
  parallel_with: []
  consumed_ports:
    - name: "PartitionWriteAdapter"
      status: frozen
    - name: "TypeResolver"
      status: frozen
    - name: "ModuleContextBinding"
      status: frozen
    - name: "createPartitionWriteAdapter"
      status: "implemented in C-2"
    - name: "createTypeResolver"
      status: "implemented in C-1"
  produced_ports: []
  deliverables:
    - "run-slm-cycle.ts: replace runPartitionedCognitive manual loop with canonical cycle + CycleConfig.partitionSystem"
    - "run-slm-cycle.ts: replace runPartitionedSmart manual loop similarly"
    - "Validation: T01-T06 experiment run with canonical cycle"
    - "FINDINGS.md: update with composition validation results"
    - "experiments/log/: R-20 entry"
  acceptance_criteria:
    - "partitioned-cognitive uses canonical cycle with partitions — no custom cycle loop → SC-3"
    - "partitioned-smart uses canonical cycle with partitions + write-enforcer hooks → SC-3"
    - "T01-T05 pass rate ≥ 70% with canonical cycle → SC-3"
    - "T06 produces ≥ 8 writes in 30 cycles (parity with manual wiring) → SC-3"
  estimated_tasks: 6
  branch: "feat/prd045-c4-experiment-migration"
  status: pending
```

---

## Acceptance Gates

| Gate | Source | Commission | Verification |
|------|--------|------------|-------------|
| G-PORT S-8 | PartitionWriteAdapter implements write routing | C-2 | Type check + unit test |
| G-BOUNDARY S-9 | TypeResolver maps all 3 EntryContentType values | C-1 | Unit test |
| G-BOUNDARY S-10 | ModuleContextBinding consumed by cycle | C-2 | Integration test |
| SC-1 | Writes route through partitions in cycle | C-2 | cycle-composition.test.ts |
| SC-2 | Modules declare types, not partition names | C-1, C-2, C-3 | Module factory tests + cycle test |
| SC-3 | Experiment code duplication eliminated | C-4 | Code review + experiment parity |
| SC-4 | partitionLastWriteCycle tracking works | C-2 | Stagnation signal test |

---

## Verification Report

| Gate | Status |
|------|--------|
| Single-domain commissions | **PASS** — C-1 (partitions), C-2 (engine), C-3 (modules), C-4 (experiments) |
| No wave domain conflicts | **PASS** — each wave has exactly one commission |
| DAG acyclic | **PASS** — Wave 0 → C-1 → C-2 → C-3 → C-4 (linear) |
| Surfaces enumerated | **PASS** — S-8, S-9, S-10 all frozen |
| Scope complete | **PASS** — every commission has allowed + forbidden paths |
| Criteria traceable | **PASS** — every AC maps to SC-1 through SC-4 |
| PRD coverage | **PASS** — all 4 success criteria covered |
| Task bounds | **PASS** — C-1(3), C-2(7), C-3(4), C-4(6) |
| Wave 0 non-empty | **PASS** — 3 interfaces + 1 entity change + barrel exports |
| All ports frozen | **PASS** — S-8, S-9, S-10 frozen in PRD |

**Overall: 10/10 gates pass**

## Status Tracker

```
Total: 4 commissions, 5 waves (Wave 0 + Waves 1-4)
Completed: 0 / 4
Critical path: Wave 0 → C-1 → C-2 → C-3 → C-4
Estimated effort: 8-10 days
```
