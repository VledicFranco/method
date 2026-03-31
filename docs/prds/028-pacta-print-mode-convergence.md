---
title: "PRD 028: Pacta Print-Mode Convergence + PTY Deprecation"
status: implemented
---

# PRD 028: Pacta Print-Mode Convergence + PTY Deprecation

**Status:** Implemented (2026-03-26)
**Author:** PO + Lysica
**Date:** 2026-03-26
**Issue:** VledicFranco/method#67
**Packages:** `@method/pacta-provider-claude-cli`, `@method/bridge`
**Depends on:** PRD 027 (Pacta SDK), PRD 026 (Universal Event Bus)
**Organization:** Vidtecci — vida, ciencia y tecnología

## Summary

Two parallel regressions in the bridge's agent execution model need to be resolved together:

1. **Pacta's `claudeCliProvider` is incomplete** — it returns `emptyUsage()`, has no JSON output parsing, no abort support, and no `--session-id` labeling. The bridge can't depend on it for `claude --print` until these gaps are closed.
2. **PTY mode is a legacy execution path** — it uses `node-pty` for persistent interactive terminals, requires fragile regex output parsing and settle-delay heuristics, and is entirely superseded by `claude --print` (structured JSON output, reliable session resume, no parsing guesswork). It should be deprecated and removed.

## Background

### Three implementations of `claude --print`

The bridge currently has three separate implementations of the same CLI invocation:

| Layer | Implementation | Status |
|-------|---------------|--------|
| `@method/methodts` | `ClaudeHeadlessProvider` (Effect) | Full: JSON parsing, `--session-id`/`--resume`, per-model cost |
| `@method/bridge` L4 | `LlmProvider` + `ClaudeCodeProvider` | Full: JSON parsing, abort signal, output format negotiation |
| `@method/pacta-provider-claude-cli` | `claudeCliProvider` | **Incomplete**: `emptyUsage()`, no JSON, no abort, no `--session-id` |

Pacta was built to be the canonical agent runtime. It needs to absorb what the bridge needs and make `LlmProvider` redundant.

### PTY mode is superseded

PTY mode spawns a persistent interactive Claude Code terminal via `node-pty`. It predates `claude --print --resume`. Its problems:
- Output parsing requires regex heuristics + adaptive settle delay (inherently fragile)
- Session recovery requires re-parsing the transcript ring buffer
- No structured cost/usage data without additional watcher logic
- Adds `node-pty` (native binary) and `xterm.js` (40KB frontend bundle) as dependencies
- All production usage has migrated to print mode (`PRINT_SESSION_DEFAULT=true`)

Print mode with `--output-format json` gives structured cost, turns, stop reason, and per-model usage with zero parsing. Session resume via `--resume <id>` is reliable across process restarts. PTY mode cannot compete on any dimension.

---

## Work Stream A — Pacta Enrichment

### A1 — Two new fields on `AgentRequest` (`packages/pacta/src/pact.ts`)

```ts
export interface AgentRequest {
  // ... existing fields ...

  /** Cancel an in-flight invocation. Provider must propagate to the child process. */
  abortSignal?: AbortSignal;

  /** Reset conversation context while keeping the session ID slot.
   *  CLI provider: spawns --session-id (fresh), no --resume.
   *  Anthropic provider: omits prior messages from context. */
  clearHistory?: boolean;
}
```

Both are provider-agnostic semantics. `clearHistory` replaces the `refreshSessionId` concept from `LlmRequest` with a generic name that maps to any stateful multi-turn provider.

### A2 — Fix `claudeCliProvider` (`packages/pacta-provider-claude-cli/`)

**cli-executor.ts:**
- Add `outputFormat?: 'json' | 'text'` to `CliArgs` — default to `'json'`
- Add `sessionId?: string` to `CliArgs` — used on first invocation as `--session-id <id>`
- Add `clearHistory?: boolean` to `CliArgs` — fresh `--session-id` call, no `--resume`
- Add `abortSignal?: AbortSignal` to `CliArgs` — propagated to `child.kill('SIGTERM')`
- `buildCliArgs()`: emit `--output-format json`, `--session-id`, `clearHistory` handling, abort wiring

**claude-cli-provider.ts:**
- Track `firstInvocation` state per session ID internally — no leakage to core types
- First call to `invoke()` with `pact.mode.sessionId`: use `--session-id <id>`
- Subsequent calls / `resume()`: use `--resume <id>`
- `clearHistory: true`: treat as fresh `--session-id` call regardless of invocation count
- Parse `--output-format json` response: populate `AgentResult.usage`, `.cost`, `.turns`, `.stopReason` from JSON fields
- Wire `abortSignal` → `child.kill('SIGTERM')` on abort
- **Delete** `emptyUsage()` and `emptyCost()` helpers (or leave them only as fallback for parse failure)

**JSON response field mapping:**

| JSON field | `AgentResult` field |
|-----------|-------------------|
| `result` | `output` |
| `session_id` | `sessionId` |
| `num_turns` | `turns` |
| `stop_reason` | `stopReason` |
| `total_cost_usd` | `cost.totalUsd` |
| `model_usage` | `cost.perModel` |
| `usage.input_tokens` | `usage.inputTokens` |
| `usage.output_tokens` | `usage.outputTokens` |
| `usage.cache_creation_input_tokens` | `usage.cacheWriteTokens` |
| `usage.cache_read_input_tokens` | `usage.cacheReadTokens` |

### A3 — Update `pacta-provider-claude-cli` tests

- Add test: JSON output is parsed and populates `AgentResult.usage` and `.cost`
- Add test: first invocation uses `--session-id`, subsequent uses `--resume`
- Add test: `clearHistory: true` resets to fresh `--session-id`
- Add test: `abortSignal` triggers `child.kill('SIGTERM')`

---

## Work Stream B — PTY Deprecation

### B1 — Deprecate PTY mode in bridge

**`packages/bridge/src/domains/sessions/pool.ts`:**
- Add deprecation warning log when `mode === 'pty'` is requested: `"PTY mode is deprecated and will be removed. Use print mode instead."`
- Change default mode to `'print'` regardless of `PRINT_SESSION_DEFAULT` env var (env var becomes no-op)
- Keep the conditional code path alive for this phase — not removed yet

**`packages/bridge/src/domains/sessions/routes.ts`:**
- `POST /sessions` — if `mode: 'pty'` provided, log deprecation warning, proceed with print mode instead (silent upgrade)
- `POST /sessions/:id/resize` — return `410 Gone` with body `{"error": "PTY mode removed. Resize is not supported in print mode."}`

### B2 — Migrate `print-session.ts` to `AgentProvider`

Replace `LlmProvider` dependency with `createAgent()` + enriched `claudeCliProvider`:

```ts
// Before
const response: LlmResponse = await provider.invoke({ ... });

// After
const agent = createAgent({ pact, provider: claudeCliProvider(...) });
const result: AgentResult = await agent.invoke(request);
```

`PactaSessionParams` → `Pact` mapping already exists in `pacta-session.ts` (spike). Merge that logic into `print-session.ts`. Session `firstPromptSent` tracking moves into the CLI provider (A2 above).

Delete `pacta-session.ts` (spike) — its purpose is absorbed here.

### B3 — Remove `LlmProvider` port + `ClaudeCodeProvider`

Once B2 is complete and verified:

**Delete:**
- `packages/bridge/src/ports/llm-provider.ts`
- `packages/bridge/src/domains/strategies/claude-code-provider.ts`
- Any import of `LlmProvider` in `server-entry.ts`

**Update `server-entry.ts`:** Remove `LlmProvider` wiring from composition root.

### B4 — Remove PTY infrastructure (backend)

**Delete entirely:**
- `packages/bridge/src/domains/sessions/pty-session.ts`
- `packages/bridge/src/domains/sessions/pty-watcher.ts`
- `packages/bridge/src/domains/sessions/adaptive-settle.ts`
- `packages/bridge/src/domains/sessions/adaptive-settle.test.ts`
- `packages/bridge/src/domains/sessions/parser.ts`
- `packages/bridge/src/domains/sessions/parser.test.ts`
- `packages/bridge/src/domains/sessions/pty-watcher.test.ts`
- `packages/bridge/src/ports/pty-provider.ts`

**Simplify:**
- `pool.ts` — remove all `mode === 'pty'` conditional branches, `SessionMode` type becomes `'print'` only (or remove entirely), delete ~150 lines of conditional logic
- `routes.ts` — remove `POST /sessions/:id/resize` endpoint entirely

**package.json:**
- Remove `node-pty` from `packages/bridge/package.json`

### B5 — Remove PTY frontend code

**`packages/bridge/frontend/src/domains/sessions/Sessions.tsx`:**
- Delete `TerminalViewer` component (~100 lines, xterm.js dynamic import, SSE stream subscription)
- Remove `isMobile` terminal branch — render print-mode transcript view for all clients
- Remove mode selector from `SpawnSessionModal.tsx` (only print mode exists)

**`packages/bridge/frontend/package.json`:**
- Remove `@xterm/xterm` dependency
- Remove `@xterm/addon-fit` dependency

---

## Phase Plan

| Phase | Scope | Deliverable |
|-------|-------|-------------|
| **P1** | A1 | `AgentRequest` gets `abortSignal` + `clearHistory` |
| **P2** | A2 | `claudeCliProvider` — JSON parsing, session labeling, abort, `clearHistory` |
| **P3** | A3 | Updated + new tests for CLI provider |
| **P4** | B1 | PTY deprecation warnings, default forced to print, resize → 410 |
| **P5** | B2 | `print-session.ts` migrated to `AgentProvider`; `pacta-session.ts` spike deleted |
| **P6** | B3 | `LlmProvider` + `ClaudeCodeProvider` deleted |
| **P7** | B4 | All PTY backend infrastructure deleted; `node-pty` removed |
| **P8** | B5 | Frontend `TerminalViewer` + xterm deps removed |

P1–P3 can be done independently. P4 gates P5 (deprecation warning before migration). P5 gates P6 (LlmProvider only removed after migration proven). P6–P8 can be done in parallel once P5 is merged.

---

## Files Affected

### Add / Modify
- `packages/pacta/src/pact.ts` — +2 fields on `AgentRequest`
- `packages/pacta-provider-claude-cli/src/cli-executor.ts` — JSON output, abort, session labeling
- `packages/pacta-provider-claude-cli/src/claude-cli-provider.ts` — `firstInvocation` state, JSON parsing
- `packages/pacta-provider-claude-cli/src/claude-cli-provider.test.ts` — new test cases
- `packages/bridge/src/domains/sessions/pool.ts` — deprecation warning, remove mode branching (P4/B4)
- `packages/bridge/src/domains/sessions/print-session.ts` — migrate to `AgentProvider` (P5)
- `packages/bridge/src/domains/sessions/routes.ts` — resize → 410, mode upgrade (P4/B4)
- `packages/bridge/src/server-entry.ts` — remove LlmProvider wiring (P6)
- `packages/bridge/frontend/src/domains/sessions/Sessions.tsx` — remove TerminalViewer (P8)
- `packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx` — remove mode selector (P8)

### Delete
- `packages/bridge/src/domains/sessions/pty-session.ts`
- `packages/bridge/src/domains/sessions/pty-watcher.ts`
- `packages/bridge/src/domains/sessions/pty-watcher.test.ts`
- `packages/bridge/src/domains/sessions/adaptive-settle.ts`
- `packages/bridge/src/domains/sessions/adaptive-settle.test.ts`
- `packages/bridge/src/domains/sessions/parser.ts`
- `packages/bridge/src/domains/sessions/parser.test.ts`
- `packages/bridge/src/domains/sessions/pacta-session.ts` (spike, absorbed into print-session)
- `packages/bridge/src/domains/sessions/pacta-session.test.ts`
- `packages/bridge/src/ports/pty-provider.ts`
- `packages/bridge/src/ports/llm-provider.ts`
- `packages/bridge/src/domains/strategies/claude-code-provider.ts`

### Remove Dependencies
- `node-pty@^1.0.0` from `packages/bridge/package.json`
- `@xterm/xterm@^5.5.0` from `packages/bridge/frontend/package.json`
- `@xterm/addon-fit@^0.10.0` from `packages/bridge/frontend/package.json`

---

## Acceptance Criteria

- [x] `AgentResult.usage` and `.cost` are populated from real JSON output (never `emptyUsage()`)
- [x] `AgentResult.turns` reflects the actual `num_turns` from the CLI response
- [x] First `invoke()` uses `--session-id`, subsequent `resume()` calls use `--resume`
- [x] `clearHistory: true` triggers a fresh `--session-id` call, drops prior context
- [x] `abortSignal` cancellation kills the child process and rejects the promise
- [x] `print-session.ts` has zero imports from `LlmProvider` or `ClaudeCodeProvider`
- [x] `node-pty` is not in any `package.json`
- [x] `@xterm/xterm` and `@xterm/addon-fit` are not in any `package.json`
- [x] `POST /sessions/:id/resize` returns `410 Gone` (endpoint removed entirely — returns 404)
- [x] Frontend renders no xterm terminal component
- [x] All existing print-mode tests pass
- [x] `npm test` green across all packages

---

## References

- Realization session: `.method/sessions/realize-20260326-prd-028/`
- Realization report: `.method/sessions/realize-20260326-prd-028/realize-report.md`
- PRD 027: `docs/prds/027-pacta.md` (Pacta SDK baseline)
- PRD 026: `docs/prds/026-universal-event-bus.md` (EventBus)
- PRD 012 Phase 4: `docs/prds/012-session-reliability.md` (original print-session implementation)
- Arch doc: `docs/arch/pacta.md`
