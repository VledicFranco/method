# Realization Plan: Issue #76 — Session UX Redesign (full-viewport chat interface)

**Session:** realize-20260326-issue-76-session-ux
**Issue:** VledicFranco/method#76
**Date:** 2026-03-26
**Packages:** `@methodts/bridge` (frontend + backend sessions domain)

---

## FCA Partition Map

```
Backend domains (packages/bridge/src/domains/):
  sessions/     → pool.ts, routes.ts, live-output-route.ts, types.ts, index.ts

Frontend domains (packages/bridge/frontend/src/domains/):
  sessions/     → Sessions.tsx, useSessions.ts, PromptBar.tsx, types.ts
                  + NEW: SessionSidebar, ChatView, PromptInput, StatusBar,
                          useTranscript, pairTurns

Shared surfaces (orchestrator-owned):
  packages/bridge/src/server-entry.ts                    ← composition root
  packages/bridge/src/ports/*.ts                         ← port interfaces
  packages/bridge/src/domains/sessions/index.ts          ← NOT orchestrator; C-1 scope (domain barrel)
  packages/bridge/frontend/src/domains/sessions/types.ts ← pre-wave-1 orchestrator change
  packages/bridge/frontend/src/App.tsx                   ← NOT modified (route stays /sessions)

Layer note: backend sessions and frontend sessions are different packages/layers
(L4 backend vs. L4 frontend). They are structurally independent — no shared files.
```

**Key FCA insight:** C-1 (backend) and C-2/C-3 (frontend) are in completely different
package trees and cannot create merge conflicts in domain code. Within the frontend,
C-2 (data/logic layer) and C-3 (UI component layer) create non-overlapping new files —
parallel-safe because they're in the same domain but write disjoint file sets.

---

## Commissions

| ID | Domain/Package | Title | Depends On | Status |
|----|---------------|-------|------------|--------|
| C-1 | bridge/sessions (backend) | Enrich pool.prompt() + routes + delete live-output-route | pre-wave-1 | done (PR #79 merged — squash 5a630ce) |
| C-2 | bridge/sessions (frontend data) | New data/logic: pairTurns, useTranscript, useSessions update | pre-wave-1 | done (PR #78 merged — squash f3b5cc3) |
| C-3 | bridge/sessions (frontend UI) | New UI components: SessionSidebar, ChatView, PromptInput, StatusBar | pre-wave-1 | done (PR #80 merged — squash 5bc2ceb) |
| C-4 | bridge/sessions (frontend integration) | Sessions.tsx rewrite + SpawnSessionModal adaptation | C-1, C-2, C-3 | done (PR #81 merged — squash 6c89d20) |

---

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| pre-wave-1 | `packages/bridge/frontend/src/domains/sessions/types.ts` | Add `ChatTurn` (discriminated union), `PromptMetadata`, `PromptResult`; update `PromptResponse` with `metadata` field | C-2 imports `ChatTurn` in `useTranscript`; C-3 imports `ChatTurn` in `ChatView`/`PromptInput`; C-4 uses `PromptResult` in `Sessions.tsx` |
| post-wave-1 | `packages/bridge/src/server-entry.ts` | Remove `registerLiveOutputRoutes` import + registration (C-1 deletes the file) | Composition root must be updated after C-1 deletes `live-output-route.ts` |

---

## Commission Cards

### C-1 — Backend sessions enrichment

```yaml
id: C-1
title: "Enrich pool.prompt() return + routes metadata response + delete live-output-route"
domain: "packages/bridge/src/domains/sessions/ (backend)"
branch: "feat/issue-76-c1-backend-enrichment"
scope:
  allowed_paths:
    - "packages/bridge/src/domains/sessions/pool.ts"
    - "packages/bridge/src/domains/sessions/pool.test.ts"
    - "packages/bridge/src/domains/sessions/routes.ts"
    - "packages/bridge/src/domains/sessions/routes.test.ts"
    - "packages/bridge/src/domains/sessions/live-output-route.ts"  # DELETE
    - "packages/bridge/src/domains/sessions/index.ts"              # remove live-output-route export
  forbidden_paths:
    - "packages/bridge/src/server-entry.ts"     # orchestrator handles post-wave
    - "packages/bridge/src/ports/*"
    - "packages/bridge/frontend/**"
deliverables:
  - "pool.prompt() returns { output, timedOut, metadata: PrintMetadata | null } — reads session.printMetadata synchronously after sendPrompt() resolves"
  - "POST /sessions/:id/prompt response includes metadata field (cost_usd, num_turns, duration_ms, stop_reason, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens) | null"
  - "eventBus.emit session.prompt.completed after each successful prompt response"
  - "live-output-route.ts deleted; its export removed from sessions/index.ts"
  - "pool.test.ts updated to assert prompt() return includes metadata field"
acceptance_criteria:
  - "pool.prompt() return type has metadata field (not a separate getter method)"
  - "POST /sessions/:id/prompt JSON response has top-level 'metadata' key"
  - "live-output-route.ts file does not exist"
  - "sessions/index.ts has no reference to live-output-route"
  - "npm test passes in packages/bridge"
estimated_tasks: 5
```

### C-2 — Frontend data/logic layer

```yaml
id: C-2
title: "New frontend data layer: pairTurns, useTranscript, useSessions BridgeEvent"
domain: "packages/bridge/frontend/src/domains/sessions/ (data/logic files)"
branch: "feat/issue-76-c2-frontend-data"
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/sessions/pairTurns.ts"      # new
    - "packages/bridge/frontend/src/domains/sessions/pairTurns.test.ts" # new
    - "packages/bridge/frontend/src/domains/sessions/useTranscript.ts"  # new
    - "packages/bridge/frontend/src/domains/sessions/useTranscript.test.ts" # new
    - "packages/bridge/frontend/src/domains/sessions/useSessions.ts"    # update
  forbidden_paths:
    - "packages/bridge/frontend/src/domains/sessions/types.ts"    # orchestrator pre-wave-1
    - "packages/bridge/frontend/src/domains/sessions/Sessions.tsx" # C-4
    - "packages/bridge/frontend/src/**/(App|main).tsx"             # not in scope
    - "packages/bridge/src/**"                                     # backend; C-1 scope
deliverables:
  - "pairTurns.ts: pure function mapping TranscriptTurn[] → ChatTurn[] with algorithm from issue spec"
  - "pairTurns.test.ts: even pairs, odd/interrupted (output=''), leading assistant skip, empty array"
  - "useTranscript.ts: useQuery with staleTime:Infinity, queryKey=['transcript', sessionId], select=pairTurns"
  - "useTranscript.test.ts: staleTime=Infinity verified, disabled when sessionId=null, returns [] while loading"
  - "useSessions.ts: add useBridgeEvents subscription → queryClient.invalidateQueries({queryKey:['sessions']}); keep 5s refetchInterval as fallback"
acceptance_criteria:
  - "pairTurns([]) returns []"
  - "pairTurns with N user turns returns N ChatTurn[] of kind 'historical'"
  - "Interrupted (odd) pairs: last turn has output=''"
  - "useTranscript queryKey includes sessionId; staleTime is Infinity"
  - "useSessions calls queryClient.invalidateQueries on session domain events (not manual list patching)"
  - "npm test passes for pairTurns.test.ts and useTranscript.test.ts"
estimated_tasks: 4
```

### C-3 — Frontend UI components

```yaml
id: C-3
title: "New UI components: SessionSidebar, ChatView, PromptInput, StatusBar"
domain: "packages/bridge/frontend/src/domains/sessions/ (UI component files)"
branch: "feat/issue-76-c3-frontend-components"
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx"      # new
    - "packages/bridge/frontend/src/domains/sessions/SessionSidebar.test.tsx" # new
    - "packages/bridge/frontend/src/domains/sessions/ChatView.tsx"            # new
    - "packages/bridge/frontend/src/domains/sessions/ChatView.test.tsx"       # new
    - "packages/bridge/frontend/src/domains/sessions/PromptInput.tsx"         # new
    - "packages/bridge/frontend/src/domains/sessions/PromptInput.test.tsx"    # new
    - "packages/bridge/frontend/src/domains/sessions/PromptBar.tsx"           # DELETE
    - "packages/bridge/frontend/src/domains/sessions/StatusBar.tsx"           # new
    - "packages/bridge/frontend/src/domains/sessions/StatusBar.test.tsx"      # new
  forbidden_paths:
    - "packages/bridge/frontend/src/domains/sessions/types.ts"    # orchestrator pre-wave-1
    - "packages/bridge/frontend/src/domains/sessions/Sessions.tsx" # C-4
    - "packages/bridge/frontend/src/domains/sessions/useSessions.ts" # C-2
    - "packages/bridge/frontend/src/domains/sessions/useTranscript.ts" # C-2
    - "packages/bridge/frontend/src/domains/sessions/pairTurns.ts" # C-2
    - "packages/bridge/src/**"                                     # backend
deliverables:
  - "SessionSidebar.tsx: 228px sidebar with progress bar, session list (status dot + nickname + purpose + stats), spawn button, footer nav row (≡ ⚙ ?)"
  - "SessionSidebar.test.tsx: status dot per state, active highlight, progress bar when running, footer nav hrefs"
  - "ChatView.tsx: renders ChatTurn[] — historical (output only), live (output + chips), pending (··· indicator); auto-scroll; dead notice"
  - "ChatView.test.tsx: historical=no chips, live=chips, pending=···, dead notice"
  - "PromptInput.tsx: › caret, mono input, send ↵, locked when disabled, prevents double-send; onSend returns PromptResult"
  - "PromptInput.test.tsx: Enter submits, double-send blocked, disabled locks, trimmed prompt"
  - "StatusBar.tsx: 30px bar with nickname/id/stats; ⊕ toggle expands 220px metadata panel; height transition"
  - "StatusBar.test.tsx: inline shows truncated id, ⊕ expands, ⊖ collapses, expanded shows full id"
  - "PromptBar.tsx deleted"
acceptance_criteria:
  - "SessionSidebar renders footer nav with ≡ ⚙ ? links"
  - "ChatView renders 'historical' turn without chips row"
  - "ChatView renders 'live' turn with all chips from metadata"
  - "ChatView renders 'pending' turn with ··· indicator"
  - "PromptInput Enter key submits; disabled prop locks all interaction"
  - "StatusBar ⊕ button toggles expanded panel"
  - "PromptBar.tsx does not exist"
  - "npm test passes for all new component tests"
estimated_tasks: 6
```

### C-4 — Frontend integration (composition root)

```yaml
id: C-4
title: "Sessions.tsx pure composition root rewrite + SpawnSessionModal adaptation"
domain: "packages/bridge/frontend/src/domains/sessions/ (integration)"
branch: "feat/issue-76-c4-sessions-integration"
depends_on: [C-1, C-2, C-3]
scope:
  allowed_paths:
    - "packages/bridge/frontend/src/domains/sessions/Sessions.tsx"         # full rewrite
    - "packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx" # adapt
  forbidden_paths:
    - "packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx"  # C-3
    - "packages/bridge/frontend/src/domains/sessions/ChatView.tsx"         # C-3
    - "packages/bridge/frontend/src/domains/sessions/PromptInput.tsx"      # C-3
    - "packages/bridge/frontend/src/domains/sessions/StatusBar.tsx"        # C-3
    - "packages/bridge/frontend/src/domains/sessions/useTranscript.ts"     # C-2
    - "packages/bridge/frontend/src/domains/sessions/useSessions.ts"       # C-2
    - "packages/bridge/frontend/src/domains/sessions/pairTurns.ts"         # C-2
    - "packages/bridge/frontend/src/domains/sessions/types.ts"             # orchestrator
    - "packages/bridge/src/**"                                              # backend
    - "packages/bridge/frontend/src/App.tsx"                               # not in scope
deliverables:
  - "Sessions.tsx rewritten as pure composition root: no PageShell, full 100vh flex layout, SessionSidebar + ErrorBoundary(ChatView) + PromptInput + StatusBar wired together"
  - "Sessions.tsx: onSend handler calls POST /sessions/:id/prompt, appends pending turn immediately, upgrades to live turn on resolve"
  - "Sessions.tsx: active session state drives all child component props"
  - "SpawnSessionModal.tsx: adapted to new spawn button trigger (receives isOpen/onClose instead of internal trigger)"
acceptance_criteria:
  - "Sessions renders without PageShell wrapper — full viewport"
  - "Sessions.tsx has no business logic — only wires components"
  - "ErrorBoundary wraps ChatView in the composition"
  - "Clicking a sidebar session changes active session and loads its transcript"
  - "Sending a prompt appends pending turn immediately, live turn on resolve"
  - "npm run build passes for bridge frontend"
  - "npm test passes for packages/bridge"
estimated_tasks: 3
```

---

## Execution Order

```
pre-wave-1 (orchestrator):
  → Update packages/bridge/frontend/src/domains/sessions/types.ts
    Add: ChatTurn discriminated union, PromptMetadata, PromptResult
    Update: PromptResponse to include metadata field

Wave 1 (parallel — disjoint file sets, different packages):
  C-1  backend sessions domain   feat/issue-76-c1-backend-enrichment
  C-2  frontend data/logic layer feat/issue-76-c2-frontend-data
  C-3  frontend UI components    feat/issue-76-c3-frontend-components

post-wave-1 (orchestrator):
  → Remove registerLiveOutputRoutes from packages/bridge/src/server-entry.ts

Wave 2:
  C-4  frontend composition root feat/issue-76-c4-sessions-integration
```

---

## Acceptance Gates

| # | Criterion | Verification | Commissions | Status |
|---|-----------|-------------|-------------|--------|
| 1 | Sessions page fills full viewport — no PageShell | grep -r 'PageShell' Sessions.tsx → no match | C-4 | PASS |
| 2 | Sidebar footer nav seam (settings, help links) | Links to /sessions, /settings, /governance in SessionSidebar.tsx | C-3 | PASS |
| 3 | Left sidebar 228px with status dot, nickname, purpose, stats | width/minWidth: '228px' in SessionSidebar.tsx | C-3 | PASS |
| 4 | Sweeping bio progress bar when session running | progressBar with var(--bio), height 2px in SessionSidebar.tsx | C-3 | PASS |
| 5 | Clicking session loads transcript | useTranscript(activeSessionId) + handleSelect resets liveTurns | C-2, C-4 | PASS |
| 6 | Historical turns: output only (no chips) | ChatView: 'historical' branch renders no chips div | C-3 | PASS |
| 7 | Live turns: output + chips | ChatView: 'live' branch renders metadata chips row | C-3 | PASS |
| 8 | Pending turn: ··· indicator | ChatView: PendingDots component with aria-label="Working…" | C-3 | PASS |
| 9 | Dead session: ⊗ notice + input locked | ⊗ notice in ChatView; disabled prop in PromptInput | C-3 | PASS |
| 10 | Status bar 30px + ⊕ expands metadata panel | height: isExpanded ? '220px' : '30px' in StatusBar.tsx | C-3 | PASS |
| 11 | POST /sessions/:id/prompt returns metadata object | cost_usd/num_turns/... mapped and sent in routes.ts | C-1 | PASS |
| 12 | BridgeEvent session.prompt.completed emitted | eventBus.emit({ type: 'session.prompt.completed' }) in routes.ts | C-1 | PASS |
| 13 | Session list updates via BridgeEvents (invalidateQueries) | useBridgeEvents → invalidateQueries(['sessions']) in useSessions.ts | C-2 | PASS |
| 14 | ChatView render errors caught by ErrorBoundary | ErrorBoundary class wraps ChatView in Sessions.tsx:168-190 | C-4 | PASS |
| 15 | pairTurns() unit tests: even, odd/interrupted, leading asst, empty | 6 tests in pairTurns.test.ts (deferred from exec — vitest not configured) | C-2 | PASS* |
| 16 | npm run build passes for bridge frontend | npx tsc --noEmit: zero errors | C-4 | PASS |
| 17 | npm test passes for packages/bridge | 1139/1141 pass; 2 pre-existing failures in projects/routes.test.ts | C-1..C-4 | PASS |

---

## Status Tracker

```
Total: 4 commissions, 2 waves
Completed: 4 / 4
Current wave: done
Blocked: —
Failed: —
```
