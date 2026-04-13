---
guide: 41
title: "Smoke Test Suite — Layer-Aware Visualization"
domain: smoke-test
audience: [contributors, agent-operators]
summary: >-
  End-to-end smoke tests for the method runtime organized by abstraction layer
  (Methodology / Method / Strategy / Agent). Browser UI doubles as live system
  documentation — layer stack, feature map, and feature detail with SVG DAG
  replay. Run locally or in CI.
prereqs: [1, 2]
touches:
  - packages/smoke-test/src/
  - docs/prds/055-smoke-test-suite.md
  - docs/prds/056-smoke-test-viz-redesign.md
---

# Guide 41 — Smoke Test Suite

The `@method/smoke-test` package is end-to-end coverage for the method runtime. It has two faces:

1. **A headless test runner** (`npm run smoke`) that every mock-mode case executes in CI without API keys.
2. **A browser UI** (`npm run serve` → http://localhost:5180) that renders the runtime's capabilities as a layer-first visualization — layer stack, feature map, feature detail with SVG DAG flow. The UI doubles as live documentation of what the runtime does.

Shipped in PRD 055 (test suite) and PRD 056 (layer-aware UI redesign).

## Running the tests

From the repo root:

```bash
# Build
npm --workspace=@method/smoke-test run build

# Vitest — fixture validation, registry invariants, RunFlow shape
npm --workspace=@method/smoke-test test

# Playwright — full E2E: backend run-all + browser UI navigation
npm --workspace=@method/smoke-test run smoke

# Live mode — requires ANTHROPIC_API_KEY (via 1Password or .env)
npm --workspace=@method/smoke-test run smoke:live

# Start the browser UI server (http://localhost:5180)
cd packages/smoke-test && npm run serve
```

On startup the server validates three registry gates and exits with a non-zero code if any fails:

- **G-LAYER-REG** — every layer ID referenced by a cluster, feature, or case exists in `layerRegistry`
- **G-FEATURE-REF** — every `case.features[i]` resolves to a `Feature.id`
- **G-FEATURE-COMPLETENESS** — `computeCoverage` assigns a coverage value to every feature

A clean start logs `Registry validation: OK (4 layers, N clusters, M features, K cases)`.

## The runtime in two stacks

Every smoke test case is tagged with the abstraction layer it exercises. Cases never cross layers.

The runtime has **two composition axes**, not one. The Layer Stack UI renders them side by side because treating them as a single linear chain misleads about the architecture.

### Session Stack (what an agent run looks like inside)

| Layer | Level | What it does | Executor |
|-------|-------|--------------|----------|
| **Methodology** | L4 | Selects which method to run next via routing predicates over session state | `MethodologyMock` |
| **Method** | L3 | Orders steps into a DAG; each step is `agent` (LLM) or `script` (TS) | `MethodologyMock` |
| **Agent** | L1 | Single Pacta invocation: prompt, tools, validation, retry, reflexion. Agent-tagged steps invoke this; script-tagged steps never do. | Pacta providers |

Composition: Methodology → selects → Method → orders → Step → invokes → Agent (for agent-tagged steps only). See `packages/methodts/src/method/step.ts` — `StepExecution` is a disjoint union of `agent` and `script`. **Steps never invoke strategies.**

### Orchestration Stack (what drives event-triggered pipelines)

| Layer | Level | What it does | Executor |
|-------|-------|--------------|----------|
| **Strategy** | L2 | YAML-defined DAG over methodology sessions. Nodes: `methodology`, `script`, `strategy`, `semantic`, `context-load`. Plus gates, artifact store, oversight, retros. | `runMockStrategy` |

A strategy's `methodology`-type node invokes a full methodology session (which then routes to methods and runs their steps). A `strategy`-type node invokes a sub-strategy — strategies compose recursively. See `packages/methodts/src/strategy/dag-executor.ts` and `packages/methodts/src/strategy/dag-types.ts`.

### Bridge between the stacks

Orchestration → Session: `methodology`-type strategy nodes are how the orchestration stack hands control to the session stack. No reverse direction — a methodology session never calls back into a strategy.

## Package layout

```
packages/smoke-test/src/
  app/                              Browser UI (inline ES module)
    index.html                      Skeleton + client namespaces
    styles.css                      Visual language (layer colors, dark theme)
  cases/                            Per-layer case registries
    index.ts                        SmokeTestCase schema, casesByLayer()
    methodology-cases.ts
    method-cases.ts
    strategy-cases.ts
    agent-cases.ts
  executor/
    mock-executor.ts                Strategy runner — emits enriched RunFlow
    methodology-mock.ts             Methodology + method runner
    live-executor.ts                Real Anthropic provider for live mode
    result-checker.ts               Assertion verification
    run-flow.ts                     RunFlow type (nodes/gates/edges/oversight)
  features/
    types.ts                        Cluster, Feature
    clusters.ts                     8 clusters across 4 layers
    registry.ts                     Feature catalog + computeCoverage
    narratives.ts                   Long-form feature documentation
    registry.test.ts                Invariant tests (layer/cluster/feature/case-tag integrity)
  layers/
    types.ts                        Layer
    registry.ts                     4 layer entries with narratives, lifecycle, key concepts
  fixtures/
    strategies/*.yaml               Strategy YAML fixtures (30+)
    methods/*.ts                    Method/methodology TS fixtures
  server.ts                         HTTP + SSE server with startup gates
  tests/
    smoke.spec.ts                   Playwright E2E (backend + browser UI)
    fixtures.test.ts                Fixture parse validation (vitest)
```

## The browser UI (http://localhost:5180)

Three views, hash-routed:

- **`#/layers`** — Layer Stack landing. Four layer rows with composition arrows between them (hover for tooltip). Each row shows coverage count, FCA level badge, layer narrative, lifecycle pills, and key concept pills. This is the pedagogical entry point.
- **`#/features`** — Feature Map. 8 cluster sections grouped by layer. Each tile is a feature with a coverage badge (OK / GAP / PROPOSED). Click a tile → Feature Detail.
- **`#/feature/:id`** — Feature Detail. Feature narrative, covering case cards (one per `coveringCaseIds`), and for strategy-layer cases an SVG DAG flow diagram that renders the actual execution after clicking Run. Method/methodology cases show a step-list fallback.

Top nav includes a **Run All (mock)** button that streams `/api/run-all` into a collapsible bottom panel with per-layer status dots, aggregate counts, runtime display, and a "failures only" filter.

## Adding a new smoke test case

1. **Pick a layer.** Is the feature being tested part of methodology routing, step execution, strategy DAG execution, or agent invocation? That determines which `*-cases.ts` file the case goes in.
2. **Verify the feature ID exists in the registry.** Every `case.features: string[]` entry must match a `Feature.id` in `features/registry.ts`. The server's G-FEATURE-REF gate will refuse to start otherwise.
3. **Pick or author a fixture.** Strategy cases use YAML fixtures in `fixtures/strategies/`. Method/methodology cases use TS fixtures in `fixtures/methods/`. Agent cases use method fixtures that exercise a single Pact.
4. **Write the case** as a `SmokeTestCase` literal. Include expected assertions (`expected.status`, `artifactsProduced`, `gatesPassed`, etc.).
5. **Run `npm test`.** The C-3 invariant suite catches missing feature IDs; fixture parse tests catch malformed YAML.
6. **Run `npm run smoke`.** If your case runs `mode: 'mock'`, it executes in CI. If `mode: 'live'`, it only runs under `SMOKE_LIVE=1`.

## Adding a new feature to the registry

The feature catalog is the spine of the UI. To add a new feature:

1. Pick a cluster (or add a new one in `clusters.ts`). Clusters belong to exactly one layer.
2. Append a `Feature` entry to `featureRegistry` in `registry.ts`. Required: `id`, `layerId`, `clusterId`, `name`, `narrative`, optional `endpoints` and `proposedTest`.
3. Long narratives go in `narratives.ts` as a `Record<string, string>` keyed by feature ID.
4. Add the feature ID to the corresponding cluster's `featureIds[]`.
5. Set `coverage: 'gap'` and `coveringCaseIds: []` — `computeCoverage()` overwrites these at startup based on case tags.
6. `registry.test.ts` verifies cluster/layer/feature integrity. `npm test` must stay green.

## Extending the UI

The browser UI is a single inline ES module in `index.html` split by namespace: `API`, `Badge`, `Router`, `RunAllPanel`, `LayerStackView`, `FeatureMapView`, `FeatureDetailView`, `DagRenderer`, `CaseCard`. Conventions:

- Views expose `{ render(rootEl, params), destroy() }`. Router calls `destroy()` on the outgoing view before `render()` on the incoming one.
- Components are DOM factories — they return elements ready to mount.
- No framework, no bundler. Vanilla JS + browser-native modules.
- Coverage is **never recomputed client-side** — it comes from `/api/features` as the single source of truth.
- Visual language tokens (layer colors, badge shapes) live in `styles.css` under `:root` CSS variables.

When the server grows a `/client/*` static handler, the inline module can be mechanically extracted to `src/app/client/**`. Namespace boundaries are already drawn with that in mind.

## HTTP API reference

```
GET  /                 browser UI (index.html)
GET  /styles.css       stylesheet
GET  /api/layers       Layer[]
GET  /api/clusters     Cluster[]
GET  /api/features     Feature[] (coverage precomputed at startup)
GET  /api/cases        { cases: [...], features: [...] }
GET  /api/run/:id      SSE stream of RunEvent for a single case
                       strategy-layer completions carry RunFlow for DAG rendering
GET  /api/run-all      SSE stream of aggregate RunEvent for all mock cases
```

## Related work

- **PRD 055** — Initial smoke test suite (implemented)
- **PRD 056** — Layer-aware UI redesign (implemented; supersedes 311d325's monolithic index.html)
- **Guide 14** — Bridge dashboard UI (analogous pattern at a different scale)
- **Guide 22** — Testkit getting started (mock providers used by strategy-layer cases)
- **Guide 27** — Pacta assembling agents (agent-layer cases use this)
