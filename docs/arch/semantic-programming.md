# Architecture: Semantic Programming Language (SPL)

Typed semantic functions that compose like FP combinators, execute via LLM agents, and return `(data, truths)` — distinguishing algorithmic verification (confidence 1.0) from semantic judgment (confidence < 1.0).

## Core Abstraction: SemanticFn

**Location:** `packages/methodts/src/semantic/fn.ts`

A tagged union of function shapes:

| Tag | Shape | Description |
|-----|-------|-------------|
| `atomic` | prompt + parse + pre/post | Single LLM call or pure transform |
| `pipeline` | first → second | Sequential composition |
| `parallel` | left ∥ right | Concurrent composition |
| `recursive` | fn + decompose + recompose + baseCase | Output-guided unfold-fold |
| `invariant` | inner + inherited predicates | Inherited constraint validation |

Every `SemanticFn<I, O>` produces `SemanticResult<O>` containing `data`, `truths` (with confidence), `status` (complete/needs_revision/blocked), and `cost`.

## Truth Tracking

**Location:** `packages/methodts/src/semantic/truth.ts`

Two verification methods:
- **Algorithmic** — deterministic gate check, predicate evaluation → confidence 1.0
- **Semantic** — LLM judgment, heuristic review → confidence < 1.0, degrades with retries

Composition: sequential confidence multiplies (worst-case chaining), parallel uses `1 - ∏(1 - p_i)`. Gates are confidence amplifiers — they convert semantic claims into algorithmic truths.

## Execution: runSemantic

**Location:** `packages/methodts/src/semantic/run.ts`

Dispatches on the tagged union. The `runAtomic` path:

1. Validate invariants (fail fast)
2. Validate preconditions (fail fast)
3. Pure function path (empty prompt → skip LLM)
4. Agent execution via `executeWithRetry()` (PRD 046)
   - execute: prompt → AgentProvider.execute → parse
   - check: postcondition evaluation
   - buildFeedback: retry note for the LLM
5. Optional structured output path (when `structuredProvider` + `schema` in config)
6. Truth reporting (postconditions + semantic confidence)

## FCA Algorithms

**Location:** `packages/methodts/src/semantic/algorithms/`

Four recursive algorithms following Fractal Component Architecture:

### explore (explore.ts)
Query-driven codebase traversal. At each level: summarize documentation, select relevant children, recurse into selected. Complexity: O(d × b_relevant). Output: `ExploreOutput { summary, selectedChildren[] }`.

### design (design.ts)
Surface-first architecture design. At each level: write draft documentation, define typed ports (Tier 1), mock architecture (Tier 2). Recurse into sub-components. Output: `DesignOutput { draftDocumentation, ports[], childDesigns[] }`.

### implement (implement.ts)
Gate-checked code generation. At each level: generate `FileArtifact[]`, run algorithmic gates (no-any, no-todos, port-substance, structure-complete). Gate failures trigger retry via postcondition mechanism. Recurse following design's sub-component structure. Output: `ImplementOutput { files[], gateResults[], childImplementations[] }`.

### review (review.ts)
Port-priority compositional review. Checks ports first (composition theorem order), then implementations. Findings sorted by criticality. Recurse into flagged children. Output: `ReviewOutput { findings[], severity, childReviews[] }`.

## SemanticNodeExecutor (PRD 046)

**Location:** `packages/methodts/src/semantic/node-executor.ts`

Port that makes SPL algorithms invocable from strategy DAG nodes:

```typescript
interface SemanticNodeExecutor {
  execute(config: SemanticNodeConfig, inputBundle: Record<string, unknown>)
    : Promise<{ output, cost_usd, duration_ms }>;
}
```

`DefaultSemanticNodeExecutor` maps algorithm names to SPL level functions via an internal registry and runs them through `runSemantic()` with an `AgentProvider` layer. Wired into `DagStrategyExecutor` at the bridge composition root.

Strategy YAML usage:

```yaml
- id: explore_code
  type: semantic
  algorithm: explore
  input_mapping: { query: search_query, path: repo_root }
  output_key: exploration
```

## Algorithmic Gate Checks

**Location:** `packages/methodts/src/gate/algorithmic-checks.ts`

Shared deterministic checks used by the implement algorithm (and available to any consumer):

- `checkNoAny` — no `any` types in port/implementation files
- `checkNoTodos` — no TODO/FIXME/STUB markers
- `checkPortSubstance` — port interfaces have typed members
- `checkStructure` — expected file kinds present
- `checkPortFreeze` — frozen ports not modified
- `checkDocumentationSections` — README has required sections

`runAlgorithmicGates()` runs all applicable checks and returns pass rate. The semantic wrapper `runGates()` in `semantic/algorithms/gate-runner.ts` converts results to Truth objects.
