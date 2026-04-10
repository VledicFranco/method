# PRD 055 — Methodology Smoke Test Suite

**Status:** draft
**Date:** 2026-04-09
**Domains:** new `@method/smoke-test` (L4), consumes methodts, pacta, pacta-testkit
**Surfaces:** none (leaf consumer package)

---

## Problem

The methodology system has 35 feature categories across strategies, methodologies, and methods. Unit tests exist for individual components but there is no end-to-end smoke test that validates the full pipeline: YAML strategy definition, parse, execute, gates, artifacts, retro. DR-14 in the project card flags this as safety-net debt. The `tmp/demo-method-viz` prototype proved the concept but covers only 3 steps with zero verification.

## Constraints

- Must work offline with testkit mock providers (no real API calls) for CI
- Must support live mode with real Anthropic API for human verification
- Must not duplicate existing unit tests — smoke tests validate integration, not logic
- Playwright for automated runs; browser UI for human inspection
- New workspace package under `packages/smoke-test`

## Success Criteria

1. Every feature from the 35-category methodology inventory has at least one smoke test case
2. `npm run smoke` passes in CI without API keys (testkit mode)
3. Human can open the web app, browse all test cases by feature, and run them visually

## Scope

**IN:** Strategy DAG execution (all 5 node types), gate types (3 + strategy-level), artifact store versioning, sub-strategy invocation, oversight rules, retro generation, critical path, budget enforcement, output validation, scope contract, prompt construction, cycle detection, DAG validation, trigger system, token/cost tracking, execution state snapshots, refresh_context, method step sequences with pacta agents.

**OUT:** Registry YAML compilation (G0-G6 gates), cognitive composition operators (RFC-001 experiments), bridge HTTP route rendering (separate concern), cluster federation.

---

## Architecture

### Package structure

```
packages/smoke-test/
  package.json
  tsconfig.json
  vitest.config.ts
  playwright.config.ts
  src/
    server.ts                   # HTTP server — test case browser + runner
    app/
      index.html                # Main UI with sidebar, execution panel, verification panel
      styles.css
    fixtures/
      strategies/               # YAML strategy definitions per feature
        gate-algorithmic.yaml
        gate-observation.yaml
        gate-human-approval.yaml
        gate-retry-feedback.yaml
        gate-strategy-level.yaml
        node-methodology.yaml
        node-script.yaml
        node-strategy-sub.yaml
        node-semantic.yaml
        node-context-load.yaml
        artifact-versioning.yaml
        artifact-passing.yaml
        oversight-escalate.yaml
        oversight-warn.yaml
        parallel-execution.yaml
        refresh-context.yaml
        budget-enforcement.yaml
        output-validation.yaml
        scope-contract.yaml
        prompt-construction.yaml
        cycle-detection.yaml
        dag-validation-errors.yaml
        trigger-manual.yaml
        retro-generation.yaml
        critical-path.yaml
        full-pipeline.yaml
      methods/                  # Method step sequences
        analyse-critique-propose.ts
        multi-turn-with-tools.ts
        budget-exhaustion.ts
        output-schema-retry.ts
        context-compaction.ts
        reasoning-reflexion.ts
    cases/
      index.ts                  # TestCase registry with metadata + expected outcomes
      strategy-cases.ts
      method-cases.ts
      methodology-cases.ts
    executor/
      mock-executor.ts          # Testkit providers -> DagStrategyExecutor
      live-executor.ts          # Anthropic provider (live mode)
      result-checker.ts         # Expected vs actual verification
    tests/
      smoke.spec.ts             # Playwright: automated browser tests
      fixtures.test.ts          # Vitest: YAML fixtures parse correctly
```

### Test case model

```typescript
interface SmokeTestCase {
  id: string;
  name: string;
  category: 'strategy' | 'method' | 'methodology';
  features: string[];
  fixture: string;
  mode: 'mock' | 'live' | 'both';
  expected: {
    status: 'completed' | 'failed' | 'suspended';
    nodeStatuses?: Record<string, string>;
    artifactsProduced?: string[];
    gatesPassed?: string[];
    gatesFailed?: string[];
    oversightTriggered?: boolean;
    retroGenerated?: boolean;
    costRange?: [number, number];
    errorContains?: string;
  };
}
```

### Web app

Three-panel layout:

1. **Sidebar** — Test case browser by category (Strategy / Method / Methodology). Feature tags as filter chips. Status indicators (pass/fail/not-run).
2. **Main panel** — Pipeline diagram, step-by-step execution with streaming, per-step metrics, gate results, artifact store inspector, oversight events log, retro viewer.
3. **Verification panel** — Expected vs actual assertions. Green/red indicators. Diff for mismatches.

---

## Feature-to-Test-Case Matrix

| # | Feature | Test Case | Mode |
|---|---------|-----------|------|
| 1 | methodology node | `node-methodology` | both |
| 2 | script node | `node-script` | mock |
| 3 | strategy node (sub-invocation) | `node-strategy-sub` | mock |
| 4 | semantic node | `node-semantic` | mock |
| 5 | context-load node | `node-context-load` | mock |
| 6 | algorithmic gate | `gate-algorithmic` | mock |
| 7 | observation gate | `gate-observation` | mock |
| 8 | human_approval gate | `gate-human-approval` | mock |
| 9 | gate retry + feedback | `gate-retry-feedback` | mock |
| 10 | strategy-level gates | `gate-strategy-level` | mock |
| 11 | artifact versioning | `artifact-versioning` | mock |
| 12 | artifact passing | `artifact-passing` | mock |
| 13 | oversight: escalate | `oversight-escalate` | mock |
| 14 | oversight: warn | `oversight-warn` | mock |
| 15 | parallel execution | `parallel-execution` | mock |
| 16 | refresh_context | `refresh-context` | mock |
| 17 | budget enforcement | `budget-enforcement` | mock |
| 18 | output validation | `output-validation` | mock |
| 19 | scope contract | `scope-contract` | mock |
| 20 | prompt construction | `prompt-construction` | mock |
| 21 | cycle detection | `cycle-detection` | mock |
| 22 | DAG validation errors | `dag-validation-errors` | mock |
| 23 | trigger: manual | `trigger-manual` | mock |
| 24 | retro generation | `retro-generation` | mock |
| 25 | critical path | `critical-path` | mock |
| 26 | token tracking | `full-pipeline` | both |
| 27 | cost tracking | `full-pipeline` | both |
| 28 | execution state snapshot | `full-pipeline` | mock |
| 29 | output parsing | `full-pipeline` | mock |
| 30 | method: multi-step | `analyse-critique-propose` | both |
| 31 | method: tool use | `multi-turn-with-tools` | live |
| 32 | method: budget exhaust | `budget-exhaustion` | mock |
| 33 | method: schema retry | `output-schema-retry` | mock |
| 34 | method: context compact | `context-compaction` | live |
| 35 | method: reflexion | `reasoning-reflexion` | mock |

---

## Phase Plan

### Wave 0 — Package scaffold + fixtures
- Create `packages/smoke-test/` with package.json, tsconfig, configs
- Write 25 strategy YAML fixtures
- Write 6 method step-sequence definitions
- Write test case registry with all 35 cases and expected outcomes
- Add to workspace

### Wave 1 — Mock executor + verification engine
- `mock-executor.ts` — wires testkit into DagStrategyExecutor
- `live-executor.ts` — wires real Anthropic provider
- `result-checker.ts` — validates results against expected outcomes
- `fixtures.test.ts` — all YAML fixtures parse correctly

### Wave 2 — Web app
- Enhanced `server.ts` — test case browser, run cases via SSE
- `index.html` + `styles.css` — three-panel UI
- Pipeline visualization, artifact inspector, gate results, retro viewer
- Verification panel with assertion results

### Wave 3 — Playwright tests + CI
- `smoke.spec.ts` — browser tests for each case
- CI integration: `npm run smoke` (mock mode, no API keys)
- Live mode: `npm run smoke:live` (real API for `both`/`live` cases)

### Acceptance Gates
- All 25 mock-mode cases pass without API keys
- Web app renders all cases with correct visualization
- Playwright suite runs in < 60 seconds (mock mode)
- Every row in the feature matrix has at least one passing test

---

## Risks

1. **Mock fidelity** — Testkit providers may diverge from real behavior. Mitigated by `both`-mode cases that also run against real API.
2. **YAML fixture drift** — Strategy format evolves. Mitigated by `fixtures.test.ts` failing on parse errors.
3. **Playwright timing** — SSE streaming + timing assertions. Mitigated by `waitFor` with generous timeouts and deterministic mock responses.
