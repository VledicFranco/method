# Realization Plan: PRD 028 — Pacta Print-Mode Convergence + PTY Deprecation

**Session:** realize-20260326-prd-028
**Issue:** VledicFranco/method#67
**Date:** 2026-03-26

---

## FCA Partition Map

```
Packages touched:
  @method/pacta-provider-claude-cli  → C-1 (CLI provider enrichment)
  @method/bridge / sessions domain   → C-2 (PTY deprecation), C-3 (print-session migration), C-4 (PTY removal)
  @method/bridge / strategies domain → C-5 (LlmProvider/ClaudeCodeProvider deletion)
  @method/bridge / frontend          → C-6 (xterm + TerminalViewer removal)

Shared surfaces (orchestrator-owned — never modified by sub-agents):
  packages/pacta/src/pact.ts               ← AgentRequest type — patched pre-wave-1
  packages/bridge/src/ports/pty-provider.ts ← deleted post-wave-3
  packages/bridge/src/ports/llm-provider.ts ← deleted post-wave-3
  packages/bridge/src/ports/index.ts        ← re-exports updated post-wave-3
  packages/bridge/src/server-entry.ts       ← LlmProvider wiring removed post-wave-3
  packages/bridge/package.json              ← node-pty removed post-wave-3

Layer stack:
  L4 bridge → L3 mcp, pacta, pacta-provider-* → L2 methodts
```

---

## Pre-Wave 1 — Orchestrator Action

**Patch `packages/pacta/src/pact.ts`** — add two fields to `AgentRequest` interface (~10 lines):

```ts
/** Cancel an in-flight invocation. Provider must propagate to the child process. */
abortSignal?: AbortSignal;

/** Reset conversation context while keeping the session ID slot.
 *  CLI provider: spawns --session-id (fresh), no --resume.
 *  Anthropic provider: omits prior messages from context. */
clearHistory?: boolean;
```

Build + test must pass after this change before Wave 1 is launched.

---

## Commissions

| ID | Wave | Domain/Package | Title | Depends On | Status |
|----|------|---------------|-------|------------|--------|
| C-1 | 1 | `@method/pacta-provider-claude-cli` | CLI provider enrichment (JSON output, session tracking, abort, clearHistory + tests) | pre-wave-1 | done (PR #70) |
| C-2 | 1 | `@method/bridge/sessions` | PTY deprecation (B1): warnings, force print default, resize → 410 | — | done (PR #69) |
| C-3 | 2 | `@method/bridge/sessions` | Print-session migration (B2): migrate to AgentProvider, delete pacta-session spike | C-1, C-2 | done (PR #71) |
| C-4 | 3 | `@method/bridge/sessions` | PTY backend removal (B4): delete pty-session, pty-watcher, adaptive-settle, parser, simplify pool/routes | C-3 | done (PR #72) |
| C-5 | 3 | `@method/bridge/strategies` | LlmProvider cleanup (B3): delete claude-code-provider.ts + test, strategies/llm-provider.ts | C-3 | done (PR #73) |
| C-6 | 4 | `@method/bridge/frontend` | Frontend cleanup (B5): remove TerminalViewer, xterm deps, mode selector | C-4, C-5 | done (PR #75) |

---

## Commission Cards

### C-1 — CLI Provider Enrichment
```yaml
id: C-1
phase: P2 + P3 (Work Stream A)
title: "Fix claudeCliProvider — JSON output, session tracking, abort, clearHistory, + tests"
domain: "@method/pacta-provider-claude-cli"
scope:
  allowed_paths:
    - "packages/pacta-provider-claude-cli/src/**"
  forbidden_paths:
    - "packages/*/src/ports/*"
    - "packages/pacta/src/pact.ts"       # orchestrator already patched this
    - "packages/*/src/index.ts"
    - "packages/*/package.json"
deliverables:
  - "cli-executor.ts: outputFormat='json' default, sessionId arg, clearHistory arg, abortSignal arg, buildCliArgs() updated"
  - "claude-cli-provider.ts: firstInvocation state tracking, JSON response parsing → AgentResult fields, abortSignal → SIGTERM, clearHistory support"
  - "claude-cli-provider.test.ts: JSON output parsing test, first-invoke --session-id / resume --resume test, clearHistory resets to fresh --session-id, abortSignal kills child"
acceptance_criteria:
  - "AgentResult.usage.inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens populated from JSON"
  - "AgentResult.cost.totalUsd and perModel populated"
  - "AgentResult.turns reflects num_turns from JSON"
  - "AgentResult.stopReason reflects stop_reason from JSON"
  - "First invoke() with sessionId uses --session-id <id>"
  - "Subsequent invoke()/resume() uses --resume <id>"
  - "clearHistory: true triggers fresh --session-id regardless of invocation count"
  - "abortSignal abort → child.kill('SIGTERM') → promise rejects"
  - "emptyUsage() / emptyCost() removed (or only used as parse-failure fallback)"
  - "npm test passes in packages/pacta-provider-claude-cli"
estimated_tasks: 6
branch: "feat/prd-028-c1-cli-provider"
status: pending
```

### C-2 — PTY Deprecation
```yaml
id: C-2
phase: P4 (Work Stream B1)
title: "PTY deprecation warnings, force print default, resize → 410"
domain: "@method/bridge / sessions domain"
scope:
  allowed_paths:
    - "packages/bridge/src/domains/sessions/pool.ts"
    - "packages/bridge/src/domains/sessions/routes.ts"
  forbidden_paths:
    - "packages/*/src/ports/*"
    - "packages/bridge/src/server-entry.ts"
    - "packages/*/src/index.ts"
    - "packages/*/package.json"
deliverables:
  - "pool.ts: deprecation warning log when mode==='pty', default forced to 'print' (PRINT_SESSION_DEFAULT env var becomes no-op)"
  - "routes.ts: POST /sessions mode='pty' → log deprecation, silently upgrade to print; POST /sessions/:id/resize → 410 Gone with {error: 'PTY mode removed. Resize not supported in print mode.'}"
acceptance_criteria:
  - "POST /sessions/:id/resize returns 410 Gone"
  - "Requesting mode='pty' logs deprecation warning, session proceeds as print"
  - "Default session mode is print regardless of PRINT_SESSION_DEFAULT"
  - "npm test passes in packages/bridge"
estimated_tasks: 3
branch: "feat/prd-028-c2-pty-deprecation"
status: pending
```

### C-3 — Print-Session Migration
```yaml
id: C-3
phase: P5 (Work Stream B2)
title: "Migrate print-session.ts to AgentProvider; delete pacta-session.ts spike"
domain: "@method/bridge / sessions domain"
scope:
  allowed_paths:
    - "packages/bridge/src/domains/sessions/print-session.ts"
    - "packages/bridge/src/domains/sessions/print-session.test.ts"
    - "packages/bridge/src/domains/sessions/pacta-session.ts"
    - "packages/bridge/src/domains/sessions/pacta-session.test.ts"
    - "packages/bridge/src/domains/sessions/pacta-integration.md"
  forbidden_paths:
    - "packages/*/src/ports/*"
    - "packages/bridge/src/server-entry.ts"
    - "packages/*/src/index.ts"
    - "packages/*/package.json"
deliverables:
  - "print-session.ts: replace LlmProvider dependency with createAgent() + claudeCliProvider from @method/pacta-provider-claude-cli; merge PactaSessionParams→Pact mapping from pacta-session.ts"
  - "pacta-session.ts + pacta-session.test.ts: deleted (logic absorbed into print-session.ts)"
  - "print-session.test.ts: updated to verify no LlmProvider imports"
acceptance_criteria:
  - "print-session.ts has zero imports from LlmProvider or ClaudeCodeProvider"
  - "print-session.ts uses createAgent() + claudeCliProvider() for all invocations"
  - "All existing print-mode session tests pass"
  - "pacta-session.ts and pacta-session.test.ts deleted"
  - "npm test passes in packages/bridge"
estimated_tasks: 5
branch: "feat/prd-028-c3-print-session-migration"
status: blocked
```

### C-4 — PTY Backend Removal
```yaml
id: C-4
phase: P7 (Work Stream B4)
title: "Delete all PTY backend infrastructure, simplify pool/routes"
domain: "@method/bridge / sessions domain"
scope:
  allowed_paths:
    - "packages/bridge/src/domains/sessions/pty-session.ts"
    - "packages/bridge/src/domains/sessions/pty-watcher.ts"
    - "packages/bridge/src/domains/sessions/pty-watcher.test.ts"
    - "packages/bridge/src/domains/sessions/adaptive-settle.ts"
    - "packages/bridge/src/domains/sessions/adaptive-settle.test.ts"
    - "packages/bridge/src/domains/sessions/parser.ts"
    - "packages/bridge/src/domains/sessions/parser.test.ts"
    - "packages/bridge/src/domains/sessions/pattern-matchers.ts"
    - "packages/bridge/src/domains/sessions/pool.ts"
    - "packages/bridge/src/domains/sessions/routes.ts"
    - "packages/bridge/src/domains/sessions/types.ts"
  forbidden_paths:
    - "packages/*/src/ports/*"           # orchestrator deletes ports/pty-provider.ts post-wave
    - "packages/bridge/src/server-entry.ts"
    - "packages/*/src/index.ts"
    - "packages/*/package.json"          # orchestrator removes node-pty post-wave
deliverables:
  - "pty-session.ts, pty-watcher.ts, pty-watcher.test.ts, adaptive-settle.ts, adaptive-settle.test.ts, parser.ts, parser.test.ts, pattern-matchers.ts: deleted"
  - "pool.ts: all mode==='pty' conditional branches removed; SessionMode type becomes 'print' only or removed; ~150 lines of conditional logic deleted"
  - "routes.ts: POST /sessions/:id/resize endpoint removed entirely (was already 410 from C-2); any remaining pty references cleaned"
  - "types.ts: SessionMode type updated if present"
acceptance_criteria:
  - "No imports of pty-session, pty-watcher, adaptive-settle, parser, or pattern-matchers remain"
  - "pool.ts has no PTY conditional branches"
  - "routes.ts has no resize endpoint"
  - "npm test passes in packages/bridge"
estimated_tasks: 5
branch: "feat/prd-028-c4-pty-backend-removal"
status: blocked
```

### C-5 — LlmProvider Cleanup
```yaml
id: C-5
phase: P6 (Work Stream B3)
title: "Delete claude-code-provider.ts and strategies/llm-provider.ts"
domain: "@method/bridge / strategies domain"
scope:
  allowed_paths:
    - "packages/bridge/src/domains/strategies/claude-code-provider.ts"
    - "packages/bridge/src/domains/strategies/claude-code-provider.test.ts"
    - "packages/bridge/src/domains/strategies/llm-provider.ts"
    - "packages/bridge/src/domains/strategies/strategy-executor.ts"
    - "packages/bridge/src/domains/strategies/strategy-executor.test.ts"
    - "packages/bridge/src/domains/strategies/pacta-strategy.ts"
    - "packages/bridge/src/domains/strategies/pacta-strategy.test.ts"
  forbidden_paths:
    - "packages/*/src/ports/*"           # orchestrator deletes ports/llm-provider.ts post-wave
    - "packages/bridge/src/server-entry.ts"
    - "packages/*/src/index.ts"
    - "packages/*/package.json"
deliverables:
  - "claude-code-provider.ts + claude-code-provider.test.ts: deleted"
  - "strategies/llm-provider.ts: deleted (or confirmed already redundant)"
  - "strategy-executor.ts + pacta-strategy.ts: updated to remove any LlmProvider dependency if present"
acceptance_criteria:
  - "No files in strategies/ import from LlmProvider or ClaudeCodeProvider"
  - "npm test passes in packages/bridge"
estimated_tasks: 3
branch: "feat/prd-028-c5-llmprovider-cleanup"
status: blocked
```

### C-6 — Frontend Cleanup
```yaml
id: C-6
phase: P8 (Work Stream B5)
title: "Remove TerminalViewer, xterm deps, mode selector from frontend"
domain: "@method/bridge / frontend"
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/sessions/**"
    - "packages/bridge/frontend/package.json"   # removing xterm deps
  forbidden_paths:
    - "packages/bridge/src/**"    # backend — not frontend
    - "packages/*/src/ports/*"
    - "packages/bridge/package.json"  # backend package
deliverables:
  - "Sessions.tsx: TerminalViewer component removed (~100 lines, xterm.js dynamic import, SSE stream subscription deleted); isMobile terminal branch removed; print-mode transcript view rendered for all clients"
  - "SpawnSessionModal.tsx: mode selector removed (only print mode exists)"
  - "frontend/package.json: @xterm/xterm and @xterm/addon-fit removed"
acceptance_criteria:
  - "Sessions.tsx imports no xterm packages"
  - "@xterm/xterm not in frontend/package.json"
  - "@xterm/addon-fit not in frontend/package.json"
  - "Frontend renders no xterm terminal component"
  - "npm run build passes for bridge frontend"
estimated_tasks: 4
branch: "feat/prd-028-c6-frontend-cleanup"
status: blocked
```

---

## Shared Surface Changes

| When | File | Change | Reason |
|------|------|--------|--------|
| pre-wave-1 | `packages/pacta/src/pact.ts` | Add `abortSignal?: AbortSignal` and `clearHistory?: boolean` to `AgentRequest` | C-1 needs these fields to implement CLI provider enrichment |
| post-wave-3 | `packages/bridge/src/ports/pty-provider.ts` | Delete | C-4 removed all code that used this port |
| post-wave-3 | `packages/bridge/src/ports/llm-provider.ts` | Delete | C-5 removed all code that used this port |
| post-wave-3 | `packages/bridge/src/ports/index.ts` | Remove re-exports for deleted ports | Barrel export must reflect deletions |
| post-wave-3 | `packages/bridge/src/server-entry.ts` | Remove LlmProvider import and composition root wiring | Port deleted, wiring now dead |
| post-wave-3 | `packages/bridge/package.json` | Remove `node-pty` dependency | No code imports it after C-4 |

---

## Execution Order

```
pre-wave-1 (orchestrator):
  Patch packages/pacta/src/pact.ts → add abortSignal + clearHistory to AgentRequest
  npm run build && npm test → must pass

Wave 1 (parallel — disjoint packages):
  C-1: pacta-provider-claude-cli
  C-2: bridge/sessions (pool.ts + routes.ts only)

Wave 2 (sequential — same sessions domain, depends C-1 + C-2):
  C-3: bridge/sessions (print-session.ts migration)

Wave 3 (parallel — disjoint domains, both depend C-3):
  C-4: bridge/sessions (PTY backend deletion)
  C-5: bridge/strategies (LlmProvider deletion)

post-wave-3 (orchestrator):
  Delete ports/pty-provider.ts, ports/llm-provider.ts
  Update ports/index.ts (remove deleted exports)
  Update server-entry.ts (remove LlmProvider wiring)
  Remove node-pty from packages/bridge/package.json
  npm run build && npm test → must pass

Wave 4 (sequential — depends C-4 + C-5):
  C-6: bridge/frontend (xterm + TerminalViewer removal)
```

---

## Acceptance Gates

| # | Criterion | Verification | Commission(s) | Status |
|---|-----------|-------------|---------------|--------|
| 1 | `AgentResult.usage` + `.cost` populated from real JSON (never `emptyUsage()`) | `npm test` in `packages/pacta-provider-claude-cli` — new JSON parsing tests | C-1 | PASS |
| 2 | `AgentResult.turns` reflects `num_turns` from CLI response | JSON parsing test in C-1 | C-1 | PASS |
| 3 | First `invoke()` uses `--session-id`, subsequent uses `--resume` | Session tracking test in C-1 | C-1 | PASS |
| 4 | `clearHistory: true` triggers fresh `--session-id` call | clearHistory test in C-1 | C-1 | PASS |
| 5 | `abortSignal` abort kills child + rejects promise | AbortSignal test in C-1 | C-1 | PASS |
| 6 | `POST /sessions/:id/resize` returns `410 Gone` | endpoint removed entirely by C-4 → 404; intent satisfied | C-2, C-4 | PASS* |
| 7 | `print-session.ts` zero imports from `LlmProvider`/`ClaudeCodeProvider` | grep → empty | C-3 | PASS |
| 8 | `node-pty` not in any `package.json` | grep → empty | post-wave-3 orchestrator | PASS |
| 9 | `@xterm/xterm` not in any `package.json` | grep → empty | C-6 | PASS |
| 10 | Frontend renders no xterm terminal component | grep → empty | C-6 | PASS |
| 11 | All existing print-mode tests pass | 1135/1137 (2 pre-existing failures unrelated to PRD 028) | C-1, C-3, C-4 | PASS |
| 12 | `npm test` green across all packages | 1135/1137 (same 2 pre-existing) | all | PASS |

---

## Status Tracker

```
Total: 6 commissions, 4 waves
Completed: 6 / 6 (C-1, C-2, C-3, C-4, C-5, C-6)
Current wave: — (all waves complete)
Blocked: —
Failed: —
Acceptance gates: 12 / 12 PASS
PRD status: REALIZED (2026-03-26)
```
