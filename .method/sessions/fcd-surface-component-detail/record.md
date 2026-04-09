---
type: co-design-record
surface: "ComponentDetailPort"
date: "2026-04-09"
owner: "fca-index"
producer: "fca-index"
consumer: "mcp"
direction: "fca-index → mcp"
status: frozen
mode: "new"
---

# Co-Design Record — ComponentDetailPort

## Context

Surface co-designed as part of Feature Set B (context_detail tool) per the fca-index features
protocol at `tmp/agent-protocol-fca-index-features.md`.

## Decisions Made

### 1. `filePath` in parts — relative to projectRoot
Consistent with `ComponentContext.path` in the existing `ContextQueryPort`. All paths in
fca-index are relative to projectRoot. Absolute paths would couple consumers to the host
filesystem layout and break portability.

### 2. Single path only (no batch)
The MCP tool surface is single-call. Batch support is not needed by any current consumer.
Per the consumer-usage minimality principle: add batch when a consumer needs it.

### 3. Error behavior for unknown path — throw, not null
`null` return is ambiguous (is it "not found" or "store error"?). `ComponentDetailError` with
`code: 'NOT_FOUND'` gives callers a specific error class to catch. Consistent with
`ContextQueryError` in the existing port.

### 4. IndexStorePort extension — `getByPath` method
`ComponentDetailEngine` needs to look up a single entry by path. The frozen `IndexStorePort`
(frozen 2026-04-08) does not have this method. Adding `getByPath` is treated as a
WARN-LEGACY extension: it is added to the interface and documented as tech debt pending
a formal co-design session extension of the IndexStorePort record.

## Interface

```typescript
/**
 * ComponentDetailPort — Port for full component detail retrieval from an FCA-indexed project.
 *
 * Owner:     @method/fca-index
 * Consumer:  @method/mcp (context_detail tool handler)
 * Direction: fca-index → mcp (unidirectional)
 * Co-designed: 2026-04-09
 * Status:    frozen
 */
export interface ComponentDetailPort {
  /**
   * Retrieve full detail for a single indexed component by its path.
   * Throws ComponentDetailError with code 'NOT_FOUND' if the path is not in the index.
   */
  getDetail(request: ComponentDetailRequest): Promise<ComponentDetail>;
}

export interface ComponentDetailRequest {
  /** Path relative to projectRoot. Must match exactly how it was indexed. */
  path: string;
  /** Absolute path to the project root. */
  projectRoot: string;
}

export interface ComponentDetail {
  /** Path relative to projectRoot. */
  path: string;
  /** FCA level of this component. */
  level: FcaLevel;
  /**
   * All FCA parts present for this component.
   * filePath is relative to projectRoot (consistent with ComponentContext.path).
   */
  parts: Array<{
    part: FcaPart;
    filePath: string;
    excerpt?: string;
  }>;
  /** Full concatenated documentation text as stored in the index. */
  docText: string;
  /** ISO 8601 timestamp of last index update. */
  indexedAt: string;
}

export class ComponentDetailError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'INDEX_NOT_FOUND' | 'LOOKUP_FAILED',
  ) {
    super(message);
    this.name = 'ComponentDetailError';
  }
}
```

## Producer
- **Domain:** fca-index
- **Implementation:** `packages/fca-index/src/query/component-detail-engine.ts`
- **Wiring:** Injected via `FcaIndex` facade from `factory.ts`; receives `IndexStorePort`

## Consumer
- **Domain:** mcp
- **Usage:** `packages/mcp/src/context-tools.ts` — `context_detail` tool handler
- **Injection:** Passed via `createContextTools()` factory function parameter

## IndexStorePort Extension (WARN-LEGACY)

The implementation requires a `getByPath` lookup method on `IndexStorePort`. Since
`IndexStorePort` is frozen (2026-04-08), this is added with a WARN-LEGACY marker:

```typescript
/**
 * Retrieve a single entry by its path within a project.
 * Returns null if no entry exists for the given path.
 *
 * WARN-LEGACY: Added 2026-04-09 to support ComponentDetailPort.
 * Not in the original frozen record. Formal extension session pending.
 */
getByPath(path: string, projectRoot: string): Promise<IndexEntry | null>;
```

Tech debt: schedule a formal `/fcd-surface` extension session for `IndexStorePort` to freeze
the `getByPath` addition.

## Gate Assertion

```typescript
// G-BOUNDARY-DETAIL: component-detail-engine.ts does not import cli/ or mcp/ directly
it('component-detail-engine does not import cli/ or mcp/', () => {
  const files = readSourceFiles(`${SRC}/query`);
  const violations = files.filter(content =>
    /from ['"]\.\.\/cli\//.test(content) ||
    /@method\/mcp/.test(content),
  );
  expect(violations, 'query/ imports cli/ or @method/mcp').toHaveLength(0);
});
```

Note: This gate is scoped to the `query/` directory (where `component-detail-engine.ts` lives),
consistent with the existing G-PORT-QUERY gate pattern.

## Agreement
- Co-designed: 2026-04-09
- Frozen: 2026-04-09
- Changes require: new `/fcd-surface` session
