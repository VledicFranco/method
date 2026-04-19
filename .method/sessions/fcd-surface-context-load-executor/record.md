---
type: co-design-record
surface: "ContextLoadExecutor"
date: "2026-04-09"
owner: "@methodts/methodts"
producer: "@methodts/bridge (strategies domain)"
consumer: "@methodts/methodts (DagStrategyExecutor)"
direction: "bridge → methodts (unidirectional, pull)"
status: frozen
mode: "new"
prd: "fca-index + methodts integration (debate 2026-04-09)"
blocks: "context-load node type implementation"
---

# Co-Design Record — ContextLoadExecutor

## Context

Outcome of fcd-debate on fca-index + methodts integration (2026-04-09).
A `context-load` DAG node type allows strategy authors to pre-fetch relevant FCA
components from fca-index before downstream methodology nodes execute.
The retrieved components are stored in ArtifactStore and become available
to subsequent nodes via their declared inputs for prompt injection.

**Layer constraint:** `@methodts/methodts` (L2) cannot import `@methodts/fca-index` (L3).
This port is the boundary. The bridge adapter maps `ComponentContext → RetrievedComponent`.

## Decisions Made

1. **Separate optional port** — `ContextLoadExecutor` is injected into `DagStrategyExecutor`
   as an optional parameter (like `SubStrategySource` and `HumanApprovalResolver`).
   When `null`, context-load nodes fail with a clear error.

2. **`RetrievedComponent` is methodts-owned** — methodts defines its own minimal type
   (path, level, docText, coverageScore, score). No fca-index types cross the boundary.
   Bridge adapter maps `ComponentContext → RetrievedComponent`.

3. **`projectRoot` via `StrategyExecutorConfig`** — add `projectRoot?: string` to config.
   Bridge sets it at construction time. If absent when a context-load node executes,
   executor throws a clear error.

4. **`output_key` stores `RetrievedComponent[]`** — the result array is stored in
   ArtifactStore under `config.output_key`. Downstream nodes declare it in their `inputs:`.

## Interface

```typescript
// packages/methodts/src/strategy/dag-executor.ts

/**
 * ContextLoadExecutor — Port for executing context-load DAG nodes.
 *
 * Owner:    @methodts/methodts (defines contract)
 * Producer: bridge (ContextLoadExecutorImpl — imports @methodts/fca-index)
 * Consumer: DagStrategyExecutor (calls it for context-load nodes)
 * Direction: bridge → methodts (unidirectional, pull)
 * Co-designed: 2026-04-09
 * Status: frozen
 */
export interface ContextLoadExecutor {
  executeContextLoad(
    config: ContextLoadNodeConfig,
    projectRoot: string,
  ): Promise<ContextLoadResult>;
}

export interface ContextLoadResult {
  readonly components: RetrievedComponent[];
  readonly queryTime: number;
  readonly mode: 'discovery' | 'production';
}

export interface RetrievedComponent {
  readonly path: string;
  readonly level: string;
  readonly docText: string;
  readonly coverageScore: number;
  readonly score: number;
}

export class ContextLoadError extends Error {
  constructor(
    message: string,
    public readonly code: 'INDEX_NOT_FOUND' | 'QUERY_FAILED',
    public readonly nodeId: string,
  ) {
    super(message);
    this.name = 'ContextLoadError';
  }
}
```

```typescript
// packages/methodts/src/strategy/dag-types.ts — additions

export interface ContextLoadNodeConfig {
  readonly type: 'context-load';
  readonly query: string;
  readonly topK?: number;           // default: 5
  readonly filterParts?: readonly string[];
  readonly output_key: string;
}

// StrategyExecutorConfig extension:
//   readonly projectRoot?: string;
//   (required when strategy contains context-load nodes)
```

## Producer

- **Domain:** `@methodts/bridge` — strategies domain
- **Implementation:** `packages/bridge/src/domains/strategies/context-load-executor.ts`
- **Class:** `ContextLoadExecutorImpl`
- **Wiring:** Constructed in `StrategyExecutor` constructor (or `server-entry.ts`) with
  access to `ContextQueryPort` from the fca-index instance. Passed to `DagStrategyExecutor`
  as optional 5th constructor parameter.
- **Mapping:** Maps `ComponentContext → RetrievedComponent` (drops `parts` array and
  `id` fields not needed by consumer).

## Consumer

- **Domain:** `@methodts/methodts` — strategy domain
- **Usage:** `packages/methodts/src/strategy/dag-executor.ts` — `DagStrategyExecutor`
- **Injection:** New optional parameter in `DagStrategyExecutor` constructor:
  `contextLoadExecutor?: ContextLoadExecutor | null`
  Follows exact same pattern as `subStrategySource` and `humanApprovalResolver`.
- **Call site:** `runNodeOnce()` — new `context-load` branch calls
  `this.contextLoadExecutor.executeContextLoad(config, this.config.projectRoot)`.

## Gate Assertion

```typescript
// Add to packages/methodts/src/strategy/strategy.test.ts or a new
// packages/methodts/src/architecture.test.ts

// G-LAYER-CONTEXT-LOAD: strategy/ does not import @methodts/fca-index directly
it('methodts/strategy does not import @methodts/fca-index', () => {
  const strategyFiles = collectTsFiles(`${SRC}/strategy`);
  const violations = strategyFiles.filter(content =>
    /@method\/fca-index/.test(content)
  );
  expect(violations, 'strategy/ imports fca-index directly').toHaveLength(0);
});
```

## Wave 0 Items (before implementation)

1. Add `ContextLoadNodeConfig` to `dag-types.ts`
2. Add `ContextLoadExecutor`, `ContextLoadResult`, `RetrievedComponent`, `ContextLoadError` to `dag-executor.ts`
3. Add `projectRoot?: string` to `StrategyExecutorConfig` in `dag-types.ts`
4. Update `NodeConfig` union: `| ContextLoadNodeConfig`
5. Update `StrategyNode.type` union: `| 'context-load'`
6. Update `StrategyYaml` raw type to include `context-load` node shape
7. Add G-LAYER-CONTEXT-LOAD gate assertion

## Agreement

- Co-designed: 2026-04-09
- Frozen: 2026-04-09
- Changes require: new `/fcd-surface` session
