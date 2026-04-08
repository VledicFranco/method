---
type: co-design-record
surface: ContextQueryPort
date: "2026-04-08"
owner: "@method/fca-index"
producer: "@method/fca-index"
consumer: "@method/mcp"
direction: "fca-index → mcp (unidirectional)"
status: frozen
mode: new
---

# Co-Design Record — ContextQueryPort

## Interface

```typescript
export interface ContextQueryPort {
  query(request: ContextQueryRequest): Promise<ContextQueryResult>;
}

export interface ContextQueryRequest {
  query: string;
  topK?: number;               // default 5
  parts?: FcaPart[];           // filter to specific FCA parts
  levels?: FcaLevel[];         // filter to specific levels
  minCoverageScore?: number;   // exclude under-documented components
}

export interface ContextQueryResult {
  mode: IndexMode;             // 'discovery' | 'production'
  results: ComponentContext[];
}

export interface ComponentContext {
  path: string;                // relative to project root
  level: FcaLevel;
  parts: ComponentPart[];
  relevanceScore: number;      // 0-1 semantic similarity
  coverageScore: number;       // 0-1 documentation completeness
}

export interface ComponentPart {
  part: FcaPart;
  filePath: string;
  excerpt?: string;            // ~500 char excerpt for agent preview
}

export type FcaLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
export type FcaPart = 'interface' | 'boundary' | 'port' | 'domain' | 'architecture'
                    | 'verification' | 'observability' | 'documentation';
export type IndexMode = 'discovery' | 'production';
```

## Minimality Rationale

- `query()` only — the MCP handler's code path only calls `query()`. `getComponent(path)` was
  considered but the consumer has no code path that calls it. Removed per anti-over-specification.
- `topK` optional — consumer defaults to 5; agent may override.
- `parts`/`levels` filters — justified: agent may want only port interfaces or only L3 packages.
- `minCoverageScore` filter — justified: agent may want to restrict to well-documented areas.
- `excerpt` on ComponentPart — critical for token efficiency; without it, agent must read every
  returned file to decide relevance. ~500 chars is enough for a preview decision.
- `IndexMode` in result — agent/tool handler must know if results carry discovery warnings.

## Producer

- **Package:** `@method/fca-index`
- **Implementation:** `packages/fca-index/src/query/query-engine.ts` (planned)
- **Wiring:** Exported from `packages/fca-index/src/index.ts`; consumed via npm dependency

## Consumer

- **Package:** `@method/mcp`
- **Usage:** `packages/mcp/src/context-tools.ts` (planned — new file, context_query tool handler)
- **Injection:** `ContextQueryPort` instance created in `packages/mcp/src/index.ts` composition root,
  passed to context-tools.ts handler constructor

## Gate Assertion

```typescript
// In packages/mcp — add to architecture gate test (or create mcp architecture.test.ts)
// G-BOUNDARY: mcp context tools import ContextQueryPort from @method/fca-index public API only

it('mcp does not import @method/fca-index internals', () => {
  const violations = scanImports('packages/mcp/src/**', {
    forbidden: ['packages/fca-index/src/query', 'packages/fca-index/src/scanner',
                'packages/fca-index/src/index-store'],
    allowed: ['@method/fca-index'],  // only public package exports
  });
  expect(violations).toEqual([]);
});
```

## Agreement

- Frozen: 2026-04-08
- Port file: `packages/fca-index/src/ports/context-query.ts`
- Changes require: new `/fcd-surface @method/fca-index @method/mcp` session
