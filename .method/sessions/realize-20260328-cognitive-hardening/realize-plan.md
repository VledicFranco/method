# Realization Plan: Cognitive Module Hardening

**Session:** realize-20260328-cognitive-hardening
**Date:** 2026-03-28
**Source:** Deep review of cognitive modules (algebra, bridge integration, frontend, SLM)
**Branch:** fix/cognitive-hardening

## FCA Partition Map

```
Domains (independent — commissioned in parallel):
  sessions/ (backend)    → bridge-tools, cognitive-provider, routes
  sessions/ (frontend)   → SpawnSessionModal, usePromptStream, ReflectionFooter
  cognitive/ (pacta)     → provider-adapter, monitor, workspace

Shared surfaces (orchestrator-owned):
  packages/bridge/src/domains/sessions/pool.ts   → StreamEvent type, SSE sink wiring
  packages/bridge/frontend/src/domains/sessions/types.ts → CognitiveCycleData
```

## Commissions

| ID | Domain | Title | Status |
|----|--------|-------|--------|
| C-1 | bridge/sessions (backend) | Security hardening + provider fixes | pending |
| C-2 | bridge/sessions (frontend) | Cognitive UX: spawn dialog + event parsing | pending |
| C-3 | pacta/cognitive | Algebra hardening: timeouts, dead types, workspace validation | pending |

## Commission Details

### C-1: Bridge Sessions Backend — Security + Provider Fixes
**Domain:** packages/bridge/src/domains/sessions/
**Files:** bridge-tools.ts, cognitive-provider.ts, routes.ts

1. **bridge-tools.ts — Path traversal**: Validate resolved path stays within workdir
2. **bridge-tools.ts — Bash sandboxing**: Replace execSync with execFileSync, whitelist safe commands (git, npm, node, ls, cat, find, grep)
3. **bridge-tools.ts — Glob fallback**: Replace shell-interpolated find with execFileSync
4. **cognitive-provider.ts — Tool vs parse error**: Separate catch blocks for JSON.parse vs tools.execute failures
5. **cognitive-provider.ts — totalCycles**: Track actual cycle count instead of hardcoding maxCycles
6. **cognitive-provider.ts — lastOutput fallback**: Include foldedCtx summary when cycle limit reached
7. **cognitive-provider.ts — Empty response**: Add early validation for empty/whitespace LLM responses
8. **routes.ts — Zod validation**: Add schema validation for cognitive_config and cognitive_patterns

### C-2: Frontend Cognitive UX
**Domain:** packages/bridge/frontend/src/domains/sessions/
**Files:** SpawnSessionModal.tsx, usePromptStream.ts, ReflectionFooter.tsx

1. **SpawnSessionModal**: Add provider_type selector (print vs cognitive-agent toggle)
2. **usePromptStream.ts**: Fix event field reads — use `event.cycle` not `event.number`
3. **ReflectionFooter.tsx**: Fix array-index-as-key anti-pattern

### C-3: Pacta Cognitive Algebra Hardening
**Domain:** packages/pacta/src/cognitive/
**Files:** algebra/provider-adapter.ts, modules/monitor.ts, algebra/workspace.ts

1. **provider-adapter.ts — Timeout**: Add AbortSignal-based timeout (30s default) to invoke()
2. **workspace.ts — NaN guard**: Validate salience output (Number.isFinite check)
3. **monitor.ts — Type narrowing**: Replace `as any` casts with proper discriminated union narrowing
4. **modules — Dead type**: Remove or deprecate unused ReasonerActorMonitoring

## Execution Order

Wave 1 (parallel): C-1, C-2, C-3 — disjoint domains
  → orchestrator: merge all, verify gates
  → create single PR

## Acceptance Gates

| # | Criterion | Verification |
|---|-----------|-------------|
| 1 | Path traversal blocked | bridge-tools rejects `../` paths |
| 2 | Bash sandboxed | Only whitelisted commands execute |
| 3 | Glob no shell injection | Uses execFileSync, not execSync |
| 4 | Event fields consistent | Frontend reads `event.cycle`, backend emits `cycle` |
| 5 | Spawn dialog has mode selector | UI renders provider_type toggle |
| 6 | Provider adapter respects timeout | Adapter invoke() aborts after configured timeout |
| 7 | Build passes | `npm run build` (bridge + pacta) clean |
| 8 | Tests pass | `npm test` passes |
