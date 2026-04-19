---
type: prd
id: "054"
title: "@methodts/mcp context tools — FCA context query + coverage check"
date: "2026-04-08"
status: complete
completed: "2026-04-08"
branch: feat/054-mcp-context-tools
tests: 10/10 (mcp) + 158/158 (fca-index)
domains: [mcp/context-tools]
surfaces: [ContextQueryPort, CoverageReportPort]
depends_on: "053 (fca-index library — Wave 3 complete)"
co-design-records:
  - .method/sessions/fcd-surface-fca-index-mcp/record.md
  - .method/sessions/fcd-surface-fca-index-cli/record.md
---

# PRD 054 — @methodts/mcp Context Tools

## Problem

`@methodts/fca-index` (PRD 053) provides a typed query engine over FCA-indexed projects,
but agents can only use it via a CLI or programmatic API. MCP tool exposure is what turns
the library into agent-accessible infrastructure. Without MCP tools, the token reduction
benefit (PRD 053 SC-1) is unreachable by running methodts methodology steps.

## Constraints

- Thin wrapper rule (DR-04): MCP handlers parse input, call port, format output. No business logic.
- Depends on PRD 053 Wave 3 complete (ContextQueryPort + CoverageReportPort implemented)
- New file `packages/mcp/src/context-tools.ts` — does not modify existing tool handlers
- `@methodts/mcp` gains `@methodts/fca-index` as a peer dependency
- Two new MCP tools: `context_query` and `coverage_check`
- G-BOUNDARY gate: mcp must not import fca-index internals — only `@methodts/fca-index` public API

## Success Criteria

| ID | Criterion | Measurement |
|----|-----------|-------------|
| SC-1 | **Tool registration** | Both tools appear in MCP ListTools response |
| SC-2 | **context_query returns usable results** | Given a representative methodts task description as query, top-5 results include the correct domain directory in ≥ 8/10 test cases |
| SC-3 | **coverage_check is honest** | Returns mode: 'discovery' for method-2 before PRD 053 SC-3 passes; returns 'production' after |
| SC-4 | **DR-04 compliance** | Zero business logic in context-tools.ts — all formatting, no decisions |

## Scope

**In:** `context_query` tool, `coverage_check` tool, wiring in composition root.

**Out:** Index management tools (triggering a scan, invalidating the index), federation
across multiple projects, real-time index refresh, streaming results.

---

## Domain: mcp/context-tools

### New file: `packages/mcp/src/context-tools.ts`

```typescript
/**
 * Context tools — MCP wrappers over @methodts/fca-index ports.
 * Thin wrappers per DR-04: parse input, call port, format output.
 */
import type { ContextQueryPort, CoverageReportPort } from '@methodts/fca-index';

export function createContextTools(
  contextQuery: ContextQueryPort,
  coverageReport: CoverageReportPort,
) {
  return { CONTEXT_TOOLS, handlers: { context_query, coverage_check } };

  async function context_query(input: unknown) { ... }
  async function coverage_check(input: unknown) { ... }
}
```

### Tool: `context_query`

**MCP tool definition:**
```json
{
  "name": "context_query",
  "description": "Query the FCA index of a project for components relevant to a task or concept. Returns ranked component descriptors (paths, part excerpts, relevance scores) for efficient context gathering — reads far fewer tokens than filesystem search.",
  "inputSchema": {
    "type": "object",
    "required": ["query"],
    "properties": {
      "query": {
        "type": "string",
        "description": "Natural-language description of the code or concept you need"
      },
      "topK": {
        "type": "number",
        "description": "Max results (default 5)",
        "default": 5
      },
      "parts": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Filter to specific FCA parts: interface, port, domain, verification, observability, documentation, architecture, boundary"
      },
      "levels": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Filter to specific FCA levels: L0, L1, L2, L3, L4, L5"
      },
      "minCoverageScore": {
        "type": "number",
        "description": "Exclude components with coverage below this score (0-1)"
      }
    }
  }
}
```

**Response format (text/plain for agent consumption):**
```
[mode: discovery | production]
[N results for "{query}"]

1. src/domains/sessions/ (L2) — relevance: 0.94, coverage: 0.87
   documentation: src/domains/sessions/README.md
     > Session lifecycle, PTY pool management, channel subscriptions...
   port: src/domains/sessions/providers/session-pool.ts
     > interface SessionPoolPort { acquire(): Promise<Session>; release(s: Session): void; }
   interface: src/domains/sessions/index.ts
     > export type { Session, SessionId, SessionState } from './types.js';

2. ...
```

**Handler (DR-04 compliance check):**
```typescript
async function context_query(input: unknown) {
  // Parse
  const { query, topK, parts, levels, minCoverageScore } = parseContextQueryInput(input);
  // Call port
  const result = await contextQuery.query({ query, topK, parts, levels, minCoverageScore });
  // Format
  return formatContextQueryResult(result);
}
// formatContextQueryResult: pure transformation, no branching on domain values
```

### Tool: `coverage_check`

**MCP tool definition:**
```json
{
  "name": "coverage_check",
  "description": "Check FCA documentation coverage for a project. Returns coverage summary and whether the index is in discovery or production mode. Use before a context_query to understand index reliability.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "projectRoot": {
        "type": "string",
        "description": "Absolute path to the project root (defaults to METHOD_ROOT)"
      },
      "verbose": {
        "type": "boolean",
        "description": "Include per-component breakdown (default false)",
        "default": false
      }
    }
  }
}
```

**Response format:**
```
[mode: discovery]  ← or: production
Coverage: 0.73 / threshold 0.80  ← meetsThreshold: false

By part:
  documentation:  0.91 ████████████████████
  interface:      0.84 ████████████████
  port:           0.61 ████████████
  verification:   0.72 ██████████████
  observability:  0.34 ██████

Components: 47 total | 12 fully documented | 31 partial | 4 undocumented
```

---

## Wiring

### Composition root changes (`packages/mcp/src/index.ts`)

```typescript
import { createFcaIndex } from '@methodts/fca-index';
import { createContextTools } from './context-tools.js';

const PROJECT_ROOT = process.env.METHOD_ROOT ?? process.cwd();
const fcaIndex = createFcaIndex({ projectRoot: PROJECT_ROOT });
const { CONTEXT_TOOLS, handlers: contextHandlers } = createContextTools(
  fcaIndex.contextQuery,
  fcaIndex.coverageReport,
);

// Register tools
const ALL_TOOLS = [...EXISTING_TOOLS, ...CONTEXT_TOOLS];
```

`createFcaIndex()` is the factory exported by `@methodts/fca-index` — returns
`{ contextQuery: ContextQueryPort, coverageReport: CoverageReportPort }`.

### Error handling

Both tools return graceful errors when the index doesn't exist:
```
[error: INDEX_NOT_FOUND]
Run 'fca-index scan' to build the index for this project.
```

---

## Architecture Gates

Add to `packages/mcp` (or create `packages/mcp/src/architecture.test.ts`):

```typescript
// G-BOUNDARY: mcp context tools use @methodts/fca-index public API only
it('context-tools.ts does not import @methodts/fca-index internals', () => {
  const violations = scanImports('packages/mcp/src/context-tools.ts', {
    forbidden: [
      'packages/fca-index/src/query',
      'packages/fca-index/src/scanner',
      'packages/fca-index/src/index-store',
      'packages/fca-index/src/coverage',
    ],
    allowed: ['@methodts/fca-index'],
  });
  expect(violations).toEqual([]);
});

// G-PORT: context-tools has no business logic (DR-04 validation)
// Manual review gate — verified in fcd-review
```

---

## Phase Plan

### Wave 0 — Surfaces (COMPLETE)

Port contracts already frozen in PRD 053 Wave 0.

### Wave 1 — Context tools implementation

**Prerequisite:** PRD 053 Wave 3 complete (ContextQueryPort + CoverageReportPort available).

**Deliverables:**
- `packages/mcp/src/context-tools.ts` — tool definitions + handlers
- `packages/mcp/src/context-tools.test.ts` — unit tests with RecordingContextQueryPort + RecordingCoverageReportPort from `@methodts/fca-index/testkit`
- `packages/mcp/src/index.ts` — composition root updated to wire fca-index instance
- `packages/mcp/package.json` — add `@methodts/fca-index` dependency

**Acceptance gate:** Both tools appear in ListTools. Unit tests passing. G-BOUNDARY gate
added and green. DR-04 compliance review passing (no business logic in handlers).

### Wave 2 — Integration validation

**Deliverables:**
- Integration test: start MCP server against indexed method-2, call context_query with 10 representative queries, validate SC-2
- Integration test: coverage_check reflects actual index state

**Acceptance gate:** SC-1 through SC-4 met. Token reduction measured against baseline.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| PRD 053 Wave 3 delays | Medium | High | PRD 054 is blocked until 053 Wave 3 done. Plan in sequence. |
| createFcaIndex() factory API not yet defined in 053 | Low | Low | Wave 0 of 054 can define the factory signature; 053 Wave 4 implements it |
| Index not present at MCP server startup | Medium | Low | Graceful INDEX_NOT_FOUND error guides user to run scan |
