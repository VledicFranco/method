# Commission Mandate — Feature Set B: context_detail tool

**Session:** fcd-commission-fca-feature-set-b
**Date:** 2026-04-09
**Iteration:** 0

## Task Summary

Implement the `ComponentDetailPort` and `context_detail` MCP tool.
Surface was co-designed and frozen on 2026-04-09.
See `tmp/agent-protocol-fca-index-features.md` sections B.0–B.4 for full spec.

## Domain
Primary: `packages/fca-index/src/` (query domain, ports, factory, index.ts)
Secondary: `packages/mcp/src/` (context-tools.ts, index.ts)

## Build Commands
- build: `npm run build`
- test: `npm test`
- lint: `npx tsc --noEmit`

## Consumed Ports

| Port | Status | Notes |
|------|--------|-------|
| `ComponentDetailPort` | PASS — frozen 2026-04-09 | `ports/component-detail.ts` |
| `IndexStorePort` | WARN-LEGACY | Needs `getByPath` extension (not in frozen record) |

## Produced Ports
- `ComponentDetailPort` (produced by `ComponentDetailEngine`)

## Tech Debt
- `IndexStorePort.getByPath` added post-freeze. Formal extension session pending.

## Tasks

- [ ] Wave 0: Add `getByPath` to `IndexStorePort` + both impls + `architecture.test.ts` gate
- [ ] Task B1: Create `src/query/component-detail-engine.ts`
- [ ] Task B2: Create `src/cli/commands/detail.ts`
- [ ] Task B3: Update `src/cli/index.ts` — add `detail` subcommand
- [ ] Task B4: Update `src/factory.ts` — add `detail: ComponentDetailPort` to `FcaIndex`
- [ ] Task B5: Update `src/index.ts` — export new types
- [ ] Task B6: Update `packages/mcp/src/context-tools.ts` — add `context_detail`
- [ ] Task B7: Update `packages/mcp/src/index.ts` — wire `context_detail`
- [ ] Quality gates: build, test, architecture gates
