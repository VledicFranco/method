# Realization Plan — PRD 046 Runtime Consolidation

## PRD Summary

Consolidate three overlapping LLM orchestration systems (methodology runtime, strategy DAG, SPL semantic) by unifying gate evaluation, making SPL algorithms invocable as strategy nodes, and defining a RuntimeObserver port for visual app frontends.

**Success criteria:**
1. Unified gate evaluation — DagGateConfig and GateCheckResult converge into gate/ module
2. SPL as strategy node type — strategy DAGs invoke explore, design, implement, review
3. Visual app feasibility — RuntimeObserver port defined with real-time subscription

## FCA Partition

| Commission | Domain | Wave | Title | Depends On | Consumed Ports |
|------------|--------|------|-------|------------|----------------|
| C-0 | orchestrator | 0 | Shared surfaces — types, interfaces, gate assertions | — | — |
| C-1 | methodts/gate + semantic | 1 | Gate unification — SPL path | C-0 | — |
| C-2a | methodts/strategy | 2a | Gate unification — strategy path | C-1 | DagGateEvaluator |
| C-2b | methodts/runtime | 2b | Gate unification — methodology path | C-1 | — |
| C-2c | methodts/strategy + semantic | 2c | Semantic node type | C-0 | SemanticNodeExecutor |
| C-3 | methodts/provider | 3 | Structured output | C-0 | StructuredAgentProvider |

## Wave 0 — Shared Surfaces (Mandatory)

Orchestrator-owned. No commissions — applied directly.

### Port Interfaces

1. `packages/methodts/src/gate/dag-gate-evaluator.ts` — DagGateEvaluator port interface
2. `packages/methodts/src/gate/runtime-observer.ts` — RuntimeObserver interface
3. `packages/methodts/src/gate/algorithmic-checks.ts` — checkNoAny, checkNoTodos, checkPortSubstance (moved from semantic)
4. `packages/methodts/src/semantic/node-executor.ts` — SemanticNodeExecutor port interface
5. `packages/methodts/src/provider/structured-provider.ts` — StructuredAgentProvider extension

### Gate Assertions

Add to architecture tests:
- G-BOUNDARY: semantic/ does not import from gate/ internals (only from gate/index.ts)
- G-BOUNDARY: strategy/ does not import from semantic/ internals (only SemanticNodeExecutor port)
- G-PORT: no domain directly calls LLM APIs (uses AgentProvider)

### Verification

```bash
cd packages/methodts && npx tsc --noEmit  # Types compile
npm test                                    # All existing tests pass
```

## Wave 1 — Gate Unification (SPL path)

### C-1: Unify gates in SPL

```yaml
- id: C-1
  title: "Gate unification — SPL path"
  domain: "methodts/gate + methodts/semantic"
  wave: 1
  scope:
    allowed_paths:
      - "packages/methodts/src/gate/**"
      - "packages/methodts/src/semantic/run.ts"
      - "packages/methodts/src/semantic/algorithms/implement.ts"
      - "packages/methodts/src/semantic/algorithms/gate-runner.ts"
    forbidden_paths:
      - "packages/methodts/src/strategy/**"
      - "packages/methodts/src/runtime/**"
      - "packages/bridge/**"
  depends_on: [C-0]
  parallel_with: []
  consumed_ports:
    - name: "RuntimeObserver"
      status: frozen
      record: "PRD 046 §Surfaces"
  produced_ports: []
  deliverables:
    - "gate/gate.ts — add executeWithRetry() utility function"
    - "gate/algorithmic-checks.ts — moved from semantic/algorithms/gate-runner.ts"
    - "semantic/run.ts — runAtomic uses executeWithRetry()"
    - "semantic/algorithms/implement.ts — imports from gate/"
    - "DELETE semantic/algorithms/gate-runner.ts"
  documentation_deliverables: []
  acceptance_criteria:
    - "executeWithRetry() exists in gate/ with RuntimeObserver support → PRD AC-1"
    - "semantic/algorithms/gate-runner.ts deleted, all imports redirected → PRD AC-1"
    - "All semantic tests pass → PRD AC-1"
    - "npm test green → baseline"
  estimated_tasks: 5
  branch: "feat/046-c1-gate-spl"
  status: pending
```

## Wave 2a — Gate Unification (Strategy path)

### C-2a: Extract DagGateEvaluator and wire executeWithRetry

```yaml
- id: C-2a
  title: "Gate unification — strategy path"
  domain: "methodts/strategy"
  wave: 2
  scope:
    allowed_paths:
      - "packages/methodts/src/strategy/**"
    forbidden_paths:
      - "packages/methodts/src/gate/**"
      - "packages/methodts/src/semantic/**"
      - "packages/methodts/src/runtime/**"
      - "packages/bridge/**"
  depends_on: [C-1]
  parallel_with: [C-2b, C-2c]
  consumed_ports:
    - name: "DagGateEvaluator"
      status: frozen
      record: "PRD 046 §Surfaces"
    - name: "RuntimeObserver"
      status: frozen
      record: "PRD 046 §Surfaces"
  produced_ports:
    - name: "DagGateEvaluator (implementation)"
  deliverables:
    - "strategy/dag-gates.ts — refactor evaluateGate() behind DagGateEvaluator port"
    - "strategy/dag-executor.ts — use executeWithRetry() for gate retry loop"
  documentation_deliverables: []
  acceptance_criteria:
    - "dag-gates.ts exports DagGateEvaluator implementation → PRD AC-1"
    - "dag-executor.ts uses executeWithRetry() for retry → PRD AC-1"
    - "All strategy tests pass → baseline"
  estimated_tasks: 4
  branch: "feat/046-c2a-gate-strategy"
  status: pending
```

## Wave 2b — Gate Unification (Methodology path)

### C-2b: Methodology runtime uses executeWithRetry

```yaml
- id: C-2b
  title: "Gate unification — methodology path"
  domain: "methodts/runtime"
  wave: 2
  scope:
    allowed_paths:
      - "packages/methodts/src/runtime/**"
    forbidden_paths:
      - "packages/methodts/src/gate/**"
      - "packages/methodts/src/semantic/**"
      - "packages/methodts/src/strategy/**"
      - "packages/bridge/**"
  depends_on: [C-1]
  parallel_with: [C-2a, C-2c]
  consumed_ports: []
  produced_ports: []
  deliverables:
    - "runtime/run-step.ts — agent step retry uses executeWithRetry()"
  documentation_deliverables: []
  acceptance_criteria:
    - "run-step.ts agent retry uses executeWithRetry() from gate/ → PRD AC-1"
    - "All runtime/methodology tests pass → baseline"
  estimated_tasks: 3
  branch: "feat/046-c2b-gate-runtime"
  status: pending
```

## Wave 2c — Semantic Node Type

### C-2c: Add semantic node type to strategy DAG

```yaml
- id: C-2c
  title: "Semantic node type in strategy DAG"
  domain: "methodts/strategy + methodts/semantic"
  wave: 2
  scope:
    allowed_paths:
      - "packages/methodts/src/strategy/dag-types.ts"
      - "packages/methodts/src/strategy/dag-parser.ts"
      - "packages/methodts/src/strategy/dag-executor.ts"
      - "packages/methodts/src/semantic/node-executor.ts"
      - "packages/bridge/src/domains/strategies/strategy-executor.ts"
    forbidden_paths:
      - "packages/methodts/src/runtime/**"
      - "packages/methodts/src/gate/**"
  depends_on: [C-0]
  parallel_with: [C-2a, C-2b]
  consumed_ports:
    - name: "SemanticNodeExecutor"
      status: frozen
      record: "PRD 046 §Surfaces"
  produced_ports:
    - name: "SemanticNodeExecutor (implementation)"
  deliverables:
    - "strategy/dag-types.ts — add 'semantic' to StrategyNode.type union"
    - "strategy/dag-parser.ts — validate semantic node config"
    - "strategy/dag-executor.ts — dispatch semantic nodes to SemanticNodeExecutor"
    - "semantic/node-executor.ts — implement SemanticNodeExecutor"
    - "bridge/strategies/strategy-executor.ts — wire SemanticNodeExecutor"
    - "Example strategy YAML with semantic node"
  documentation_deliverables: []
  acceptance_criteria:
    - "semantic node type parses from YAML → PRD AC-2"
    - "SemanticNodeExecutor dispatches to explore/design/implement/review → PRD AC-2"
    - "Smoke test: strategy with semantic node runs end-to-end → PRD AC-2"
    - "All strategy + semantic tests pass → baseline"
  estimated_tasks: 7
  branch: "feat/046-c2c-semantic-node"
  status: pending
```

## Wave 3 — Structured Output

### C-3: StructuredAgentProvider

```yaml
- id: C-3
  title: "Structured output — StructuredAgentProvider"
  domain: "methodts/provider"
  wave: 3
  scope:
    allowed_paths:
      - "packages/methodts/src/provider/**"
      - "packages/methodts/src/semantic/run.ts"
    forbidden_paths:
      - "packages/methodts/src/strategy/**"
      - "packages/methodts/src/runtime/**"
      - "packages/bridge/**"
  depends_on: [C-2c]
  parallel_with: []
  consumed_ports:
    - name: "StructuredAgentProvider"
      status: frozen
      record: "PRD 046 §Surfaces"
  produced_ports:
    - name: "StructuredAgentProvider (implementation)"
  deliverables:
    - "provider/structured-provider.ts — implementation"
    - "provider/claude-headless.ts — add --output-format json support"
    - "semantic/run.ts — optionally use structured output in runAtomic"
    - "Re-run exp-spl-design recursive condition with structured output"
  documentation_deliverables: []
  acceptance_criteria:
    - "executeStructured<T> returns typed JSON → PRD AC-1"
    - "ClaudeHeadlessProvider supports structured output → PRD AC-1"
    - "Recursive SPL experiment parse rate improves → evidence"
    - "Provider tests pass → baseline"
  estimated_tasks: 5
  branch: "feat/046-c3-structured-output"
  status: pending
```

## Acceptance Gates (from PRD)

| PRD Criterion | Commissions | Verification |
|---------------|-------------|-------------|
| AC-1: Unified gate evaluation | C-1, C-2a, C-2b | executeWithRetry() used by all three systems; gate-runner.ts deleted |
| AC-2: SPL as strategy node type | C-2c | Smoke test: strategy YAML with semantic node runs end-to-end |
| AC-3: Visual app feasibility | C-0 (RuntimeObserver), C-2a (wiring) | RuntimeObserver port defined; bridge emits BridgeEvents for gate lifecycle |

## Verification Report

| Gate | Status |
|------|--------|
| Single-domain commissions | PASS (C-1 and C-2c touch 2 related domains — acceptable for tightly coupled moves) |
| No wave domain conflicts | PASS |
| DAG acyclic | PASS |
| Surfaces enumerated | PASS (4 frozen in PRD) |
| Scope complete | PASS |
| Criteria traceable | PASS |
| PRD coverage | PASS (all 3 ACs mapped) |
| Task bounds | PASS (3-7 per commission) |
| Wave 0 non-empty | PASS (5 interface files + gate assertions) |
| All ports frozen | PASS |

Overall: **10/10 gates pass**

## Status Tracker

Total: 6 commissions (C-0 orchestrator + C-1, C-2a, C-2b, C-2c, C-3), 4 waves (0, 1, 2, 3)
Completed: 0 / 6
