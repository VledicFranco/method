---
type: prd
title: "@methodts/fca-index — Standalone MCP Server"
date: "2026-04-13"
status: draft
domains: [fca-index/mcp]
surfaces: []
---

# PRD — @methodts/fca-index Standalone MCP Server

## Problem

`@methodts/fca-index` is ready to publish as a standalone library, but its MCP
tools (`context_query`, `context_detail`, `coverage_check`) are locked inside
`@methodts/mcp` — a 1,150-line server that bundles 50+ tools for methodology,
bridge, strategies, experiments, and more. Anyone who wants fca-index's semantic
code search for their own FCA-compliant project must run the entire method
server. This makes standalone adoption impossible.

## Constraints

- `@methodts/fca-index` is L3. The MCP server is a **composition root** (like
  the CLI) — it may import transport libraries (`@modelcontextprotocol/sdk`),
  but library exports (`src/index.ts`) must remain transport-agnostic.
- All 6 frozen ports are unchanged. No `/fcd-surface` session needed.
- The existing `@methodts/mcp` server must continue to work for method-internal
  users. This PRD does NOT remove context tools from `@methodts/mcp` — it adds a
  standalone alternative.
- The fca-index library already has `@modelcontextprotocol/sdk` as a transitive
  dependency (via the monorepo). For standalone publish, it becomes a direct
  dependency — acceptable since it's only imported by the MCP entry point, not
  the library surface.

## Success Criteria

| ID | Criterion | Measurement |
|----|-----------|-------------|
| SC-1 | **Standalone MCP works end-to-end** | `echo '...' \| npx fca-index-mcp` returns valid context_query results for a scanned project |
| SC-2 | **Zero new ports** | No changes to any file in `packages/fca-index/src/ports/` |
| SC-3 | **Library exports unchanged** | `packages/fca-index/src/index.ts` gains at most a re-export line for MCP types; no removals |
| SC-4 | **@methodts/mcp still works** | Existing method server's context tools unaffected |
| SC-5 | **Gate coverage** | New G-BOUNDARY-MCP gate in `architecture.test.ts`: `mcp/` does not import from `cli/` internals or domain internals |

## Scope

**In:**
- New composition root: `packages/fca-index/src/mcp/server.ts`
- Formatters moved: `formatContextQueryResult`, `formatComponentDetail`,
  `formatCoverageReport` relocated from `@methodts/mcp` to `fca-index/mcp/`
- New bin entry: `fca-index-mcp` (stdio MCP server)
- New package.json export: `"./mcp"` entry point
- Architecture gate: G-BOUNDARY-MCP
- Tests: MCP server handler tests (mirrors existing `context-tools.test.ts`)

**Out:**
- Removing context tools from `@methodts/mcp` (backward compat — do later)
- Publishing to npm (separate task after this PRD)
- HTTP/SSE transport (stdio only for now)
- New tools beyond the existing 3 (context_query, context_detail, coverage_check)
- Changes to frozen ports
- `.fca-index.yaml` config schema changes

---

## Domain Map

```
@methodts/fca-index
├── src/
│   ├── ports/           (UNCHANGED — 6 frozen ports)
│   ├── scanner/         (UNCHANGED)
│   ├── query/           (UNCHANGED)
│   ├── coverage/        (UNCHANGED)
│   ├── compliance/      (UNCHANGED)
│   ├── index-store/     (UNCHANGED)
│   ├── testkit/         (UNCHANGED)
│   ├── cli/             (UNCHANGED — existing composition root)
│   └── mcp/             (NEW — MCP composition root)
│       ├── server.ts    MCP stdio server, registers 3 tools
│       └── formatters.ts  formatContextQueryResult + detail + coverage
└── package.json         (CHANGED — new bin + export + dep)

@methodts/mcp              (UNCHANGED — keeps its copy of context tools)
```

**Cross-domain interactions:** zero new. The MCP server is a composition root
that consumes the existing frozen ports via `createDefaultFcaIndex`. Same
pattern as `cli/index.ts` — different transport, same domain wiring.

---

## Surfaces (Primary Deliverable)

**Empty.** This is a composition root addition — it consumes existing frozen
ports, does not create or modify any. Same justification as PR #163's
council session (Sable verified: "This is the rare case where the right answer
doesn't touch the contract").

---

## Per-Domain Architecture

### Domain: `fca-index/mcp` (NEW composition root)

**Layer placement:** Composition root within L3 package (same as `cli/`).

**Internal structure:**

```
packages/fca-index/src/mcp/
  server.ts              # MCP stdio server entry point
  formatters.ts          # formatContextQueryResult, formatComponentDetail,
                         # formatCoverageReport (moved from @methodts/mcp)
  formatters.test.ts     # Unit tests for formatters
  server.test.ts         # Handler integration tests (RecordingPorts + MCP call → text)
```

**server.ts design (~100 LoC):**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDefaultFcaIndex } from '../factory.js';
import { formatContextQueryResult, formatComponentDetail, formatCoverageReport } from './formatters.js';

const ROOT = process.env.FCA_INDEX_ROOT ?? process.cwd();
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

if (!VOYAGE_API_KEY) {
  process.stderr.write('[fca-index-mcp] VOYAGE_API_KEY required\n');
  process.exit(1);
}

const fca = await createDefaultFcaIndex({ projectRoot: ROOT, voyageApiKey: VOYAGE_API_KEY });

const server = new Server(
  { name: 'fca-index', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// Register 3 tools: context_query, context_detail, coverage_check
// (same schemas as @methodts/mcp/src/context-tools.ts CONTEXT_TOOLS array)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_DEFINITIONS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // parse → call port → format (DR-04)
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

**formatters.ts design:**

Move the 3 formatter functions from `@methodts/mcp/src/context-tools.ts`:
- `formatContextQueryResult` (already exported in PR #164)
- `formatComponentDetail`
- `formatCoverageReport`

These are pure functions (no ports, no state). The move is a copy — `@methodts/mcp`
keeps its versions for backward compat. When `@methodts/mcp` eventually removes its
copy, it imports from `@methodts/fca-index/mcp`.

**Package.json changes:**

```json
{
  "bin": {
    "fca-index": "./dist/cli/index.js",
    "fca-index-mcp": "./dist/mcp/server.js"
  },
  "exports": {
    ".": "./dist/index.js",
    "./testkit": "./dist/testkit/index.js",
    "./mcp": "./dist/mcp/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.10.2"
  }
}
```

**Verification strategy:**

- `formatters.test.ts`: unit tests for the 3 formatters (can reuse fixture
  patterns from existing `context-tools.test.ts` in `@methodts/mcp`)
- `server.test.ts`: integration tests using RecordingContextQueryPort etc.
  to verify MCP handlers produce correct text output
- Architecture gate: G-BOUNDARY-MCP — `mcp/` must not import from `cli/`
  internals, `scanner/`, `index-store/`, etc. (only `ports/` and `factory.ts`)
- End-to-end smoke: pipe JSON-RPC to `node dist/mcp/server.js` and verify
  `context_query` returns formatted results

**Consumer's `.mcp.json`:**

```json
{
  "mcpServers": {
    "fca-index": {
      "command": "npx",
      "args": ["fca-index-mcp"],
      "env": { "VOYAGE_API_KEY": "..." }
    }
  }
}
```

Or for local development:

```json
{
  "mcpServers": {
    "fca-index": {
      "command": "node",
      "args": ["packages/fca-index/dist/mcp/server.js"]
    }
  }
}
```

---

## Phase Plan

### Wave 0 — Surfaces

**Empty.** No new ports. Composition root only.

### Wave 1 — MCP server + formatters

1. Create `packages/fca-index/src/mcp/formatters.ts` — copy the 3 formatters
   from `@methodts/mcp/src/context-tools.ts` (with the per-rank rendering
   constants from PRs #163/#168).
2. Create `packages/fca-index/src/mcp/server.ts` — stdio MCP server wiring
   `createDefaultFcaIndex` + 3 tool handlers.
3. Create `packages/fca-index/src/mcp/formatters.test.ts` — formatter tests
   (adapt from `@methodts/mcp/src/context-tools.test.ts`).
4. Update `packages/fca-index/package.json` — add `@modelcontextprotocol/sdk`
   dep, `bin.fca-index-mcp`, `exports["./mcp"]`.
5. Add `G-BOUNDARY-MCP` gate to `architecture.test.ts`.
6. End-to-end smoke test: pipe JSON-RPC, verify response.

**Acceptance gate:** `fca-index-mcp` binary starts, accepts JSON-RPC
`tools/list`, returns 3 tools. `context_query` returns correct results
against a scanned project. All gates green.

### Wave 2 — Documentation + publish prep

1. Update `packages/fca-index/src/README.md` with MCP server usage.
2. Add a top-level usage example to the README showing `.mcp.json` config.
3. (Optional) Update `@methodts/mcp/src/context-tools.ts` to import formatters
   from `@methodts/fca-index/mcp` instead of maintaining its own copy. Only if
   it simplifies the codebase — not required for this PRD.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| `@modelcontextprotocol/sdk` as a direct dependency bloats the package | Low | Medium | SDK is small (~50KB); only imported by the MCP entry point, not the library surface |
| Formatter drift between fca-index/mcp and @methodts/mcp | Medium | Low | Track as tech debt; plan to have @methodts/mcp import from fca-index when convenient |
| VOYAGE_API_KEY required at startup (fail-fast) vs lazy init (fail-at-call-time) | Design choice | Low | Fail-fast is cleaner for standalone; the lazy pattern in @methodts/mcp was needed because it hosts 50+ tools and can't fail on one missing key |
| MCP SDK version drift between packages | Low | Low | Pin to same version in monorepo; hoist to root package.json |
