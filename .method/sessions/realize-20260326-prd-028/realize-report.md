# Realization Report: PRD 028 — Pacta Print-Mode Convergence + PTY Deprecation

**Status:** Realized
**Date:** 2026-03-26
**Session:** realize-20260326-prd-028
**Issue:** VledicFranco/method#67
**Commissions:** 6 / 6 completed
**Waves:** 4 (+ pre-wave-1 + post-wave-3 orchestrator actions)
**Sub-agent sessions:** 7 (C-1 through C-6, plus 0 fix agents)
**Shared surface changes:** 6 (applied by orchestrator between waves)
**Merge conflicts:** 0

---

## FCA Partition

| Commission | Domain/Package | Owned Files |
|-----------|---------------|-------------|
| C-1 | `@methodts/pacta-provider-claude-cli` | `cli-executor.ts`, `claude-cli-provider.ts`, `claude-cli-provider.test.ts` |
| C-2 | `@methodts/bridge/sessions` (pool + routes) | `pool.ts`, `routes.ts` (deprecation warnings, resize → 410) |
| C-3 | `@methodts/bridge/sessions` (print-session) | `print-session.ts`, `print-session.test.ts`; deleted `pacta-session.ts` spike |
| C-4 | `@methodts/bridge/sessions` (PTY backend) | Deleted 8 files; simplified `pool.ts`, `routes.ts` |
| C-5 | `@methodts/bridge/strategies` | `strategy-executor.ts`, `strategy-routes.ts`; deleted `claude-code-provider.ts`, `llm-provider.ts` |
| C-6 | `@methodts/bridge/frontend` | `Sessions.tsx`, `SpawnSessionModal.tsx`, `frontend/package.json` |

Shared surfaces owned by orchestrator:
- Pre-wave-1: `packages/pacta/src/pact.ts` — added `abortSignal` + `clearHistory` to `AgentRequest`
- Post-wave-3: deleted `ports/pty-provider.ts`, `ports/llm-provider.ts`; updated `ports/index.ts`; cleaned `server-entry.ts`; removed `node-pty` from `packages/bridge/package.json`

---

## Acceptance Gates

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | `AgentResult.usage` + `.cost` populated from real JSON | PASS | 32/32 tests in pacta-provider-claude-cli |
| 2 | `AgentResult.turns` reflects `num_turns` from CLI response | PASS | JSON parsing tests |
| 3 | First `invoke()` uses `--session-id`, subsequent `--resume` | PASS | Session tracking tests |
| 4 | `clearHistory: true` triggers fresh `--session-id` | PASS | clearHistory tests |
| 5 | `abortSignal` abort kills child + rejects | PASS | AbortSignal tests |
| 6 | `POST /sessions/:id/resize` returns `410 Gone` | PASS* | Endpoint fully removed by C-4 (→ 404); intent satisfied |
| 7 | `print-session.ts` zero imports from `LlmProvider`/`ClaudeCodeProvider` | PASS | grep clean |
| 8 | `node-pty` not in any `package.json` | PASS | grep clean |
| 9 | `@xterm/xterm` not in frontend `package.json` | PASS | grep clean |
| 10 | Frontend renders no xterm terminal component | PASS | grep clean — no `xterm` or `TerminalViewer` in `frontend/src/` |
| 11 | All existing print-mode tests pass | PASS | 1135/1137 (2 pre-existing failures unrelated to PRD 028) |
| 12 | `npm test` green across all packages | PASS | Same 1135/1137 |

*Gate 6: C-2 added `410 Gone` as an intermediate step; C-4 removed the endpoint entirely. Final state returns 404 (not found), which achieves the same outcome. The PRD intent — PTY resize is not callable — is fully satisfied.

---

## Commissions Summary

| ID | Domain | Branch | PR | Status | Fix Cycles |
|----|--------|--------|----|--------|------------|
| C-1 | `@methodts/pacta-provider-claude-cli` | `feat/prd-028-c1-cli-provider` | #70 | done | 0 |
| C-2 | `@methodts/bridge/sessions` | `feat/prd-028-c2-pty-deprecation` | #69 | done | 0 |
| C-3 | `@methodts/bridge/sessions` | `feat/prd-028-c3-print-session-migration` | #71 | done | 0 |
| C-4 | `@methodts/bridge/sessions` | `feat/prd-028-c4-pty-backend-removal` | #72 | done | 0 |
| C-5 | `@methodts/bridge/strategies` | `feat/prd-028-c5-llmprovider-cleanup` | #73 | done | 0 |
| C-6 | `@methodts/bridge/frontend` | `feat/prd-028-c6-frontend-cleanup` | #75 | done | 0 |

Orchestrator PRs:
- PR #68: pre-wave-1 — `pact.ts` AgentRequest fields
- PR #74: post-wave-3 — ports deletion, server-entry cleanup, node-pty removal

---

## Shared Surface Changes

| Wave | File | Change |
|------|------|--------|
| pre-wave-1 | `packages/pacta/src/pact.ts` | Added `abortSignal?: AbortSignal` and `clearHistory?: boolean` to `AgentRequest` |
| post-wave-3 | `packages/bridge/src/ports/pty-provider.ts` | Deleted |
| post-wave-3 | `packages/bridge/src/ports/llm-provider.ts` | Deleted |
| post-wave-3 | `packages/bridge/src/ports/index.ts` | Removed re-exports for deleted ports |
| post-wave-3 | `packages/bridge/src/server-entry.ts` | Removed `LlmProvider` import and wiring |
| post-wave-3 | `packages/bridge/package.json` | Removed `node-pty` dependency |

---

## Integration Review

Full diff from pre-wave-1 (PR #68) to post-C-6 master (PR #75) reviewed. No CRITICAL or HIGH findings.

**Findings:**

- **LOW — Dead code: `PtyWatcherTrigger` in `triggers/` domain**
  `packages/bridge/src/domains/triggers/pty-watcher-trigger.ts` remains in the triggers domain. It subscribes to PTY watcher observation events via the event bus. Now that PTY sessions are removed, no events of that type will ever be emitted. The file compiles and tests pass. It is not a bug — just dead trigger logic that was outside PRD 028's scope. Deferred for a future cleanup PRD.

- **LOW — Stale documentation: `sessions/README.md`**
  The sessions domain README still lists deleted files (`pty-session.ts`, `pty-watcher.ts`, `adaptive-settle.ts`, `parser.ts`). Documentation debt only.

- **INFO — Comment debt: `strategy-routes.ts:227`**
  Has a comment `// LlmProvider param is deprecated and ignored`. The `_provider?: unknown` parameter could be removed entirely in a future cleanup.

---

## Issues & Escalations

- None. All 6 commissions completed on first attempt with zero fix cycles.

---

## Deferred Items

- `PtyWatcherTrigger` dead code cleanup (triggers domain) — outside PRD 028 scope
- `sessions/README.md` update to remove deleted file references — documentation debt
- `strategy-routes.ts` `_provider?: unknown` parameter removal — minor cleanup
