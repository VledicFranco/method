# Realization Plan — PRD 056 Smoke Test Visualization Redesign

**Session:** `fcd-plan-20260412-2129-prd-056-smoke-viz`
**PRD:** `docs/prds/056-smoke-test-viz-redesign.md`
**Methodology:** fcd-plan (surface-first commission decomposition)
**Branch base:** `feat/smoke-test-viz-redesign` (redesign branch — preserve 311d325 methodology executor work)

---

## PRD Summary

**Objective:** Evolve the smoke test UI from a flat sidebar+detail into the layer-aware visualization shown in `method-1/tmp/smoke-test-viz-mock.html`. Four-layer stack (Methodology/Method/Strategy/Agent), feature map with GAP badges, progressive disclosure, documentation-as-visualization.

**Success criteria (from PRD):**
1. Layer Stack landing page with live coverage numbers (data-driven, not hardcoded)
2. Feature Map with clusters + layer badges + GAP badges
3. Feature Detail with narrative + case card OR proposed test card
4. Method layer ≥ 5/5 features covered
5. All 4 layers ≥ 1 case; ≥ 40/47 features covered
6. Strategy-layer feature detail shows SVG DAG flow diagram
7. Playwright E2E covering all 3 views
8. Visual fidelity parity with mock HTML

**PRD decisions locked:**
- D-1: One file per layer in `cases/`; drop `category` field
- D-2: Narratives inlined in TS template literals
- D-3: `/api/features` returns everything in one blob
- D-4: Layer Stack page shows composition arrows (pedagogical core)
- D-5: No sidebar; global "Run All (mock)" button + collapsible bottom panel

---

## FCA Partition Map

This PRD scope is internal to `packages/smoke-test/`. The "domains" are sub-modules within the package — each self-contained, each with its own allowed/forbidden paths.

```
Domains (commissionable):
  - cases/      → Case registries (methodology/method/strategy/agent-cases.ts), SmokeTestCase schema consumer
  - layers/     → NEW — Layer registry (4 entries)
  - features/   → NEW — Cluster + Feature registries, narratives, computeCoverage
  - executor/   → Mock/live/methodology executors; RunFlow emission
  - fixtures/   → Strategy YAMLs + method TS modules (scope: method-fixture additions only)
  - app/        → Browser UI — skeleton, client modules, views, components, styles
  - tests/      → Playwright E2E + vitest registry invariants
  - server.ts   → HTTP + SSE server (single-file domain)

Shared surfaces (orchestrator-owned, Wave 0):
  - src/cases/index.ts — SmokeTestCase interface (modify: drop `category`)
  - src/layers/types.ts — NEW: Layer interface
  - src/features/types.ts — NEW: Cluster, Feature interfaces
  - src/executor/run-flow.ts — NEW: RunFlow interface
  - src/server.ts — HTTP route stubs for /api/layers, /api/clusters, /api/features

Layer stack (within package): L1 types → L2 registries/executor → L3 server → L4 app
```

---

## Commission Summary

| Commission | Domain | Wave | Title | Depends On | Consumed Surfaces |
|------------|--------|------|-------|------------|-------------------|
| — | — | 0 | **Surfaces & type skeletons** (orchestrator) | — | — |
| C-1 | `cases/` | 1 | Case file reorganization + category removal | W0 | `SmokeTestCase` |
| C-2 | `layers/` | 1 | Layer registry population | W0 | `Layer` |
| C-3 | `features/` | 1 | Feature + Cluster registries + coverage + tests | W0 | `Layer`, `Feature`, `Cluster` |
| C-4 | `executor/` | 1 | Mock executor RunFlow enrichment | W0 | `RunFlow` |
| C-5 | `server.ts` | 2 | HTTP endpoint wiring + startup gates | W0, C-1, C-2, C-3 | all registries |
| C-6 | `cases/` | 2 | Method layer case population | W0, C-1, C-3 | `SmokeTestCase`, feature IDs |
| C-7 | `app/` | 3 | Client foundation + Layer Stack view | W0, C-5 | HTTP API |
| C-8 | `app/` | 4 | Feature Map view + case card | W0, C-5, C-7 | HTTP API, badge, router |
| C-9 | `app/` | 5 | Feature Detail view + DAG renderer + Run All panel | W0, C-4, C-5, C-8 | HTTP API, `RunFlow`, router |
| C-10 | `tests/` | 6 | Playwright E2E for new views | all prior | — |
| — | — | 7 | **Rebase + merge** (orchestrator) | C-10 | — |

**Totals:** 10 commissions, 8 waves (incl. Wave 0 + Wave 7 orchestrator), max parallelism = 4 (Wave 1).

---

## Wave 0 — Shared Surfaces (Mandatory, Orchestrator-Applied)

> Wave 0 is applied by the orchestrator before any commission starts. It defines all TypeScript interfaces, creates empty-stub registries, and adds route stubs. No business logic — only the fabric.

### Surface 1: `Layer` interface

**File:** `packages/smoke-test/src/layers/types.ts` (new)

```typescript
export interface Layer {
  id: 'methodology' | 'method' | 'strategy' | 'agent';
  level: 'L4' | 'L3' | 'L2' | 'L1';
  name: string;
  narrative: string;
  color: string;            // CSS color token (e.g., '#c792ea')
  lifecycle: string[];      // e.g., ['methodology_list', 'methodology_start', ...]
  keyConcepts: string[];
}
```

**File:** `packages/smoke-test/src/layers/index.ts` (new)

```typescript
export type { Layer } from './types.js';
export { layerRegistry, getLayer } from './registry.js';
```

**File:** `packages/smoke-test/src/layers/registry.ts` (stub — C-2 populates)

```typescript
import type { Layer } from './types.js';
export const layerRegistry: Layer[] = [];
export function getLayer(id: Layer['id']): Layer {
  const layer = layerRegistry.find((l) => l.id === id);
  if (!layer) throw new Error(`Layer not found: ${id}`);
  return layer;
}
```

**Frozen.** Gate: `G-LAYER-REG` — consumers may only reference IDs present in `layerRegistry` (enforced via `getLayer` throwing).

### Surface 2: `Cluster` + `Feature` interfaces

**File:** `packages/smoke-test/src/features/types.ts` (new)

```typescript
import type { Layer } from '../layers/types.js';

export interface Cluster {
  id: string;
  layerId: Layer['id'];
  name: string;
  narrative: string;
  featureIds: string[];
}

export interface Feature {
  id: string;
  layerId: Layer['id'];
  clusterId: string;
  name: string;
  narrative: string;
  endpoints?: string[];
  coverage: 'covered' | 'gap';
  coveringCaseIds: string[];
  proposedTest?: {
    description: string;
    assertions: string[];
    endpoints: string[];
  };
}
```

**File:** `packages/smoke-test/src/features/index.ts` (new)

```typescript
export type { Cluster, Feature } from './types.js';
export { clusterRegistry, getCluster, clustersByLayer } from './clusters.js';
export { featureRegistry, getFeature, featuresByCluster, computeCoverage } from './registry.js';
```

**Stub files:** `clusters.ts`, `registry.ts`, `narratives.ts` created with empty arrays + function signatures. C-3 populates.

**Frozen.** Gates: `G-FEATURE-REF` (case features must exist), `G-FEATURE-COMPLETENESS` (all features get a coverage status).

### Surface 3: `SmokeTestCase` modification — drop `category`, confirm `layer`

**File:** `packages/smoke-test/src/cases/index.ts` (modify)

```typescript
import type { Layer } from '../layers/types.js';

export interface SmokeTestCase {
  id: string;
  name: string;
  description: string;
  layer: Layer['id'];            // primary grouping axis
  features: string[];            // MUST resolve against featureRegistry (enforced by G-FEATURE-REF)
  fixture: string;
  mode: 'mock' | 'live' | 'both';
  expected: SmokeExpected;
}

// SmokeExpected unchanged

export { strategyCases } from './strategy-cases.js';
export { methodologyCases } from './methodology-cases.js';
export { methodCases } from './method-cases.js';
export { agentCases } from './agent-cases.js';

import { strategyCases } from './strategy-cases.js';
import { methodologyCases } from './methodology-cases.js';
import { methodCases } from './method-cases.js';
import { agentCases } from './agent-cases.js';

export const allCases: Map<string, SmokeTestCase> = new Map([
  ...strategyCases.map((c) => [c.id, c] as const),
  ...methodologyCases.map((c) => [c.id, c] as const),
  ...methodCases.map((c) => [c.id, c] as const),
  ...agentCases.map((c) => [c.id, c] as const),
]);

// casesByCategory() REMOVED — filter by layer instead:
export function casesByLayer(layer: Layer['id']): SmokeTestCase[] {
  return [...allCases.values()].filter((c) => c.layer === layer);
}
```

**Wave 0 note:** `method-cases.ts` and `agent-cases.ts` do not yet exist. C-1 performs the file rename (`method-cases.ts` → `agent-cases.ts`) and creates an empty `method-cases.ts` stub. The orchestrator's Wave 0 changes to `index.ts` will reference files that C-1 brings into existence — the build will be briefly red between Wave 0 and C-1 completion. Acceptable as long as Wave 0 and C-1 commit together OR Wave 0 uses TEMP re-exports to bridge.

**Mitigation:** Orchestrator Wave 0 leaves existing `index.ts` with `methodCases` referring to master's current file. C-1's first task is the rename in a single commit so the build stays green.

**Frozen.** Gate: `G-FEATURE-REF` (see C-5 server startup check).

### Surface 4: `RunFlow` interface

**File:** `packages/smoke-test/src/executor/run-flow.ts` (new)

```typescript
export interface RunFlow {
  nodes: Array<{
    id: string;
    type: 'methodology' | 'script' | 'strategy' | 'semantic' | 'context-load';
    status: 'completed' | 'failed' | 'suspended' | 'skipped';
    attempts: Array<{
      attempt: number;
      output: Record<string, unknown>;
      cost_usd: number;
      duration_ms: number;
      feedback?: string;
    }>;
    artifactsProduced: string[];
    artifactsConsumed: string[];
  }>;
  gates: Array<{
    id: string;
    afterNode: string;
    type: 'algorithmic' | 'observation' | 'human-approval' | 'strategy-level';
    expression?: string;
    passed: boolean;
    evaluationDetail?: string;
    retryFeedback?: string;
  }>;
  edges: Array<{ from: string; to: string; artifact?: string }>;
  oversightEvents: Array<{ type: 'escalate' | 'warn'; trigger: string; afterNode: string }>;
}
```

**Frozen.** Gate: `G-FLOW-SCHEMA` — TypeScript compilation only. C-4 populates; C-9 renders; method/methodology cases leave it undefined (defensively handled in renderer).

### Surface 5: HTTP route stubs in `server.ts`

**File:** `packages/smoke-test/src/server.ts` (modify — add route stubs)

```typescript
// Added in Wave 0 (return empty arrays; C-5 fills in)
app.get('/api/layers', (_req, res) => res.json([]));
app.get('/api/clusters', (_req, res) => res.json([]));
app.get('/api/features', (_req, res) => res.json([]));
```

**Frozen.** C-5 replaces the stub bodies with real registry reads.

### Surface 6: Canonical export imports

**File:** Orchestrator also creates `src/layers/registry.ts`, `src/features/clusters.ts`, `src/features/registry.ts`, `src/features/narratives.ts` as empty stubs so C-2 and C-3 can edit them without creating new exports (keeps commission scope tight).

### Wave 0 Verification

- `npm run build` clean (all TypeScript compiles)
- `npm test` green — no behavior change
- `npm run smoke` green — existing Playwright runs
- `tsc --noEmit` clean
- Startup still works (server serves existing UI; new routes return `[]`)

---

## Wave 1 — Parallel Foundation (4 commissions)

### C-1: Case file reorganization + category removal

```yaml
id: C-1
phase: PRD Wave 0 (case reorg portion)
title: Rename method-cases.ts → agent-cases.ts, create method-cases.ts stub, remove category field
domain: cases/
wave: 1
scope:
  allowed_paths:
    - "packages/smoke-test/src/cases/strategy-cases.ts"
    - "packages/smoke-test/src/cases/methodology-cases.ts"
    - "packages/smoke-test/src/cases/method-cases.ts"        # new file
    - "packages/smoke-test/src/cases/agent-cases.ts"         # renamed from method-cases
  forbidden_paths:
    - "packages/smoke-test/src/cases/index.ts"               # Wave 0 owns the schema
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/app/**"
    - "packages/smoke-test/src/server.ts"
    - "packages/smoke-test/src/executor/**"
    - "packages/smoke-test/src/tests/**"
depends_on: [W0]
parallel_with: [C-2, C-3, C-4]
consumed_ports:
  - name: SmokeTestCase
    status: frozen
    location: Wave 0 — packages/smoke-test/src/cases/index.ts
produced_ports: []
tasks:
  - git mv src/cases/method-cases.ts src/cases/agent-cases.ts (or equivalent file content copy + delete)
  - Rename exported symbol `methodCases` → `agentCases` in agent-cases.ts
  - Create empty src/cases/method-cases.ts with `export const methodCases: SmokeTestCase[] = []`
  - Remove `category: 'strategy' | 'method' | 'methodology'` field from every case literal in strategy-cases.ts, methodology-cases.ts, agent-cases.ts
  - Verify `layer` field is set correctly on every case (strategy→strategy, methodology→methodology, agent cases→agent)
  - Ensure TypeScript clean + existing smoke tests still pass
acceptance_criteria:
  - All 45 existing cases compile with the new SmokeTestCase schema → PRD SC-5 (precondition)
  - `agent-cases.ts` exports `agentCases: SmokeTestCase[]` (6 cases, all layer='agent')
  - `method-cases.ts` exists with empty export
  - No `category` field anywhere in cases/
  - `npm run smoke` green
estimated_tasks: 5
branch: "feat/prd-056-c1-cases-reorg"
status: pending
```

### C-2: Layer registry population

```yaml
id: C-2
phase: PRD Wave 0 (layers portion)
title: Populate 4-entry Layer registry with narratives, lifecycles, key concepts
domain: layers/
wave: 1
scope:
  allowed_paths:
    - "packages/smoke-test/src/layers/registry.ts"
    - "packages/smoke-test/src/layers/layers.test.ts"         # optional vitest for layer invariants
  forbidden_paths:
    - "packages/smoke-test/src/layers/types.ts"               # Wave 0 owns
    - "packages/smoke-test/src/layers/index.ts"               # Wave 0 owns
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/app/**"
    - "packages/smoke-test/src/server.ts"
depends_on: [W0]
parallel_with: [C-1, C-3, C-4]
consumed_ports:
  - name: Layer
    status: frozen
    location: Wave 0 — packages/smoke-test/src/layers/types.ts
produced_ports:
  - name: layerRegistry
tasks:
  - Populate methodology layer entry (L4, purple #c792ea, lifecycle: methodology_list/start/route/select/transition/status, keyConcepts)
  - Populate method layer entry (L3, blue #82aaff, lifecycle: step_current/context/advance/validate, keyConcepts)
  - Populate strategy layer entry (L2, green #c3e88d, lifecycle: parse→validate→sort→execute→gate→store→oversight→retro)
  - Populate agent layer entry (L1, orange #f78c6c, lifecycle: createAgent→invoke→tool→validate→retry)
  - Narratives lifted verbatim from method-1/tmp/smoke-test-visualization-design.md §L4-L1
acceptance_criteria:
  - layerRegistry has exactly 4 entries, one per layer ID → PRD SC-1 (precondition)
  - All narratives ≥ 200 chars
  - tsc clean
estimated_tasks: 3
branch: "feat/prd-056-c2-layer-registry"
status: pending
```

### C-3: Feature + Cluster registries + coverage + vitest invariants

```yaml
id: C-3
phase: PRD Wave 0 (features portion)
title: Populate 10 clusters + 47 features with narratives, implement computeCoverage
domain: features/
wave: 1
scope:
  allowed_paths:
    - "packages/smoke-test/src/features/clusters.ts"
    - "packages/smoke-test/src/features/registry.ts"
    - "packages/smoke-test/src/features/narratives.ts"
    - "packages/smoke-test/src/features/registry.test.ts"
  forbidden_paths:
    - "packages/smoke-test/src/features/types.ts"             # Wave 0 owns
    - "packages/smoke-test/src/features/index.ts"             # Wave 0 owns
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/app/**"
    - "packages/smoke-test/src/server.ts"
depends_on: [W0]
parallel_with: [C-1, C-2, C-4]
consumed_ports:
  - name: Layer
    status: frozen
    location: Wave 0 — packages/smoke-test/src/layers/types.ts
  - name: Cluster
    status: frozen
    location: Wave 0 — packages/smoke-test/src/features/types.ts
  - name: Feature
    status: frozen
    location: Wave 0 — packages/smoke-test/src/features/types.ts
produced_ports:
  - name: clusterRegistry
  - name: featureRegistry
  - name: computeCoverage
tasks:
  - Populate clusterRegistry with 10 entries (2 methodology, 1 method, 4 strategy, 1 agent)
  - Populate featureRegistry with 47 features (4+4 methodology, 5 method, 5+5+4+8 strategy, 6 agent)
  - Inline feature narratives in narratives.ts as template literals (from design doc §Feature Inventory)
  - Add proposedTest blocks for any feature that will be uncovered after C-6 (mostly none — see D-1 commitment)
  - Implement computeCoverage(cases): walks each feature, finds case whose `features[]` contains feature.id, sets coverage + coveringCaseIds
  - Write registry.test.ts vitest invariants:
      - Every cluster.featureIds resolves to a real Feature
      - Every feature.layerId exists in layerRegistry
      - Every feature.clusterId exists in clusterRegistry
      - computeCoverage on a fixture case list sets coverage for every feature
acceptance_criteria:
  - 10 clusters, 47 features → PRD SC-2 (precondition)
  - All vitest invariants green
  - No feature ID collisions
  - tsc clean
estimated_tasks: 6
branch: "feat/prd-056-c3-feature-registry"
status: pending
```

### C-4: Mock executor RunFlow enrichment

```yaml
id: C-4
phase: PRD Wave 4 (DAG flow portion — decoupled from UI)
title: Populate RunFlow (nodes, gates, edges, artifacts, oversight) in mock executor output
domain: executor/
wave: 1
scope:
  allowed_paths:
    - "packages/smoke-test/src/executor/mock-executor.ts"
    - "packages/smoke-test/src/executor/mock-executor.test.ts"   # may create
  forbidden_paths:
    - "packages/smoke-test/src/executor/run-flow.ts"             # Wave 0 owns
    - "packages/smoke-test/src/executor/live-executor.ts"        # out of scope
    - "packages/smoke-test/src/executor/methodology-mock.ts"     # preserve 311d325 work
    - "packages/smoke-test/src/executor/result-checker.ts"
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/app/**"
    - "packages/smoke-test/src/server.ts"
depends_on: [W0]
parallel_with: [C-1, C-2, C-3]
consumed_ports:
  - name: RunFlow
    status: frozen
    location: Wave 0 — packages/smoke-test/src/executor/run-flow.ts
produced_ports: []
tasks:
  - Extend mock-executor return type to include `flow: RunFlow` alongside existing result fields
  - Walk parsed strategy YAML: emit RunFlow.nodes with type/status/attempts/artifacts from existing execution trace
  - Record RunFlow.gates with pass/fail, expression, retryFeedback
  - Record RunFlow.edges from parsed DAG edges (with optional artifact labels)
  - Record RunFlow.oversightEvents from existing oversight rule trace
  - Add vitest cases asserting flow shape on at least 3 fixture strategies (one gate retry, one oversight escalate, one parallel-exec)
acceptance_criteria:
  - Every strategy-layer mock execution includes a populated `flow` field → PRD SC-6 (precondition)
  - Method/methodology mock executors unchanged (flow remains undefined for those)
  - Existing strategy smoke tests still pass
  - tsc clean
estimated_tasks: 5
branch: "feat/prd-056-c4-executor-runflow"
status: pending
```

---

## Wave 2 — Server Wiring + Method Coverage (2 parallel commissions)

### C-5: HTTP endpoint wiring + startup gates

```yaml
id: C-5
phase: PRD Wave 0 (server portion)
title: Implement /api/layers|clusters|features handlers, wire computeCoverage + startup gates
domain: server.ts
wave: 2
scope:
  allowed_paths:
    - "packages/smoke-test/src/server.ts"
  forbidden_paths:
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/executor/**"
    - "packages/smoke-test/src/app/**"
    - "packages/smoke-test/src/tests/**"
depends_on: [C-1, C-2, C-3]
parallel_with: [C-6]
consumed_ports:
  - name: layerRegistry     (from C-2)
  - name: clusterRegistry   (from C-3)
  - name: featureRegistry   (from C-3)
  - name: computeCoverage   (from C-3)
  - name: allCases          (from C-1)
produced_ports: []
tasks:
  - Replace Wave 0 stub for GET /api/layers with `res.json(layerRegistry)`
  - Replace stub for GET /api/clusters with `res.json(clusterRegistry)`
  - Implement GET /api/features: call computeCoverage(allCases) on first request (or at startup), return featureRegistry with populated coverage
  - Wire startup validation: every case.features[i] exists in featureRegistry (throw if not — G-FEATURE-REF)
  - Wire startup validation: computeCoverage sets coverage on every feature (throw if any remains unset — G-FEATURE-COMPLETENESS)
  - Add regression test that curl /api/features returns all 47 entries with non-empty narratives
acceptance_criteria:
  - GET /api/layers returns 4 Layer objects → PRD SC-1
  - GET /api/clusters returns 10 Cluster objects → PRD SC-2
  - GET /api/features returns 47 Feature objects with computed coverage → PRD SC-2, SC-3
  - Server startup aborts if case registry has unknown feature tags → G-FEATURE-REF
  - tsc + smoke green
estimated_tasks: 5
branch: "feat/prd-056-c5-server-wiring"
status: pending
```

### C-6: Method layer case population

```yaml
id: C-6
phase: PRD Wave 1 (method layer coverage)
title: Populate method-cases.ts with 5+ step-DAG smoke tests
domain: cases/
wave: 2
scope:
  allowed_paths:
    - "packages/smoke-test/src/cases/method-cases.ts"
    - "packages/smoke-test/src/cases/methodology-cases.ts"   # read-only audit; may pull out misclassified method cases
    - "packages/smoke-test/src/fixtures/methods/method-*.ts" # optional new fixture files
  forbidden_paths:
    - "packages/smoke-test/src/cases/index.ts"
    - "packages/smoke-test/src/cases/strategy-cases.ts"
    - "packages/smoke-test/src/cases/agent-cases.ts"
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/app/**"
    - "packages/smoke-test/src/server.ts"
    - "packages/smoke-test/src/executor/**"
depends_on: [C-1, C-3]
parallel_with: [C-5]
consumed_ports:
  - name: SmokeTestCase  (W0)
  - name: featureRegistry (C-3) — to know which feature IDs exist
  - name: methodologyMock / methodology-lifecycle fixture (311d325 — existing)
produced_ports: []
tasks:
  - Audit methodology-cases.ts for cases tagged `layer: method` on the redesign branch; migrate them to method-cases.ts if any exist
  - Add smoke test for feature `step-current` — returns step ID, name, role, preconditions
  - Add smoke test for `step-context` — assembles prior outputs + methodology progress + method objective
  - Add smoke test for `step-advance` — moves pointer in topological order
  - Add smoke test for `step-validate` — postcondition keyword + schema validation (pass case and fail case)
  - Add smoke test for `step-preconditions` — extracts human-readable labels from predicates
  - Use existing methodology-lifecycle fixture (from 311d325) OR create a method-only fixture
acceptance_criteria:
  - method-cases.ts has ≥ 5 cases, all layer='method' → PRD SC-4
  - computeCoverage on full case set marks all 5 method features as covered → PRD SC-4, SC-5
  - All new cases pass in mock mode
estimated_tasks: 6
branch: "feat/prd-056-c6-method-cases"
status: pending
```

---

## Wave 3 — C-7: App Client Foundation + Layer Stack View

```yaml
id: C-7
phase: PRD Wave 2
title: Rewrite index.html, write client module scaffolding, render Layer Stack landing page with composition arrows
domain: app/
wave: 3
scope:
  allowed_paths:
    - "packages/smoke-test/src/app/index.html"
    - "packages/smoke-test/src/app/styles.css"
    - "packages/smoke-test/src/app/client/main.js"
    - "packages/smoke-test/src/app/client/router.js"
    - "packages/smoke-test/src/app/client/api.js"
    - "packages/smoke-test/src/app/client/components/badge.js"
    - "packages/smoke-test/src/app/client/views/layer-stack.js"
  forbidden_paths:
    - "packages/smoke-test/src/server.ts"
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/executor/**"
    - "packages/smoke-test/src/tests/**"
depends_on: [C-5]
parallel_with: []
consumed_ports:
  - name: HTTP API /api/layers, /api/clusters, /api/features (from C-5)
  - name: layerRegistry-derived coverage rollup (computed client-side from /api/features)
produced_ports: []
tasks:
  - Rewrite index.html as skeleton: <header><nav>[Layers | Features | Run All]</nav></header><main id="view-root"></main><footer id="run-all-panel" hidden></footer>
  - Write styles.css using visual language from smoke-test-viz-mock.html (layer colors, dark theme, badge shapes, typography)
  - client/api.js — fetch wrappers for /api/layers, /api/clusters, /api/features, /api/cases, /api/run/:id, /api/run-all
  - client/router.js — hash-based router (#/layers default, #/features, #/feature/:id), calls view.render + view.destroy
  - client/main.js — entrypoint: parse hash, call router
  - client/components/badge.js — layer badge (colored by layer), coverage badge (OK/GAP/PROPOSED)
  - client/views/layer-stack.js — render 4 layer rows from /api/layers with coverage rollup from /api/features; render ▼ composition arrows between rows with hover tooltips; below the stack, render per-layer documentation sections (narrative, lifecycle pills, key concepts)
acceptance_criteria:
  - `http://localhost:5180/` renders the Layer Stack page → PRD SC-1
  - All 4 layer rows visible with live coverage numbers → PRD SC-1
  - Composition arrows present between every adjacent pair with hover tooltips → PRD SC-1, D-4
  - Visual inspection against smoke-test-viz-mock.html §Layer Stack shows parity (colors, typography) → PRD SC-8
  - Navigation to #/features does not 404 (C-8 implements the target)
  - Top nav shows Run All (mock) button (C-9 wires it)
  - No console errors
estimated_tasks: 7
branch: "feat/prd-056-c7-app-foundation"
status: pending
```

---

## Wave 4 — C-8: Feature Map View + Case Card

```yaml
id: C-8
phase: PRD Wave 2 (Feature Map portion)
title: Render Feature Map with clusters, layer badges, GAP badges; reusable case card component
domain: app/
wave: 4
scope:
  allowed_paths:
    - "packages/smoke-test/src/app/client/views/feature-map.js"
    - "packages/smoke-test/src/app/client/components/case-card.js"
    - "packages/smoke-test/src/app/styles.css"               # additive CSS for new views
    - "packages/smoke-test/src/app/client/router.js"         # register route
  forbidden_paths:
    - "packages/smoke-test/src/app/index.html"
    - "packages/smoke-test/src/app/client/main.js"
    - "packages/smoke-test/src/app/client/api.js"
    - "packages/smoke-test/src/app/client/views/layer-stack.js"
    - "packages/smoke-test/src/server.ts"
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/executor/**"
    - "packages/smoke-test/src/tests/**"
depends_on: [C-7]
parallel_with: []
consumed_ports:
  - name: HTTP API /api/features, /api/clusters, /api/cases
  - name: badge component (from C-7)
  - name: router (from C-7)
produced_ports:
  - name: case-card component (reused by C-9)
tasks:
  - feature-map.js: fetch /api/features + /api/clusters; group features by cluster; render cluster header (name + narrative + layer badge + coverage count) + tile grid
  - Tile: feature name, cluster ref, coverage badge (OK/GAP), click → #/feature/:id
  - GAP badges visibly distinct (dashed red border, amber PROPOSED for features with proposedTest)
  - case-card.js: accepts a case object; renders name, layer badge, status dot, description, assertion list (empty until run), "Run" button stub (C-9 wires it)
  - styles.css: cluster grid layout, tile hover/active states
  - Register #/features route in router
acceptance_criteria:
  - Navigate to #/features → all 47 features rendered, grouped into 10 clusters → PRD SC-2
  - GAP badges visible on any uncovered features → PRD SC-2
  - Clicking a feature updates hash to #/feature/:id (target implemented in C-9)
  - case-card component exportable and used by feature detail (C-9)
  - Visual parity with smoke-test-viz-mock.html §Feature Map → PRD SC-8
estimated_tasks: 5
branch: "feat/prd-056-c8-feature-map"
status: pending
```

---

## Wave 5 — C-9: Feature Detail + DAG Renderer + Run All Panel

```yaml
id: C-9
phase: PRD Wave 3+4 (Feature Detail + DAG + Run All panel)
title: Feature Detail view with narrative + case card OR proposed test; SVG DAG renderer; Run All panel wiring
domain: app/
wave: 5
scope:
  allowed_paths:
    - "packages/smoke-test/src/app/client/views/feature-detail.js"
    - "packages/smoke-test/src/app/client/components/dag-renderer.js"
    - "packages/smoke-test/src/app/client/components/run-all-panel.js"
    - "packages/smoke-test/src/app/styles.css"
    - "packages/smoke-test/src/app/client/router.js"
    - "packages/smoke-test/src/app/index.html"           # may add mount points for run-all panel
  forbidden_paths:
    - "packages/smoke-test/src/app/client/views/layer-stack.js"
    - "packages/smoke-test/src/app/client/views/feature-map.js"
    - "packages/smoke-test/src/app/client/main.js"
    - "packages/smoke-test/src/app/client/api.js"
    - "packages/smoke-test/src/server.ts"
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/executor/**"
    - "packages/smoke-test/src/tests/**"
depends_on: [C-4, C-8]
parallel_with: []
consumed_ports:
  - name: HTTP API /api/features, /api/cases, /api/run/:id (SSE), /api/run-all (SSE)
  - name: case-card component (from C-8)
  - name: RunFlow (from C-4, via /api/run/:id SSE payload)
  - name: router (from C-7)
produced_ports: []
tasks:
  - feature-detail.js: fetch /api/features, find by ID; render narrative + cluster + layer badge; if covered → render case card for each coveringCaseIds; if gap → render amber PROPOSED card with proposedTest description/assertions/endpoints
  - Case card "Run" button: open SSE to /api/run/:id, stream RunEvents, update assertion list + DAG on arrival
  - dag-renderer.js: accept RunFlow, compute topological layout (left-to-right, parallel nodes stacked vertically), render SVG with: node rects colored per type, diamond gates with pass/fail fill, edges with optional artifact labels, oversight event markers
  - Defensively handle `flow === undefined` (method/methodology cases show a step/phase list instead)
  - run-all-panel.js: exposes show()/hide(); collapsible; renders aggregate pass/fail counts and per-case status dots as they stream
  - index.html: mount `<footer id="run-all-panel">` and initialize panel on Run All button click
  - Register #/feature/:id route
  - styles.css: feature detail layout, DAG node/gate/edge visual language, run-all panel
acceptance_criteria:
  - Navigate to #/feature/:id for a covered feature → narrative + case card with assertions → PRD SC-3
  - Navigate to a gap feature → proposed test card (amber) → PRD SC-3
  - Clicking Run on a strategy-layer case executes and shows SVG DAG with nodes, gates, edges → PRD SC-6
  - Clicking Run All (mock) in top nav streams aggregate results into the bottom panel → PRD SC-1, D-5
  - Method/methodology cases show step list instead of DAG (no crash) → PRD SC-6 (boundary)
  - Visual parity with smoke-test-viz-mock.html §Feature Detail → PRD SC-8
estimated_tasks: 8
branch: "feat/prd-056-c9-feature-detail-dag"
status: pending
```

---

## Wave 6 — C-10: Playwright E2E for New Views

```yaml
id: C-10
phase: PRD Wave 5
title: Playwright E2E spec covering Layer Stack → Feature Map → Feature Detail navigation + Run All
domain: tests/
wave: 6
scope:
  allowed_paths:
    - "packages/smoke-test/src/tests/views.spec.ts"
    - "packages/smoke-test/src/tests/smoke.spec.ts"          # may need updates if navigation changed
  forbidden_paths:
    - "packages/smoke-test/src/app/**"
    - "packages/smoke-test/src/server.ts"
    - "packages/smoke-test/src/cases/**"
    - "packages/smoke-test/src/layers/**"
    - "packages/smoke-test/src/features/**"
    - "packages/smoke-test/src/executor/**"
depends_on: [C-9]
parallel_with: []
consumed_ports: []
produced_ports: []
tasks:
  - Navigate to `/` → assert all 4 layer rows present, coverage numbers non-zero
  - Assert composition arrows visible between every adjacent layer pair
  - Navigate to #/features → assert 47 feature tiles grouped into 10 clusters
  - Assert GAP badges present on any remaining gap features (expect < 7)
  - Click a covered strategy feature → feature detail loads → click Run → assert SSE stream → DAG appears
  - Click a method feature → feature detail loads → step list visible (no DAG)
  - Click Run All (mock) → bottom panel appears → aggregate counts update
  - Verify existing smoke.spec.ts still passes (cases accessible via new navigation)
acceptance_criteria:
  - `npm run smoke` runs views.spec.ts alongside existing smoke.spec.ts → PRD SC-7
  - All new assertions green
  - Total spec runtime < 60s
estimated_tasks: 5
branch: "feat/prd-056-c10-playwright"
status: pending
```

---

## Wave 7 — Rebase + Merge (Orchestrator, No Commission)

**Orchestrator tasks:**
1. Rebase the C-1..C-10 chain onto `feat/smoke-test-viz-redesign` (preserving 311d325's methodology executor)
2. Resolve conflicts in `src/app/index.html` (redesign branch's 943-line monolith is superseded by C-7..C-9's modular version — take ours)
3. Resolve conflicts in `src/cases/methodology-cases.ts` if C-6 migrated any cases
4. Delete redesign branch's hardcoded gap HTML blocks (now data-driven)
5. Run `npm run build && npm test && npm run smoke` on the rebased branch — must be green
6. Update PRD 055 status note: UI superseded by PRD 056
7. Open PR → merge to `master`

**Acceptance:** clean history on top of 311d325, all tests green, PR merged.

---

## Surface Catalog (Consolidated)

| Surface | Type | Change | Producers | Consumers | Status | Gate |
|---------|------|--------|-----------|-----------|--------|------|
| `Layer` | interface | new | W0 | C-2, C-3, C-5, C-7 | frozen inline | G-LAYER-REG |
| `Cluster` | interface | new | W0 | C-3, C-5, C-8 | frozen inline | — |
| `Feature` | interface | new | W0 | C-3, C-5, C-8, C-9 | frozen inline | G-FEATURE-COMPLETENESS |
| `SmokeTestCase` (modified) | interface | modify (drop category) | W0 | C-1, C-5, C-6, C-8, C-9 | frozen inline | G-FEATURE-REF |
| `RunFlow` | interface | new | W0 | C-4, C-9 | frozen inline | G-FLOW-SCHEMA (tsc) |
| HTTP routes (stubs) | route | new | W0 | C-5 implements, C-7/C-8/C-9 consume | frozen inline | — |
| `layerRegistry` | export | new | C-2 | C-5 | Wave 1 produces | — |
| `clusterRegistry` | export | new | C-3 | C-5 | Wave 1 produces | — |
| `featureRegistry` | export | new | C-3 | C-5 | Wave 1 produces | — |
| `computeCoverage` | function | new | C-3 | C-5 | Wave 1 produces | — |
| `case-card` component | component | new | C-8 | C-9 | Wave 4 produces | — |

**All surfaces either frozen inline in Wave 0 or produced before their consumer's wave.** No `/fcd-surface` sessions required — all surfaces are simple enough for inline co-design.

---

## PRD Success Criteria Traceability

| PRD SC | Commission(s) | Notes |
|--------|---------------|-------|
| SC-1 Layer Stack landing with live coverage | C-2, C-5, C-7 | C-2 data, C-5 API, C-7 view |
| SC-2 Feature Map with clusters + GAP badges | C-3, C-5, C-8 | C-3 data, C-5 API, C-8 view |
| SC-3 Feature Detail narrative + covering case OR proposed test | C-3, C-5, C-9 | C-3 data, C-5 API, C-9 view |
| SC-4 Method layer ≥ 5/5 | C-6 | methodology-lifecycle fixture reuse |
| SC-5 All 4 layers ≥ 1 case; ≥ 40/47 | C-1, C-6, C-3 | C-1 preserves existing, C-6 adds method, C-3 verifies via test |
| SC-6 SVG DAG flow diagram in feature detail | C-4, C-9 | C-4 data from executor, C-9 SVG render |
| SC-7 Playwright E2E | C-10 | views.spec.ts |
| SC-8 Visual mock parity | C-7, C-8, C-9 | Human review checkpoint after each view commission |

---

## Verification Report (sigma_6)

| Gate | Status |
|------|--------|
| Single-domain commissions | PASS |
| No wave domain conflicts | PASS (C-1 cases/ in W1, C-6 cases/ in W2; C-5 server.ts in W2 parallels C-6) |
| DAG acyclic | PASS |
| Surfaces enumerated | PASS (6 surfaces) |
| Scope complete | PASS (every commission has allowed + forbidden) |
| Criteria traceable | PASS (all 8 PRD SCs mapped) |
| PRD coverage | PASS |
| Task bounds (3-8) | PASS (C-9 at 8 is tightest; C-2 at 3 is loosest) |
| Wave 0 non-empty | PASS (6 surface items) |
| All consumed ports frozen | PASS (all Wave 0 or Wave 1 produced before consumers) |

**Overall: 10/10 gates PASS.**

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Wave 0 `index.ts` schema change breaks build transiently until C-1 renames files | High | Low | Orchestrator applies W0 and C-1 in the same commit or uses TEMP re-exports |
| C-4 executor refactor requires touching strategy runner internals beyond scope | Med | Med | Scope explicitly allows mock-executor.ts only; if blocked, defer enriched flow to follow-up and ship DAG with minimal data in C-9 |
| Same-domain serialization in app/ adds 3 sequential waves | Med | Low | Waves 3-5 are small, 1 commission each; acceptable for UI coherence |
| Visual drift from mock during C-7-C-9 | High | Low | Human review checkpoint after each wave; mock HTML stays open as reference |
| Rebase conflicts against 311d325 monolithic index.html | Med | Med | Wave 7 is explicit and owns the conflict resolution |
| C-6 method fixture doesn't match feature IDs (e.g., step-preconditions unclear fixture) | Med | Low | C-3 defines the feature catalog first; C-6 implements against it |
| Critical path length (5 sequential waves for app/) | — | Low | Unavoidable for single-domain UI; total commission count still manageable |

**Critical path:** W0 → C-7 → C-8 → C-9 → C-10 (5 sequential steps)
**Parallelism peak:** Wave 1 with 4 commissions

---

## Status Tracker

- **Total commissions:** 10
- **Waves (incl. Wave 0 and Wave 7 orchestrator):** 8
- **Completed:** 0 / 10
- **In progress:** 0
- **Blocked:** 0

---

## Next Step

Execute with `/fcd-commission --orchestrate .method/sessions/fcd-plan-20260412-2129-prd-056-smoke-viz/realize-plan.md`

Or execute wave-by-wave manually:
1. Orchestrator: apply Wave 0 (inline — ~30 min)
2. Spawn C-1, C-2, C-3, C-4 as parallel sub-agents (Wave 1)
3. After Wave 1 green: spawn C-5, C-6 in parallel (Wave 2)
4. Sequential C-7 → C-8 → C-9 → C-10 (Waves 3-6)
5. Orchestrator: Wave 7 rebase + merge
