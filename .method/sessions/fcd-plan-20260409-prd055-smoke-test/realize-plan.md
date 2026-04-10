# Realization Plan — PRD 055: Methodology Smoke Test Suite

## PRD Summary

New `@method/smoke-test` package (L4) — web app + Playwright test suite validating all 35 features of the strategy, methodology, and method abstractions.

**Success criteria:**
1. Every feature from the 35-category inventory has at least one smoke test case
2. `npm run smoke` passes in CI without API keys (testkit mock mode)
3. Human can open the web app, browse all test cases, and run them visually

## FCA Partition

Single new package. All commissions are same-domain, sequential.

| Commission | Domain | Wave | Title | Depends On | Tasks |
|------------|--------|------|-------|------------|-------|
| C-1 | smoke-test | 0 | Package scaffold + YAML fixtures | — | 5 |
| C-2 | smoke-test | 1 | Mock/live executor + verification engine | C-1 | 5 |
| C-3 | smoke-test | 2 | Web app (3-panel test browser) | C-2 | 6 |
| C-4 | smoke-test | 3 | Playwright test suite + CI | C-3 | 4 |

## Wave 0 — Package Scaffold + Fixtures

No shared surface changes (leaf consumer package). Wave 0 creates the package and all test fixtures.

### Consumed Ports (all existing, frozen)
- `DagStrategyExecutor` — `@method/methodts/strategy/dag-executor.js`
- `parseStrategyYaml` — `@method/methodts/strategy/dag-parser.js`
- `createAgent` / `AgentProvider` — `@method/pacta`
- `RecordingProvider` / `MockToolProvider` — `@method/pacta-testkit`
- `anthropicProvider` — `@method/pacta-provider-anthropic`

### Verification
- `npm run build` passes with new package in workspace
- `npx tsc --noEmit` clean

## Commission Cards

---

### C-1: Package scaffold + strategy YAML fixtures

```yaml
id: C-1
phase: Wave 0
title: "Package scaffold + 25 strategy YAML fixtures + 6 method sequences"
domain: smoke-test
wave: 0
scope:
  allowed_paths:
    - "packages/smoke-test/**"
    - "package.json"          # workspace registration
  forbidden_paths:
    - "packages/methodts/**"
    - "packages/pacta/**"
    - "packages/bridge/**"
depends_on: []
parallel_with: []
consumed_ports:
  - name: "StrategyYaml (type)"
    status: frozen
    source: "@method/methodts/strategy/dag-types.js"
produced_ports: []
deliverables:
  - "packages/smoke-test/package.json"
  - "packages/smoke-test/tsconfig.json"
  - "packages/smoke-test/vitest.config.ts"
  - "packages/smoke-test/playwright.config.ts"
  - "packages/smoke-test/src/fixtures/strategies/*.yaml (25 files)"
  - "packages/smoke-test/src/fixtures/methods/*.ts (6 files)"
  - "packages/smoke-test/src/cases/index.ts"
  - "packages/smoke-test/src/cases/strategy-cases.ts"
  - "packages/smoke-test/src/cases/method-cases.ts"
acceptance_criteria:
  - "package.json lists correct dependencies → PRD AC-1"
  - "All 25 strategy YAML fixtures parse without errors via methodts parser → PRD AC-1"
  - "Test case registry covers all 35 features → PRD AC-1"
  - "npm run build includes smoke-test package → PRD AC-2"
estimated_tasks: 5
branch: "feat/055-smoke-c1-scaffold"
status: pending
```

**Tasks:**
1. Create package.json with deps: methodts, pacta, pacta-testkit, pacta-provider-anthropic, vitest, playwright
2. Create tsconfig.json, vitest.config.ts, playwright.config.ts
3. Write 25 strategy YAML fixtures (one per strategy feature from the matrix)
4. Write 6 method step-sequence fixture files
5. Write test case registry (cases/index.ts, strategy-cases.ts, method-cases.ts) with SmokeTestCase definitions and expected outcomes

---

### C-2: Mock/live executor + verification engine

```yaml
id: C-2
phase: Wave 1
title: "Mock/live executor wiring + result verification + fixture parse tests"
domain: smoke-test
wave: 1
scope:
  allowed_paths:
    - "packages/smoke-test/**"
  forbidden_paths:
    - "packages/methodts/**"
    - "packages/pacta/**"
    - "packages/bridge/**"
depends_on: [C-1]
parallel_with: []
consumed_ports:
  - name: "DagStrategyExecutor"
    status: frozen
    source: "@method/methodts/strategy/dag-executor.js"
  - name: "RecordingProvider"
    status: frozen
    source: "@method/pacta-testkit"
  - name: "anthropicProvider"
    status: frozen
    source: "@method/pacta-provider-anthropic"
produced_ports: []
deliverables:
  - "packages/smoke-test/src/executor/mock-executor.ts"
  - "packages/smoke-test/src/executor/live-executor.ts"
  - "packages/smoke-test/src/executor/result-checker.ts"
  - "packages/smoke-test/src/tests/fixtures.test.ts"
acceptance_criteria:
  - "mock-executor runs a strategy YAML fixture end-to-end without API calls → PRD AC-2"
  - "result-checker validates expected vs actual for all assertion types → PRD AC-1"
  - "All 25 YAML fixtures parse correctly (fixtures.test.ts) → PRD AC-1"
  - "live-executor runs with real Anthropic API when ANTHROPIC_API_KEY set → PRD AC-3"
estimated_tasks: 5
branch: "feat/055-smoke-c2-executor"
status: pending
```

**Tasks:**
1. mock-executor.ts — wire RecordingProvider + MockToolProvider into DagStrategyExecutor with scripted responses per fixture
2. live-executor.ts — wire anthropicProvider into DagStrategyExecutor (gated on ANTHROPIC_API_KEY)
3. result-checker.ts — compare StrategyExecutionResult against SmokeTestCase.expected (status, nodes, gates, artifacts, oversight, retro, cost)
4. fixtures.test.ts — vitest: load and parse every YAML fixture, assert no parse errors
5. Integration test: run `node-methodology` fixture through mock-executor, verify result-checker passes

---

### C-3: Web app (3-panel test browser)

```yaml
id: C-3
phase: Wave 2
title: "Web app with test case browser, execution visualization, verification panel"
domain: smoke-test
wave: 2
scope:
  allowed_paths:
    - "packages/smoke-test/**"
  forbidden_paths:
    - "packages/methodts/**"
    - "packages/pacta/**"
    - "packages/bridge/**"
depends_on: [C-2]
parallel_with: []
consumed_ports: []
produced_ports: []
deliverables:
  - "packages/smoke-test/src/server.ts"
  - "packages/smoke-test/src/app/index.html"
  - "packages/smoke-test/src/app/styles.css"
acceptance_criteria:
  - "Server starts and serves UI on configured port → PRD AC-3"
  - "Sidebar lists all 35 test cases organized by category → PRD AC-3"
  - "Feature tag filtering works → PRD AC-3"
  - "Running a mock test case shows pipeline, streaming output, metrics → PRD AC-3"
  - "Gate results display with pass/fail indicators → PRD AC-3"
  - "Verification panel shows expected vs actual with green/red → PRD AC-3"
estimated_tasks: 6
branch: "feat/055-smoke-c3-webapp"
status: pending
```

**Tasks:**
1. server.ts — HTTP server with SSE endpoints: GET / (UI), GET /cases (list), GET /run/:id (execute + stream), GET /run/:id?live=true (live mode)
2. index.html — three-panel layout: sidebar, execution, verification
3. Sidebar — test case browser by category with feature tag chips and status indicators
4. Execution panel — pipeline diagram (reuse demo-method-viz pattern), streaming output, per-step metrics, gate results, artifact inspector
5. Verification panel — expected vs actual assertions, green/red, diff view
6. styles.css — dark theme matching demo-method-viz visual language

---

### C-4: Playwright test suite + CI integration

```yaml
id: C-4
phase: Wave 3
title: "Playwright automated browser tests + npm run smoke CI command"
domain: smoke-test
wave: 3
scope:
  allowed_paths:
    - "packages/smoke-test/**"
    - "package.json"          # add smoke script
  forbidden_paths:
    - "packages/methodts/**"
    - "packages/pacta/**"
    - "packages/bridge/**"
depends_on: [C-3]
parallel_with: []
consumed_ports: []
produced_ports: []
deliverables:
  - "packages/smoke-test/src/tests/smoke.spec.ts"
  - "Root package.json — add npm run smoke + npm run smoke:live scripts"
acceptance_criteria:
  - "npm run smoke runs all mock-mode cases via Playwright, exits 0 → PRD AC-2"
  - "npm run smoke:live runs both/live cases with real API → PRD AC-3"
  - "Each of 35 features has at least one passing test → PRD AC-1"
  - "Full mock suite completes in < 60 seconds → PRD AC-2"
estimated_tasks: 4
branch: "feat/055-smoke-c4-playwright"
status: pending
```

**Tasks:**
1. smoke.spec.ts — Playwright tests: start server, for each mock-mode case: navigate, run, wait for completion, verify assertions panel shows all green
2. Live mode tests — separate describe block for `both`/`live` cases, skipped when no ANTHROPIC_API_KEY
3. Root package.json — add `"smoke": "cd packages/smoke-test && npx playwright test"`, `"smoke:live": "SMOKE_LIVE=1 cd packages/smoke-test && npx playwright test"`
4. CI verification — run full mock suite, assert < 60s, assert all 35 feature rows covered

---

## Verification Report

| Gate | Status |
|------|--------|
| Single-domain | PASS (all C-1..C-4 in smoke-test) |
| No wave conflicts | PASS (sequential, same domain) |
| DAG acyclic | PASS (linear: C-1→C-2→C-3→C-4) |
| Surfaces enumerated | PASS (no new surfaces — leaf consumer) |
| Scope complete | PASS (allowed + forbidden on each card) |
| Criteria traceable | PASS (each AC maps to PRD AC-1/2/3) |
| PRD coverage | PASS (all 3 success criteria mapped) |
| Task bounds | PASS (4-6 tasks per commission) |
| Wave 0 non-empty | PASS (package scaffold + 31 fixture files) |
| All ports frozen | PASS (all consumed ports are existing public APIs) |

**Overall: 10/10 gates pass**

## Status Tracker

Total: 4 commissions, 4 waves
Completed: 0 / 4
