# PRD 056 — Smoke Test Visualization Redesign

**Status:** draft
**Date:** 2026-04-12
**Domains:** `@methodts/smoke-test` (internal sub-module redesign — no cross-package surface changes)
**Prior art:** PRD 055 (smoke test suite, implemented); branch `feat/smoke-test-viz-redesign` commit `311d325` (starter — layer tags + methodology/method cases added)
**Design reference:** `method-1/tmp/smoke-test-viz-mock.html`, `method-1/tmp/smoke-test-visualization-design.md`, `method-1/tmp/smoke-test-methodology-gap.md`

---

## Problem

PRD 055 shipped a flat sidebar+detail UI answering one question: "did each case pass?" It hides the four-layer system architecture, has no notion of feature coverage, and offers no gap visibility. A human looking at it can check boxes but cannot build intuition for how Methodology → Method → Strategy → Agent compose, nor see which features lack smoke coverage.

The gap analysis (`smoke-test-methodology-gap.md`) exposed that master covers 0/17 methodology-layer features and 0/5 method-layer features — entire abstraction levels are blind spots. The viz mock (`smoke-test-viz-mock.html`) demonstrates a layer-first, feature-first, gap-visible alternative that doubles as live system documentation.

The redesign branch (`311d325`) made a partial start: added `layer` field to cases, added 7 methodology-layer + 6 method-layer cases (45 total), added `methodology-mock.ts` executor, and inlined a 943-line `index.html` with draft layer views. But the work stalled short of the mock's vision: the views are monolithic HTML, the feature catalog is not a first-class data model, gap proposals are hardcoded, and strategy cases still lack SVG DAG flow diagrams.

## Constraints

- Self-contained package — must not introduce new cross-package deps (smoke-test remains a leaf consumer of methodts/pacta)
- Must preserve all 45 existing cases and keep `npm run smoke` green in CI mock mode
- No UI build step — vanilla JS modules served statically, inlined CSS (current pattern)
- Browser-native modules only — no bundler, no framework
- Must be rebasable onto `feat/smoke-test-viz-redesign` without losing commit 311d325's methodology executor work
- Offline-first — no CDN fetches, no external fonts/libs
- Keep methodology-mock executor's zero-bridge-dependency property (smoke-test must not require a running bridge)

## Success Criteria

1. **Layer Stack landing page** renders all 4 abstraction layers (Methodology/Method/Strategy/Agent) with live coverage counts driven by the feature registry, not hardcoded HTML
2. **Feature Map view** groups features into clusters with layer badges, GAP badges on untested features, and cluster narratives; clicking a feature opens detail
3. **Feature Detail view** renders the feature narrative + the covering SmokeTestCase(s) with assertions, OR a data-driven "PROPOSED" test card for gap features
4. **Method layer coverage ≥ 5/5 features** (step-current, step-context, step-advance, step-validate, step-preconditions) — currently 0/5 on master, partial on redesign branch (needs verification)
5. **All 4 layers have ≥ 1 smoke test case** — total coverage ≥ 40/47 features
6. **Strategy-layer feature detail shows an SVG DAG flow diagram** rendered from the EnrichedRunEvent produced by the mock executor
7. **Playwright E2E spec** verifies navigation across Layer Stack → Feature Map → Feature Detail views and confirms GAP badges appear on uncovered features
8. **Mock HTML parity** — visual language (layer colors, badge shapes, cluster layout) matches `smoke-test-viz-mock.html` within reasonable fidelity

## Scope

**IN:**
- Feature/Cluster/Layer TypeScript registries with narratives (new module: `src/features/`)
- Three view modules (Layer Stack, Feature Map, Feature Detail) as vanilla ES modules
- Hash-based client router (`#/layers`, `#/features`, `#/feature/{id}`)
- SVG DAG renderer for strategy-layer cases
- New HTTP endpoints: `/api/layers`, `/api/clusters`, `/api/features`
- EnrichedRunEvent flow field populated by mock executor (nodes, gates, artifacts, edges, oversight)
- Method-layer case verification + gap-fill to reach 5/5
- Playwright specs for new views
- Rewrite of `packages/smoke-test/src/app/index.html` (supersedes redesign branch's monolithic version)

**OUT:**
- Live DAG execution flow replay with timeline scrubber (design doc Wave 3 — deferred to follow-up PRD)
- Agent layer gap closure (already 6/6)
- Bridge HTTP integration — smoke-test remains self-contained
- Real methodology execution against live Anthropic API for methodology cases (mock only)
- Authentication / multi-user / shared state
- Persistent run history beyond in-memory session

---

## Domain Map

Single-package redesign. "Domains" below are sub-modules within `packages/smoke-test/src/`. Each owns its artifacts, exposes a typed surface, and is verifiable in isolation.

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   layers/    │       │  features/   │◄──────│    cases/    │
│  (L4/L3/L2/L1│◄──────│  Feature +   │       │ SmokeTestCase│
│    registry) │       │  Cluster reg │       │ (+ layer tag)│
└──────┬───────┘       └──────┬───────┘       └──────┬───────┘
       │                      │                      │
       └──────────┬───────────┴──────────────────────┘
                  ▼
          ┌───────────────┐      ┌──────────────┐      ┌──────────────┐
          │   server.ts   │─────►│  executor/   │─────►│  fixtures/   │
          │ HTTP + SSE    │      │ mock / live /│      │ YAML / TS    │
          └───────┬───────┘      │ methodology  │      └──────────────┘
                  │              └──────────────┘
                  ▼
          ┌───────────────┐
          │     app/      │
          │  layer-stack  │
          │  feature-map  │
          │feature-detail │
          │ dag-renderer  │
          │   router      │
          └───────────────┘
```

**Arrow classification:**

| From → To | Status | Notes |
|-----------|--------|-------|
| `cases` → `features` (by feature ID reference) | **new** — needs feature ID contract | Feature tags on cases become refs into the feature registry |
| `features` → `layers` | **new** — needs clusterOf/layerOf lookup | Clusters belong to a layer |
| `features` → `cases` (coverage lookup) | **new** — computed at startup | Which case(s) cover each feature |
| `server.ts` → `layers/features/cases` | **new** — read-only registry exposure | JSON endpoints |
| `server.ts` → `executor/` | existing, unchanged | Current pattern preserved |
| `app/` → `server.ts` (HTTP + SSE) | extended — new endpoints | Existing run/run-all still work |
| `executor/mock` → `EnrichedRunEvent` | **new** — populate flow field | Strategy executor must emit enriched nodes/gates/edges |

---

## Surfaces (Primary Deliverable)

Wave 0 freezes these surfaces before any UI work begins. They are the co-designed contracts that let the server, the view modules, and the test suite evolve in parallel.

### Surface 1: `Layer` (registry entity)

**Owner:** `src/layers/registry.ts` | **Consumer:** `server.ts`, `app/layer-stack.js`
**Status:** frozen

```typescript
export interface Layer {
  /** Canonical ID used in case tags, cluster refs, routing */
  id: 'methodology' | 'method' | 'strategy' | 'agent';
  /** FCA level — displayed in layer stack row */
  level: 'L4' | 'L3' | 'L2' | 'L1';
  /** Display name */
  name: string;
  /** 1-2 paragraph narrative — renders in layer documentation section */
  narrative: string;
  /** CSS color token for badges, borders, stack rows */
  color: string;
  /** Ordered lifecycle operations — e.g., ['methodology_list', 'methodology_start', ...] */
  lifecycle: string[];
  /** Key concept pills displayed in the layer documentation */
  keyConcepts: string[];
}

export const layerRegistry: Layer[];
export function getLayer(id: Layer['id']): Layer;
```

**Minimality note:** Coverage stats (`X/Y features`) are NOT stored on Layer — they are computed at query time from the FeatureRegistry. Storing them would create a second source of truth that drifts.

**Gate:** G-LAYER-REG — `features/` and `cases/` may only reference layer IDs that exist in `layerRegistry`. Enforced by startup validation.

---

### Surface 2: `Cluster` (feature grouping)

**Owner:** `src/features/clusters.ts` | **Consumer:** `app/feature-map.js`
**Status:** frozen

```typescript
export interface Cluster {
  id: string;                    // e.g., 'step-execution'
  layerId: Layer['id'];          // which layer this cluster belongs to
  name: string;                  // 'Step Execution'
  narrative: string;             // cluster-level description shown above the tile grid
  featureIds: string[];          // refs into featureRegistry
}

export const clusterRegistry: Cluster[];
export function getCluster(id: string): Cluster;
export function clustersByLayer(layerId: Layer['id']): Cluster[];
```

**Inventory** (from design doc §Clusters, 10 total across 4 layers):

| Layer | Cluster | Features |
|-------|---------|----------|
| Methodology | `session-lifecycle` | session-start, methodology-list, session-status, session-isolation |
| Methodology | `routing-transition` | routing-inspection, route-evaluation, method-selection, methodology-transition |
| Method | `step-execution` | step-current, step-context, step-advance, step-validate, step-preconditions |
| Strategy | `node-types` | methodology-node, script-node, strategy-node, semantic-node, context-load-node |
| Strategy | `gates-control-flow` | algorithmic-gate, observation-gate, human-approval, gate-retry, strategy-gate |
| Strategy | `data-flow-oversight` | artifact-passing, artifact-versioning, escalate, warn |
| Strategy | `execution-engine` | parallel-exec, prompt-assembly, scope-contract, budget, output-validation, dag-validation, retro, critical-path |
| Agent | `agent-execution` | multi-step, tool-use, schema-retry, context-compaction, reflexion, budget-exhausted |

**Total: 47 features.**

---

### Surface 3: `Feature` (registry entity with coverage + proposed test)

**Owner:** `src/features/registry.ts` | **Consumer:** `server.ts`, `app/feature-map.js`, `app/feature-detail.js`
**Status:** frozen

```typescript
export interface Feature {
  /** Canonical ID — e.g., 'step-advance'. Matches existing case `features` tags. */
  id: string;
  layerId: Layer['id'];
  clusterId: Cluster['id'];
  /** Display name — e.g., 'Step Advancement' */
  name: string;
  /** 1-2 paragraph narrative explaining what this feature is and why it matters */
  narrative: string;
  /** Optional endpoint/tool list — e.g., ['step_advance'] */
  endpoints?: string[];
  /** Coverage computed at startup from the case registry */
  coverage: 'covered' | 'gap';
  /** Case IDs that reference this feature via their `features` tag */
  coveringCaseIds: string[];
  /** For gap features only — what a smoke test should verify */
  proposedTest?: {
    description: string;
    assertions: string[];
    endpoints: string[];
  };
}

export const featureRegistry: Feature[];
export function getFeature(id: string): Feature;
export function featuresByCluster(clusterId: string): Feature[];
export function computeCoverage(cases: SmokeTestCase[]): void;  // mutates feature.coverage + coveringCaseIds
```

**Minimality note:** Coverage is computed once at server startup by scanning `allCases` for each feature ID. This is the single source of truth — the UI never computes coverage independently.

**Gate:** G-FEATURE-COMPLETENESS — `computeCoverage` must populate every `Feature.coverage`. Startup fails if any feature in `featureRegistry` lacks a coverage value.

---

### Surface 4: `SmokeTestCase` (cleaned up — `category` removed, `layer` is primary axis)

**Status:** frozen (modifies partial enrichment from redesign branch 311d325)

```typescript
export interface SmokeTestCase {
  id: string;
  name: string;
  description: string;
  /** Abstraction layer — primary grouping axis */
  layer: 'methodology' | 'method' | 'strategy' | 'agent';
  /** Feature IDs — MUST match entries in featureRegistry (enforced by G-FEATURE-REF) */
  features: string[];
  /** Path to YAML fixture (strategy) or TS module (method/agent/methodology), relative to fixtures/ */
  fixture: string;
  mode: 'mock' | 'live' | 'both';
  expected: SmokeExpected;
}
```

**Change from redesign branch:** `category: 'strategy' | 'method' | 'methodology'` is **removed** (see D-1). The branch added `category` as an enum extended from master, but it duplicated `layer` semantically. Eliminating it removes a dead field and prevents drift.

**New invariant:** Every string in `features: string[]` MUST match a `Feature.id` in the registry. Enforced at startup: case registry load fails if a case references an unknown feature. This closes the loop between cases and the feature catalog.

**Gate:** G-FEATURE-REF — startup validation. No tag drift.

---

### Surface 5: HTTP API (server → app)

**Owner:** `server.ts` | **Consumer:** `app/*.js`
**Status:** frozen

```
GET  /api/layers     → Layer[]                   (new)
GET  /api/clusters   → Cluster[]                 (new)
GET  /api/features   → Feature[]                 (new — includes computed coverage + coveringCaseIds)
GET  /api/cases      → SmokeTestCase[]           (existing — enriched with layer field)
GET  /api/run/:id    → SSE stream of RunEvent    (existing — enriched with flow field for strategy)
GET  /api/run-all    → SSE stream (aggregated)   (existing, SSE requires GET)
```

**Minimality note:** Layers, clusters, and features are static — they could be served as one `/api/registry` blob. Kept separate because:
- Feature Map only needs clusters + features
- Layer Stack only needs layers
- Splitting lets the app lazy-load per view
- Trivial cost to the server

---

### Surface 6: `EnrichedRunEvent.flow` (executor → UI)

**Owner:** `src/executor/mock-executor.ts` | **Consumer:** `app/dag-renderer.js`
**Status:** frozen (schema); implementation partial — current executor does not populate flow

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

**Only strategy-layer cases populate `flow`.** Method and methodology cases leave it undefined — their feature detail shows a step/phase list instead.

**Gate:** G-FLOW-SCHEMA — TypeScript type check. No runtime validation needed; consumer (dag-renderer) defensively handles `flow === undefined`.

---

### Surface Summary

| Surface | Owner | Producer → Consumer | Status | Gate |
|---------|-------|---------------------|--------|------|
| `Layer` | `layers/` | registry → server, views | frozen | G-LAYER-REG |
| `Cluster` | `features/clusters.ts` | registry → views | frozen | — |
| `Feature` | `features/registry.ts` | registry → server, views | frozen | G-FEATURE-COMPLETENESS |
| `SmokeTestCase.layer` + `.features` | `cases/` | registry → server, views | frozen (already on branch) | G-FEATURE-REF |
| HTTP API | `server.ts` | server → app | frozen | — |
| `RunFlow` | `executor/mock-executor.ts` | executor → `dag-renderer` | frozen | G-FLOW-SCHEMA |

---

## Per-Domain Architecture

### `src/layers/` (new)
```
layers/
  registry.ts    # layerRegistry: Layer[] — 4 entries, narratives inline as template literals
  index.ts       # re-exports
```
No tests — pure data. Validated by the startup gate.

### `src/features/` (new)
```
features/
  clusters.ts    # clusterRegistry: Cluster[]
  registry.ts    # featureRegistry: Feature[] + computeCoverage()
  narratives.ts  # long-form feature narratives (template literals) — split out to keep registry.ts readable
  index.ts       # re-exports
  registry.test.ts  # vitest: all features have narratives, all cluster featureIds exist, coverage computes correctly
```

**Narrative source:** Design doc §Feature Inventory with Narratives provides most of the text. Lift verbatim for v1.

### `src/cases/` (reorganize per D-1)
Post-rename layout:
```
cases/
  index.ts              # exports + allCases map (drops `category`)
  methodology-cases.ts  # unchanged from branch 311d325 (methodology layer)
  method-cases.ts       # NEW — method (step DAG) layer cases, see Wave 1
  strategy-cases.ts     # unchanged (strategy layer)
  agent-cases.ts        # renamed from master's method-cases.ts (Pacta agent layer)
```
- Remove `category` field from `SmokeTestCase` interface and from every case literal
- Startup assertion: every `case.features[i]` exists in `featureRegistry`
- **Action:** audit method-layer cases on redesign branch (some may already be under `methodology-cases.ts` with `layer: 'method'`) and migrate into the new `method-cases.ts`; ensure 5 features covered (step-current, step-context, step-advance, step-validate, step-preconditions)

### `src/executor/` (existing — extend)
- `mock-executor.ts`: populate `RunFlow` in the emitted RunEvent (currently emits only status/artifacts/gates counts)
- `live-executor.ts`: no change (flow only needed for mock view; live mode optional)
- `methodology-mock.ts`: no change
- `result-checker.ts`: no change

### `src/app/` (rewrite)
```
app/
  index.html              # skeleton: <main id="view-root"></main>, <script type="module" src="./client/main.js"></script>
  styles.css              # visual language from mock (layer colors, badge shapes, typography)
  client/
    main.js               # entrypoint — reads hash, calls router
    router.js             # hash router: #/layers (default), #/features, #/feature/:id
    api.js                # fetch wrappers for /api/layers, /api/clusters, /api/features, /api/cases, /api/run
    views/
      layer-stack.js      # renders Layer Stack landing page from /api/layers + /api/features (coverage rollup)
      feature-map.js      # renders feature tiles grouped by layer → cluster
      feature-detail.js   # renders one feature: narrative + covering case card OR proposed test card
    components/
      dag-renderer.js     # SVG DAG renderer — consumes RunFlow
      case-card.js        # reusable case card (name, status, assertions)
      badge.js             # layer + coverage badges
```

**No framework.** Each view module exports `render(rootEl, data)` and `destroy()`. Router calls `destroy()` on the outgoing view before `render()` on the next.

**DAG renderer:** left-to-right topological layout. Node types colored per design doc §Visual Language. Gates as diamonds with pass/fail fill. Edges as straight or orthogonal lines with optional artifact labels. No animation in v1.

### `src/server.ts` (extend)
- Add handlers for `/api/layers`, `/api/clusters`, `/api/features`
- On startup: call `computeCoverage(allCases)` to populate feature coverage
- Startup validation: assert `G-LAYER-REG`, `G-FEATURE-REF`, `G-FEATURE-COMPLETENESS` pass; exit with error if any fail

### `src/tests/` (extend)
```
tests/
  smoke.spec.ts            # existing — run every case in mock mode
  views.spec.ts            # NEW — Playwright navigation tests:
                           #   - Layer Stack renders all 4 layers with coverage numbers
                           #   - Feature Map groups features by cluster, shows GAP badges
                           #   - Click feature → Feature Detail loads
                           #   - Covered feature shows case card; gap feature shows proposed test
                           #   - Back navigation works
  registry.spec.ts         # NEW — vitest: feature/cluster/layer invariants
```

---

## Phase Plan

### Wave 0 — Surfaces, Registries, Case Reorganization (prerequisite for all UI work)

**Deliverables:**
1. **Case file reorganization (D-1):**
   - Rename master's `src/cases/method-cases.ts` → `src/cases/agent-cases.ts` (content unchanged; it's Pacta agent cases)
   - Create empty `src/cases/method-cases.ts` stub (populated in Wave 1)
   - Remove `category` field from `SmokeTestCase` interface and all case literals
   - Update `index.ts` exports + `allCases` map
2. `src/layers/registry.ts` — 4 Layer entries with full narratives (lifted from design doc)
3. `src/features/clusters.ts` — 10 Cluster entries
4. `src/features/registry.ts` — 47 Feature entries with `id`, `layerId`, `clusterId`, `name`, `endpoints`, `proposedTest` for gaps
5. `src/features/narratives.ts` — long-form narrative text as template literals (D-2)
6. TypeScript interfaces frozen and exported
7. Startup gates wired into `server.ts`: G-LAYER-REG, G-FEATURE-REF, G-FEATURE-COMPLETENESS
8. `src/features/registry.test.ts` — vitest invariants:
   - Every cluster's `featureIds` resolve to real features
   - Every case's `features` resolve to real feature IDs
   - Every layer referenced by a cluster/feature/case exists
   - `computeCoverage` marks every feature as `'covered'` or `'gap'`

**Acceptance:**
- `tsc` clean — no `category` references remain
- Startup gates pass with current case set
- `npm run smoke` still green (tests run against the renamed + reorganized case files)
- No UI changes yet

**Estimate:** 1-2 sessions.

### Wave 1 — Method Layer Coverage Completion

**Deliverables:**
1. Audit redesign branch's method-layer cases (from 311d325's `methodology-cases.ts` under `layer: method`)
2. If any of {step-current, step-context, step-advance, step-validate, step-preconditions} lack a case, add one using the existing `methodology-lifecycle.ts` fixture or a new method-only fixture
3. Verify all 5 method-layer features have `coverage: 'covered'` after `computeCoverage`

**Acceptance:**
- 5/5 method features covered
- All cases pass in mock mode
- Coverage report shows ≥ 40/47 features

**Estimate:** 1 session.

### Wave 2 — Layer Stack + Feature Map Views

**Deliverables:**
1. Rewrite `src/app/index.html` as skeleton with top nav (logo, view links, **Run All (mock) button** per D-5)
2. `client/main.js`, `client/router.js`, `client/api.js`
3. `client/views/layer-stack.js` — 4 layer rows with coverage numbers, composition arrows between rows (D-4), scroll-to-layer-doc sections below the stack
4. `client/views/feature-map.js` — tiles grouped by cluster, layer badges, GAP badges, cluster narratives
5. `client/components/badge.js` — reusable layer + coverage badges
6. `client/components/run-all-panel.js` — collapsible bottom panel consuming `/api/run-all` SSE
7. `styles.css` — visual language matching mock (layer colors, badge shapes, dark theme)

**Acceptance:**
- Navigate to `http://localhost:5180/` → Layer Stack renders with 4 rows, coverage numbers, and composition arrows between all adjacent layers
- Arrows have hover tooltips describing the relationship (e.g., "Methodology selects which Method to run next")
- Click "Feature Map" → grid renders with all 47 features correctly grouped
- GAP badges visible on any remaining uncovered features
- Top nav "Run All (mock)" button triggers the existing `/api/run-all` stream; bottom panel shows aggregate pass/fail counts
- Visual inspection against `smoke-test-viz-mock.html` — colors, badges, typography align

**Estimate:** 2 sessions.

### Wave 3 — Feature Detail View

**Deliverables:**
1. `client/views/feature-detail.js` — narrative + covering case list OR proposed test card
2. `client/components/case-card.js` — case name, status dot, assertions, run button (reuses existing /api/run)
3. Route: `#/feature/{featureId}`
4. Back navigation to Feature Map preserving scroll position

**Acceptance:**
- Click any covered feature → detail shows narrative + case card
- Click any gap feature → detail shows "PROPOSED" amber card with description + assertions
- Run button on case card triggers existing SSE execution and displays result

**Estimate:** 1-2 sessions.

### Wave 4 — Strategy DAG Flow Rendering

**Deliverables:**
1. Extend `mock-executor.ts` to populate `RunFlow` in emitted RunEvents — walk the parsed strategy YAML, record nodes/gates/edges/artifacts/oversight as they execute
2. `client/components/dag-renderer.js` — SVG renderer, left-to-right topological layout, colored nodes, diamond gates, artifact edge labels
3. Embed DAG renderer in `feature-detail.js` for strategy-layer cases with a flow
4. Handle `flow === undefined` gracefully (method/methodology cases show a step list instead)

**Acceptance:**
- Open any strategy-layer feature detail, run the case → SVG DAG appears below assertions
- All 5 node types and all 4 gate types render correctly
- At least one example shows a failed gate (red) and a retry feedback badge
- Method/methodology feature details remain unaffected

**Estimate:** 2 sessions.

### Wave 5 — Playwright E2E Coverage

**Deliverables:**
1. `tests/views.spec.ts` — full navigation spec
2. Verify Wave 2/3/4 features
3. CI-green in mock mode

**Acceptance:**
- `npm run smoke` runs the new spec alongside the existing one
- All assertions green
- Spec runs in ~30s

**Estimate:** 1 session.

### Wave 6 — Merge & Cleanup

**Deliverables:**
1. Rebase onto `feat/smoke-test-viz-redesign` (preserving 311d325's methodology executor work)
2. Resolve conflicts in `index.html` (redesign branch's monolithic version is superseded)
3. Delete redesign branch's hardcoded-gap HTML blocks
4. Update PRD 055 status note referencing PRD 056 as UI supersession
5. Merge to master

**Acceptance:**
- Single coherent branch with Wave 0-5 on top of 311d325 methodology work
- Clean history, no dead code
- CI green

**Estimate:** 1 session.

**Total: ~9-11 sessions.**

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Redesign branch's 943-line monolithic `index.html` has useful layout not captured in the mock | Med | Low | Extract visual cues before rewriting; commit 311d325 stays in history |
| Feature narratives in TS template literals bloat the bundle (~50 features × 2 paragraphs) | Low | Low | Split into `narratives.ts`; vanilla modules tree-shake naturally via browser module loading; worst case ~40KB gzipped |
| `mock-executor.ts` can't easily populate `RunFlow` without deep changes to the strategy runner | Med | Med | Start with node/gate status only (the existing data); add edges and oversight incrementally. If blocked, defer DAG renderer to follow-up PRD |
| Method layer's 5 features have ambiguous boundaries with methodology layer (step_current lives in both conceptually) | Low | Low | Design doc §Feature Inventory already resolved this — step operations are method-layer. Follow the doc |
| Browser-native ES modules break on old Playwright browsers | Low | Low | Playwright uses modern Chromium; no action needed |
| Visual fidelity drift from the mock HTML during implementation | High | Low | Keep mock HTML open as visual reference during Wave 2; human review after Wave 2 before proceeding |
| Rebase conflicts against redesign branch | Med | Med | Wave 6 is explicit and gets full session budget |

---

## Decisions (resolved 2026-04-12)

### D-1 — One file per layer; drop `category`

**Problem:** Master's `method-cases.ts` contains Pacta agent cases (multi-step, tool-use, schema-retry, …) — the file name is a historical accident from the pre-layer category model. Keeping it under that name while adding a *real* method-layer (step DAG) case file would be catastrophically confusing.

**Decision:** Reorganize case files to one-per-layer. File name IS the layer.

```
src/cases/
  methodology-cases.ts    # 7 cases (from redesign branch 311d325)
  method-cases.ts         # NEW — step DAG features (renamed role); see Wave 1
  strategy-cases.ts       # 26 cases (unchanged)
  agent-cases.ts          # NEW NAME — 6 cases (renamed from method-cases.ts)
  index.ts                # re-exports, drops `category` field from SmokeTestCase
```

**Rationale:** `layer` is already the primary grouping. `category` is a parallel axis that now encodes nothing — its values (`'strategy' | 'method' | 'methodology'`) were fighting `layer` since 311d325. Removing it eliminates a dead field and makes file placement unambiguous. Wave 0 performs the rename; all subsequent waves work on the clean layout.

**Impact on surfaces:** `SmokeTestCase.category` is removed — this is a schema change, but smoke-test is a leaf package with no external consumers, so blast radius is zero.

### D-2 — Feature narratives inlined in TS

**Decision:** Narratives live as template literals in `src/features/narratives.ts`. No markdown loader, no build step.

**Rationale:** Total narrative payload is ~40KB for 47 features. Adding a markdown loader for v1 adds a file I/O port, a parse step, and a build/runtime coupling the package doesn't currently have. FCD rule: don't build for hypothetical scale. If narratives exceed ~200KB or require rich formatting (tables, code blocks), extract in a follow-up.

### D-3 — `/api/features` returns everything in one payload

**Decision:** Single response with full feature catalog including narratives, endpoints, coverage, coveringCaseIds, and proposedTest.

**Rationale:** ~40KB is trivial on localhost. Lazy-loading per feature would force the client router to manage a per-feature fetch state and a cache — state complexity for zero user-perceptible benefit. Composition theorem: port correctness > interface clarity > architecture quality. The simplest correct port is the whole blob.

### D-4 — Layer Stack page shows composition arrows

**Decision:** The landing page renders the 4 layer rows WITH vertical composition arrows between them (`▼ selects/invokes`), exactly as the mock shows. This is part of Wave 2.

**Rationale:** The whole point of the redesign is layer pedagogy. The arrows ARE the pedagogy — they encode that Methodology selects Method, Method orders Step, Step invokes Strategy, Strategy invokes Agent. Removing them would ship a pretty list, not a diagram.

**Wave 2 acceptance addition:** "Composition arrows visible between all 4 layer rows with hover tooltips showing the relationship (e.g., 'Methodology selects which Method to run next')."

### D-5 — Sidebar execution panel is removed; run affordances live on cards + a global Run All

**Decision:** No sidebar. Running a single case happens from the case card inside Feature Detail. Running everything happens from a persistent "Run All (mock)" button in the top nav, which streams aggregate results into a collapsible panel at the bottom of whichever view is active.

**Rationale:** The sidebar+detail pattern was the thing we're redesigning away from — preserving it half-heartedly would undermine the layer-first structure. But humans still need a fast "am I green?" signal without clicking through 47 features. The global Run All button is that signal.

**Wave 3 acceptance addition:** "Top nav exposes a 'Run All (mock)' button; clicking it triggers the existing `/api/run-all` SSE stream and shows aggregate pass/fail counts in a collapsible bottom panel."

---

## References

- PRD 055 — Smoke Test Suite (prior art, implemented)
- `method-1/tmp/smoke-test-viz-mock.html` — visual target
- `method-1/tmp/smoke-test-visualization-design.md` — full design doc with feature inventory and narratives
- `method-1/tmp/smoke-test-methodology-gap.md` — motivation / gap analysis
- Branch `feat/smoke-test-viz-redesign` commit 311d325 — starter work (methodology executor, layer tags)
- `docs/fractal-component-architecture/` — FCA specification
- Design methodology: fcd-design (surface-first PRD authoring)
