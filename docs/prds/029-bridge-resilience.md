---
title: "PRD 029: Bridge Resilience — Crash Recovery, Observability & Session UX"
status: implemented
date: "2026-03-27"
tier: heavyweight
depends_on: [PRD-026, PRD-027, PRD-028]
enables: []
blocked_by: []
complexity: high
domains_affected: [sessions, shared/event-bus, pacta-core, pacta-provider-claude-cli, frontend/sessions]
---

# PRD 029: Bridge Resilience — Crash Recovery, Observability & Session UX

**Status:** Implemented (Phases 1-2, 2026-03-29) — Phase 3 deferred per spec
**Author:** Council Team (Kael, Solene, Rune, Vex, Mira, Lysander) + PO
**Date:** 2026-03-27
**Packages:** `@method/pacta`, `@method/pacta-provider-claude-cli`, `@method/bridge`
**Depends on:** PRD 027 (Pacta SDK), PRD 028 (Print-Mode Convergence), PRD 026 (Universal Event Bus)
**Organization:** Vidtecci — vida, ciencia y tecnologia
**Council session:** `.method/council/memory/bridge-resilience.yaml`

## Summary

The bridge server loses all session state on crash or restart. Sessions are not recoverable without manual API calls, two confirmed bugs silently degrade session quality, and zero bridge lifecycle events exist for crash detection. Meanwhile, Claude Code persists full conversation transcripts and PID files natively -- the bridge duplicates this work with a 30-second polling snapshot that is both lossy and redundant.

This PRD addresses four structural gaps through the FCA lens:

1. **Crash/restart recovery** -- three-phase startup recovery leveraging Claude native persistence
2. **Bug fixes** -- `createAgent`-per-prompt defeats budget enforcement; `invokedSessions` resume causes data loss
3. **Observability** -- bridge lifecycle events, AgentEvent-to-BridgeEvent sink adapter, recovery telemetry
4. **Session UX** -- URL-driven session routing, stale-mode hold during restart, recovery banners

---

## Background

### Current State

After PRD 028 (PTY removal), all sessions run via `claude --print`. Each prompt is an independent CLI invocation. The conversation state lives in Claude Code native JSONL at `~/.claude/projects/<project>/<session-id>.jsonl`, written in real-time. The bridge maintains parallel state across 14 in-memory Maps in `pool.ts` -- all volatile, all lost on crash.

The bridge persistence (`session-persistence.ts`) writes a JSONL index at `.method/sessions/session-index.jsonl` every 30 seconds via a `setInterval` in `server-entry.ts`. This captures a subset of session metadata (nickname, purpose, status, prompt count) but not chain hierarchies, budget state, or diagnostics. After restart, the pool starts empty. Resume is manual via `POST /sessions/history/:id/resume`.

### Claude Code Native Persistence

| Path | Contents | Written |
|------|----------|---------|
| `~/.claude/projects/<project>/<session-id>.jsonl` | Full conversation (messages, tool calls, usage) | Real-time, per message |
| `~/.claude/sessions/<pid>.json` | PID, sessionId, cwd, startedAt, kind | On process start |
| `~/.claude/projects/<project>/<session-id>/subagents/` | Sub-agent transcripts + metadata | Per sub-agent |

The bridge should leverage this native persistence instead of maintaining a redundant, delayed copy.

### Confirmed Bugs

**BUG-1: `createAgent` called per-prompt (severity: HIGH)**

In `print-session.ts` line 323, `createAgent({ pact, provider })` is called inside every `sendPrompt()` invocation. This reconstructs the middleware pipeline each time, causing `budgetEnforcer` to start with a fresh `BudgetState` (`turnsUsed: 0`, cost reset). Cross-prompt budget enforcement is silently defeated. A pact with `budget: { maxTurns: 10 }` will never trigger budget exhaustion because `state.turns` never exceeds 1.

**BUG-2: `invokedSessions` map causes data loss on resume (severity: HIGH)**

After bridge restart, `claudeCliProvider.invokedSessions` is empty. When a session is resumed with the same ID, the provider uses `--session-id` instead of `--resume`. Claude CLI interprets `--session-id` as "start new conversation with this ID" -- prior context is lost.

---

## Alternatives Considered

### Alternative 1: Full Event-Sourcing

**Approach:** Derive all session state from a fold over the BridgeEvent log. On restart, replay the full event stream to reconstruct pool state.

**Pros:** FP-purest approach (state = fold over events). Single source of truth. Enables time-travel debugging and audit trails.

**Cons:** Requires event schema versioning and upcasters. Replay time grows with event log size. The event vocabulary is not yet stable (PRD 027 is recent). Adds replay engine infrastructure that has no other consumer.

**Why rejected:** Schema instability makes event-sourcing premature. The council converged on checkpoint-on-transition as the FP-pragmatic alternative -- immutable checkpoint snapshots triggered by events, without full replay infrastructure. Revisit when event schema stabilizes and audit trail features are needed.

### Alternative 2: Database-backed Session State

**Approach:** Replace in-memory Maps with SQLite or similar embedded database. Session state survives crashes natively via database durability.

**Pros:** Immediate crash recovery with zero custom code. ACID guarantees. Query capability for free.

**Cons:** Adds a runtime dependency (`better-sqlite3` or similar) to a project that currently has zero database dependencies. Violates FCA P3 (port pattern) unless wrapped in a port -- but the port would be heavier than the current persistence approach. Overkill for single-node bridge with <100 concurrent sessions.

**Why rejected:** The bridge is a single-node process managing a small number of sessions. The checkpoint-on-transition model via JSONL gives sufficient durability without introducing a database dependency. If session counts grow to 1000+, this alternative should be revisited.

### Alternative 3: Clean-Slate Restart (Status Quo + Resume API)

**Approach:** Keep current behavior -- pool starts empty on restart. Improve the manual resume API to be easier to use. Frontend prompts user to resume sessions from history.

**Pros:** Simplest implementation. No new infrastructure. Users explicitly decide what to resume.

**Cons:** Every restart is disruptive. Multi-agent orchestrations (Genesis chains) lose all context. The user must know about the resume API. Does not fix BUG-1 or BUG-2.

**Why rejected:** Manual recovery is a design failure for a system that hosts long-running agent orchestrations. The three-phase automatic recovery is justified by the Genesis use case alone -- losing a multi-hour orchestration chain because the bridge process restarted is unacceptable.

---

## Scope

### In Scope

- Automatic session recovery on bridge restart (three-phase: discover, reconcile, hydrate)
- BUG-1 fix: `createAgent` called once per session, budget enforcement across prompts
- BUG-2 fix: resumed sessions use `--resume` via `resumeSessionId`
- Pacta L3 additions: `RecoveryIntent`, `AgentState`, optional `dispose()`
- Bridge lifecycle events (`bridge_starting` through `bridge_ready`)
- Synchronous crash handler (`uncaughtException` writes to JSONL)
- Event-driven session checkpointing (replaces 30s polling)
- `NativeSessionDiscovery` port for Claude PID file reading
- AgentEvent-to-BridgeEvent sink adapter
- Frontend URL-driven session routing (`/sessions/:id`)
- Frontend stale-mode hold and recovery banners
- Frontend bridge health indicator

### Out of Scope / Non-Goals

- **Distributed session state** -- this is a single-node bridge. No consensus protocols or shared databases.
- **Process supervision** -- the bridge does not keep Claude processes alive. Print-mode is stateless between prompts. Recovery means restoring metadata, not reconnecting to running processes.
- **Automatic prompt retry** -- the bridge does not know if a mid-flight prompt was idempotent. Recovery restores the session; the user decides whether to retry.
- **Frontend offline mode** -- no service workers, no local transcript persistence. The backend is the source of truth.
- **Full event-sourcing** -- deferred to Phase 3 until event schema stabilizes.
- **`SessionStore` port at Pacta L3** -- deferred until a second production L4 consumer exists.
- **Cross-session dependency tracking** -- recovery restores individual sessions, not inter-session causal relationships (e.g., "session B depends on session A's output").
- **`handleSessionDeath` regression fix** -- acknowledged but deferred to Phase 3 stretch.

---

## Architecture & FCA Compliance

### Layer Stack

```
L4  Bridge application
    ├── src/
    │   ├── startup-recovery.ts              NEW — composition root recovery orchestration
    │   ├── server-entry.ts                  MOD — lifecycle events, crash handler, remove 30s setInterval
    │   ├── ports/
    │   │   └── native-session-discovery.ts  NEW — port interface for Claude PID file reading
    │   ├── shared/event-bus/
    │   │   ├── session-checkpoint-sink.ts   NEW — EventSink, event-driven persistence
    │   │   └── agent-event-adapter.ts       NEW — AgentEvent→BridgeEvent mapping
    │   └── domains/sessions/
    │       ├── pool.ts                      MOD — restoreSession() API
    │       └── print-session.ts             MOD — agent hoisting, onEvent, resumeSessionId
    └── frontend/src/domains/sessions/
        ├── Sessions.tsx                     MOD — URL params, recovery banners
        ├── useSessions.ts                   MOD — stale-mode hold
        ├── SessionSidebar.tsx               MOD — health indicator
        └── App.tsx                          MOD — /sessions/:id? route

L3  Pacta SDK (@method/pacta)
    ├── src/
    │   ├── pact.ts                          MOD — RecoveryIntent type, recovery field on Pact
    │   ├── agent.ts                         MOD — AgentState, Agent.state, Agent.dispose()
    │   └── engine/create-agent.ts           MOD — state accumulation wrapper

    Pacta CLI Provider (@method/pacta-provider-claude-cli)
    └── src/claude-cli-provider.ts           UNCHANGED — existing resumeSessionId path suffices

L2  MethodTS (@method/methodts)              UNCHANGED
L0  Types (@method/types)                    UNCHANGED
```

Dependencies flow downward only (L4→L3→L2→L0). No upward dependencies introduced.

### Domain Decomposition

| Domain | Impact | Changes |
|--------|--------|---------|
| `sessions` (backend) | Modified | `pool.restoreSession()`, print-session agent hoisting, `resumeSessionId` wiring |
| `shared/event-bus` (backend) | Modified + new files | `session-checkpoint-sink.ts`, `agent-event-adapter.ts` |
| `pacta` core (L3) | Modified | `RecoveryIntent`, `AgentState`, `Agent.state`, `Agent.dispose()` |
| `pacta-provider-claude-cli` (L3) | Unchanged | No API changes (uses existing `resumeSessionId` path) |
| `sessions` (frontend) | Modified | URL routing, stale-mode, recovery banners, health indicator |
| `strategies` (backend) | Unaffected | No changes |
| `triggers` (backend) | Unaffected | No changes |
| `projects` (backend) | Unaffected | No changes |
| `registry` (backend) | Unaffected | No changes |
| `methodology` (backend) | Unaffected | No changes |

### FCA Gate Impact Assessment

| Gate | Impact | Details |
|------|--------|---------|
| G-PORT | New port | `NativeSessionDiscovery` in `ports/`. Reads Claude CLI PID files -- external I/O through port interface. |
| G-BOUNDARY | No violations | Sinks in `shared/event-bus/` (cross-domain infrastructure). Startup recovery at composition root. No cross-domain imports. |
| G-LAYER | No violations | L4 (bridge) reads L3 (Pacta) types -- correct downward flow. No upward dependencies. |

### Cross-Domain Impact Matrix

| Domain | Change Type | Files Affected | Port Changes | Test Impact | Doc Impact |
|--------|------------|----------------|--------------|-------------|------------|
| pacta core | API addition | `pact.ts`, `agent.ts`, `create-agent.ts` | None | New `AgentState` contract tests | README update |
| pacta-cli-provider | None | None | None | None | None |
| sessions (backend) | Modified | `pool.ts`, `print-session.ts` | None | `pool.test.ts`, `print-session.test.ts` extended | README update (I-9, file index) |
| shared/event-bus | New files | `session-checkpoint-sink.ts`, `agent-event-adapter.ts` | None | 2 new test files | None |
| bridge root | New files | `startup-recovery.ts`, `server-entry.ts` | `NativeSessionDiscovery` port | 1 new test file, `architecture.test.ts` gate | System-level invariants doc |
| sessions (frontend) | Modified | `Sessions.tsx`, `useSessions.ts`, `SessionSidebar.tsx`, `App.tsx` | None | Frontend tests (deferred -- vitest) | None |

### Dependencies

**Depends on:**
- PRD 026 (Universal Event Bus) -- checkpoint sink and lifecycle events use EventBus infrastructure
- PRD 027 (Pacta SDK) -- `AgentState` and `RecoveryIntent` extend the Pact type system
- PRD 028 (Print-Mode Convergence) -- print-only sessions simplify recovery (no PTY state to restore)

**Enables:**
- Future `SessionStore` port at L3 (Phase 3 deferred) -- `RecoveryIntent` is the prerequisite
- Recovery telemetry dashboard -- lifecycle events provide the data
- Graceful shutdown hardening -- checkpoint infrastructure is the prerequisite

**Blocked by:** Nothing -- all dependencies are already implemented.

### Shared Surface Protocol (for `/realize` orchestration)

When this PRD is realized via `/realize`, the orchestrator must manage these shared surfaces between commission waves:

| Timing | Surface | Change | Why |
|--------|---------|--------|-----|
| Pre-Phase-1 | `packages/pacta/src/pact.ts` | Add `RecoveryIntent` type + `recovery` field on `Pact` | Phase 1 commissions consume this type in print-session.ts and startup-recovery.ts |
| Pre-Phase-1 | `packages/pacta/src/agent.ts` | Add `AgentState` interface + `readonly state` + optional `dispose()` on `Agent` | Phase 1 bridge commissions read `agent.state` |
| Pre-Phase-1 | `packages/pacta/src/engine/create-agent.ts` | Add state accumulation wrapper | Must exist before print-session.ts hoists `createAgent` |
| Pre-Phase-1 | `packages/bridge/src/ports/event-bus.ts` | Add `'agent'` to `EventDomain` union type | Required by agent-event-adapter.ts before it can emit events |
| Between Phase 1 and Phase 2 | `packages/bridge/src/ports/native-session-discovery.ts` | Export port interface | Frontend stale-mode (P2.2) depends on backend recovery being wired |
| Between Phase 1 and Phase 2 | Bridge lifecycle events must be emitting | `system.bridge_ready` must exist | Frontend P2.2-P2.4 consume this event |

**Frozen surfaces (contracts that must not change during implementation):**

| Surface | Contract | Consumers |
|---------|----------|-----------|
| `AgentState` field names | `turnsExecuted`, `totalUsd`, `totalTokens`, `invocationCount` | bridge pool, bridge diagnostics, future dashboards |
| `RecoveryIntent` enum values | `'resume' \| 'restart' \| 'abandon'` | startup-recovery.ts, future SessionStore |
| `NativeSessionDiscovery.listLiveSessions()` return shape | `Promise<NativeSessionInfo[]>` | startup-recovery.ts |
| `system.bridge_ready` event payload | `{ uptimeMs, sessionsActive }` | frontend useSessions stale-mode, GenesisSink |
| AgentEvent→BridgeEvent mapping | `agent.` prefix, `domain: 'agent'`, severity mapping | all event bus consumers |

---

## Phase 1 -- Bug Fixes + Core Recovery Primitives

### P1.1 -- Fix `createAgent`-per-prompt (BUG-1)

**Files:** `packages/bridge/src/domains/sessions/print-session.ts`, `packages/pacta/src/agent.ts`

**Bridge fix:** Move `createAgent()` from `sendPrompt()` to `createPrintSession()` scope. Store the agent as a closure variable. `sendPrompt()` calls `agent.invoke(request)` on the pre-existing agent.

**Pacta enhancement:** Add `readonly state: AgentState` to the `Agent` interface:

```typescript
export interface AgentState {
  turnsExecuted: number;
  totalUsd: number;
  totalTokens: number;
  invocationCount: number;
}
```

`createAgent()` owns `AgentState` accumulation via a thin tracking wrapper that always runs, regardless of middleware configuration. The state reflects the last completed invocation (not in-flight state). This eliminates the bridge `cumulativeCostUsd` shadow counter. Field `totalUsd` matches the existing `CostReport.totalUsd` naming convention in Pacta.

### P1.2 -- Fix `invokedSessions` resume data loss (BUG-2)

**Files:** `packages/bridge/src/domains/sessions/print-session.ts`

For recovered sessions, the bridge sets `request.resumeSessionId` on the first `AgentRequest` after recovery. The existing provider logic in `claudeCliProvider` already handles `resumeSessionId` as a fallback path (checking `request.resumeSessionId` before falling back to the `invokedSessions` map). No provider API changes needed.

The bridge's `sendPrompt()` must pass `resumeSessionId` when the session was restored from persistence (i.e., it was not freshly spawned in this bridge process). This is a one-field addition to the `AgentRequest` constructed in `print-session.ts`.

### P1.3 -- `RecoveryIntent` on Pact (L3)

**File:** `packages/pacta/src/pact.ts`

```typescript
export type RecoveryIntent = 'resume' | 'restart' | 'abandon';

export interface Pact {
  recovery?: RecoveryIntent;
}
```

- `resume` -- orchestrator should continue from where the session was interrupted
- `restart` -- create a fresh session (same config, new conversation)
- `abandon` -- do not attempt recovery (ephemeral sub-agents)

### P1.4 -- Checkpoint-on-Transition EventSink

**File:** `packages/bridge/src/shared/event-bus/session-checkpoint-sink.ts` (new)

Replace the 30-second `setInterval` persistence loop with a `SessionCheckpointSink` that subscribes to the event bus. Checkpoints fire on: `session.spawned`, `session.prompt.completed`, `session.killed`, `session.dead`, `session.state_changed`.

The sink writes to `.method/sessions/session-index.jsonl` using the existing `SessionPersistenceStore` but event-driven, not polled. Reduces the data loss window from 30 seconds to sub-second (~200ms debounce). This is an accepted tradeoff -- zero-loss would require synchronous writes on every transition, which is disproportionate for the use case.

### P1.5 -- `NativeSessionDiscovery` Port

**File:** `packages/bridge/src/ports/native-session-discovery.ts` (new)

```typescript
export interface NativeSessionInfo {
  sessionId: string;
  pid: number;
  projectPath: string;
  startedAt: number;
}

export interface NativeSessionDiscovery {
  listLiveSessions(): Promise<NativeSessionInfo[]>;
}
```

Production implementation reads `~/.claude/sessions/<pid>.json` files, checks PID liveness via `process.kill(pid, 0)`, and verifies the process is actually a Claude CLI instance (process name/command-line check) to guard against PID recycling false positives. Injected at the composition root.

**Fragility note:** The production implementation depends on undocumented Claude Code internal files (`~/.claude/sessions/*.json`). If the format changes, only the `NativeSessionDiscovery` adapter needs updating -- the port interface is stable.

### P1.6 -- Startup Recovery Module

**File:** `packages/bridge/src/startup-recovery.ts` (new — composition root level, not inside a domain)

This is composition-root orchestration logic: it reads from the persistence store, calls `NativeSessionDiscovery`, cross-references both sources, and calls domain methods. It does not belong inside any domain directory.

Three-phase recovery executed during `start()`, before `app.listen()`:

**Phase 1 -- Discover:** Read `SessionPersistenceStore.loadAll()` + `NativeSessionDiscovery.listLiveSessions()`.

**Phase 2 -- Reconcile:** Cross-reference:
- Persisted + PID alive + process verified as Claude = restore as `recovering` (not `ready` — the Claude process may be mid-prompt with no stdout pipe). The session is visible in the UI but blocks new prompts until the first successful prompt transitions it to `ready`.
- Persisted + PID dead = mark as `dead` (tombstone for history)
- No persistence record = skip (orphan, log only)

**Phase 3 -- Hydrate:** For each restorable session, call `pool.restoreSession(snapshot)`. The first prompt on a recovered session uses `request.resumeSessionId` to ensure `--resume` (see P1.2).

**Genesis dedup:** Before spawning a new Genesis session, check if a genesis-tagged session was recovered. If so, adopt it instead of re-spawning.

### P1.7 -- Bridge Lifecycle Events

**File:** `packages/bridge/src/server-entry.ts`

| Event Type | When | Payload |
|------------|------|---------|
| `system.bridge_starting` | Before replay | `{ version, port, config }` |
| `system.recovery_started` | Before discovery | `{ persistedCount }` |
| `system.recovery_completed` | After hydration | `{ recovered, failed, tombstoned }` |
| `system.bridge_ready` | After recovery + listen | `{ uptimeMs, sessionsActive }` |
| `system.bridge_stopping` | On SIGTERM/SIGINT | `{ signal, activeSessions }` |

**Critical ordering:** `system.bridge_ready` fires AFTER recovery completes.

Add `process.on('uncaughtException')` handler that writes `system.crash` event **synchronously** via `fs.writeFileSync` directly to the persistence JSONL file (bypassing the async EventBus, which may be in a broken state during an uncaught exception). Then calls `process.exit(1)`. Does not attempt async PersistenceSink flush -- the process state is undefined after an uncaught exception and async I/O is unreliable.

### P1.8 -- AgentEvent to BridgeEvent Sink Adapter

**File:** `packages/bridge/src/shared/event-bus/agent-event-adapter.ts` (new)

Maps Pacta `AgentEvent` types to `BridgeEvent`:
- `AgentEvent.type` prefixed with `agent.` (e.g., `started` becomes `agent.started`)
- `domain: 'agent'` (new EventDomain value)
- `sessionId` and `projectId` attached from bridge context
- Severity mapping: `error`/`budget_exhausted` to `error`, `budget_warning` to `warning`, else `info`

Wired via `createAgent` `onEvent` callback in `print-session.ts`.

### P1.9 -- `pool.restoreSession()` Domain API

**File:** `packages/bridge/src/domains/sessions/pool.ts`

New method on `SessionPool`:

```typescript
restoreSession(snapshot: SessionSnapshot): void
```

Hydrates internal Maps (sessions, metadata, chains, nicknames, purposes, workdirs, worktrees, modes) from a recovery snapshot without spawning a new Claude process.

---

## Phase 2 -- Frontend Recovery UX

### P2.1 -- URL-Driven Session Routing

**Files:** `packages/bridge/frontend/src/App.tsx`, `packages/bridge/frontend/src/domains/sessions/Sessions.tsx`

Change route to `/sessions/:id?`. Read `activeSessionId` from `useParams()`, use `useNavigate()` in `handleSelect`. Enables deep-linking, browser history, bookmarks, and multi-tab.

### P2.2 -- Stale-Mode Hold During Restart

**File:** `packages/bridge/frontend/src/domains/sessions/useSessions.ts`

When WebSocket disconnects: retain last-known session list in memory, enter stale mode (visual dimming, amber indicator). Never flash an empty session list. On `system.bridge_ready` event: re-fetch, diff against stale list, un-dim recovered sessions, mark lost sessions.

### P2.3 -- Recovery Banners

**File:** `packages/bridge/frontend/src/domains/sessions/Sessions.tsx`

Two distinct banners on `system.bridge_ready`:
- **Recovery banner** (info): "Bridge reconnected -- N sessions recovered" (auto-dismiss 8s)
- **Loss banner** (warning, persistent): "N sessions could not be recovered" (dismissible)

### P2.4 -- Bridge Health Indicator

**File:** `packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx`

Connection status in sidebar: connected (green dot) / reconnecting (amber pulse) / disconnected (red). Uses existing `ws-manager` connection state.

---

## Accepted Tradeoffs

| Tradeoff | Rationale |
|----------|-----------|
| Checkpoint data loss window (~200ms) | Event-driven checkpointing reduces from 30s to sub-second. Zero-loss would require synchronous writes on every transition — disproportionate. |
| Crash gap between state transition and event emission | Sub-millisecond window where state changes but event hasn't fired. Acceptable for Phase 1. |
| `NativeSessionDiscovery` depends on undocumented Claude CLI internals | Port abstraction isolates the fragility — only the adapter implementation needs updating if format changes. |

## Phase 3 -- Deferred Items

| Item | Trigger for inclusion |
|------|----------------------|
| `SessionStore` port at Pacta L3 | Second production L4 consumer needs portable session persistence |
| Full event-sourcing | Event schema stabilizes + audit trail / time-travel features needed |
| Recovery telemetry dashboard | After Phase 1 recovery lands and we have usage data |
| Graceful shutdown checkpoint-before-kill | Phase 1 stretch goal or Phase 2 follow-up |
| Session grouping, keyboard nav, scroll persistence | UX polish after core recovery is stable |
| `handleSessionDeath` regression fix | Phase 1 stretch -- error events swallowed after PTY removal |
| Frontend test infrastructure (vitest setup) | Blocks frontend component test execution |

---

## Files Affected

### New Files
- `packages/bridge/src/ports/native-session-discovery.ts` -- NativeSessionDiscovery port
- `packages/bridge/src/startup-recovery.ts` -- Three-phase recovery (composition root level)
- `packages/bridge/src/shared/event-bus/session-checkpoint-sink.ts` -- Event-driven persistence sink
- `packages/bridge/src/shared/event-bus/agent-event-adapter.ts` -- AgentEvent-to-BridgeEvent adapter

### New Test Files (co-located per FCA P4)
- `packages/bridge/src/startup-recovery.test.ts`
- `packages/bridge/src/shared/event-bus/session-checkpoint-sink.test.ts`
- `packages/bridge/src/shared/event-bus/agent-event-adapter.test.ts`
- `packages/bridge/src/ports/native-session-discovery.test.ts`

### Modified Files
- `packages/pacta/src/pact.ts` -- Add `RecoveryIntent`, `recovery` field
- `packages/pacta/src/agent.ts` -- Add `readonly state: AgentState`, optional `dispose()`
- `packages/pacta/src/engine/create-agent.ts` -- Own `AgentState` accumulation wrapper
- `packages/bridge/src/domains/sessions/print-session.ts` -- Hoist `createAgent`, wire `onEvent`, set `resumeSessionId` for recovered sessions
- `packages/bridge/src/domains/sessions/pool.ts` -- Add `restoreSession()` method
- `packages/bridge/src/domains/sessions/pool.test.ts` -- Add `restoreSession()` tests
- `packages/bridge/src/domains/sessions/print-session.test.ts` -- Add agent hoisting + budget accumulation tests
- `packages/bridge/src/shared/architecture.test.ts` -- Add I-9 gate (createAgent call count in print-session.ts)
- `packages/bridge/src/server-entry.ts` -- Lifecycle events, startup recovery call, remove 30s setInterval, uncaughtException handler
- `packages/bridge/src/domains/sessions/README.md` -- Update file index, module table, add I-9
- `packages/pacta/README.md` -- Document AgentState, RecoveryIntent, Agent.state
- `packages/bridge/frontend/src/App.tsx` -- Route `/sessions/:id?`
- `packages/bridge/frontend/src/domains/sessions/Sessions.tsx` -- URL params, recovery banners
- `packages/bridge/frontend/src/domains/sessions/useSessions.ts` -- Stale-mode hold
- `packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx` -- Health indicator

### Removed
- 30-second `setInterval` persistence loop in `server-entry.ts`

---

## Acceptance Criteria

### Phase 1
- [ ] `createAgent` called once per session, not per prompt. Budget enforcement works across prompts.
- [ ] Resumed sessions use `--resume`, not `--session-id`. No conversation context loss.
- [ ] `Pact` type includes optional `recovery: RecoveryIntent` field
- [ ] `Agent` interface exposes `readonly state: AgentState`
- [ ] Session state checkpointed on every state transition, not on 30s interval
- [ ] `NativeSessionDiscovery` port reads Claude PID files and checks liveness
- [ ] On bridge restart, live sessions are automatically recovered into the pool
- [ ] `system.bridge_ready` event fires after recovery completes, contains recovery stats
- [ ] `process.on('uncaughtException')` writes `system.crash` synchronously to JSONL before exit
- [ ] AgentEvents from Pacta flow to BridgeEvent bus via sink adapter
- [ ] Each new module has co-located test file with core-path coverage
- [ ] Budget enforcement integration test: 3 prompts accumulate, 4th triggers exhaustion
- [ ] Startup recovery integration test: seed persistence + mock PIDs, verify pool hydration
- [ ] I-9 architecture gate: `createAgent` appears exactly once in `print-session.ts`
- [ ] `npm test` passes across all packages
- [ ] `npm run build` passes

### Phase 2
- [ ] `/sessions/:id` route works -- deep-linking, back/forward, bookmarks
- [ ] Session list retains last-known state on WebSocket disconnect (stale styling), re-fetches on `bridge_ready`
- [ ] Recovery banner appears on `bridge_ready` with session count
- [ ] Connection status visible in sidebar

---

## Success Metrics

| Metric | Target | Measurement Method | Current Baseline |
|--------|--------|-------------------|-----------------|
| Session recovery rate | 100% of sessions with live backing process recovered | `system.recovery_completed` event payload: `recovered / (recovered + failed)` | 0% (no recovery exists) |
| Recovery time (bridge restart to `bridge_ready`) | < 5 seconds for up to 20 sessions | Timestamp delta between `bridge_starting` and `bridge_ready` events | N/A (new) |
| Data loss window (checkpoint latency) | < 1 second | Time between session state transition and checkpoint write completion | 30 seconds (current polling interval) |
| Budget enforcement accuracy | Budget exhaustion triggers after exactly `maxTurns` prompts | Integration test: N prompts accumulate, N+1 triggers exhaustion | Broken (resets every prompt -- BUG-1) |
| Resume context preservation | Zero conversation context loss on session resume | Integration test: resume uses `--resume` flag, Claude sees prior turns | Broken (uses `--session-id` -- BUG-2) |
| Frontend navigation state survival | Active session preserved across page refresh and navigation | URL contains session ID; refresh returns to same session | Lost on every refresh |

### Non-Functional Requirements

- **Backwards compatibility:** Existing sessions created before PRD 029 remain accessible via the history API. The checkpoint sink does not corrupt the existing `session-index.jsonl` format.
- **Performance:** Checkpoint writes do not block the event loop (debounced async I/O, not synchronous). Recovery phase completes within 5 seconds for 20 sessions.
- **Crash safety:** The `uncaughtException` handler must complete its synchronous write within 100ms. No async I/O in the crash path.

---

## Risks & Mitigations

| # | Risk | Severity | Likelihood | Impact | Mitigation |
|---|------|----------|-----------|--------|-----------|
| R1 | Claude CLI PID file format changes in a future Claude update | High | Medium | `NativeSessionDiscovery` fails to parse PID files; recovery stops discovering live sessions | Port abstraction isolates the fragility. Defensive JSON parsing with fallback to "assume dead." Pin minimum Claude CLI version in docs. |
| R2 | PID recycling causes false-positive liveness detection | Medium | Low (Linux), Medium (Windows) | A dead session's PID is reassigned to an unrelated process; recovery incorrectly restores it | Process-name/command-line verification alongside PID check. Cross-reference `startedAt` timestamp from PID file against actual process start time. |
| R3 | Recovered session is mid-prompt (phantom session) | High | Medium | Session restored as `recovering` but the orphaned Claude process completes and writes output that nobody reads | `recovering` status blocks new prompts. First prompt after recovery uses `--resume` which picks up Claude's conversation state. Orphaned process output is captured in Claude's native JSONL (transcript reader will see it). |
| R4 | Checkpoint sink write failure during high event throughput | Medium | Low | Session state not persisted; next crash loses that session's latest state | Debounced writes with retry-on-next-event pattern. PersistenceSink already handles this. Data loss window is ~200ms, not 30s. |
| R5 | Genesis spawned twice after restart (dedup race) | Medium | Medium | Two Genesis sessions compete for event batches, wasting budget and producing conflicting actions | Genesis dedup check in startup-recovery: scan recovered sessions for `metadata.genesis === true` before calling `spawnGenesis()`. |
| R6 | Frontend shows stale session list during extended outage | Low | Low | User sees dimmed sessions that have been dead for minutes | Stale-mode indicator clearly communicates "bridge connection lost." On `bridge_ready`, full refresh reconciles state. Timeout after 60s of disconnect shows "bridge unreachable" banner. |

---

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `packages/bridge/src/domains/sessions/README.md` | Update | Add I-9 invariant, update file index and module table with new files |
| `packages/bridge/src/README.md` or `docs/arch/bridge-resilience.md` | Create | System-level invariants I-8 (recovery fidelity) and I-10 (lifecycle observability) |
| `packages/pacta/README.md` | Update | Document `AgentState`, `RecoveryIntent`, `Agent.state`, `Agent.dispose()` |
| `CLAUDE.md` | Update | Add `native-session-discovery.ts` to ports listing, `agent-event-adapter.ts` and `session-checkpoint-sink.ts` to event-bus listing, note startup recovery in server-entry description |
| `packages/bridge/src/shared/event-bus/index.ts` | Update | Re-export new sinks (checkpoint sink, agent-event adapter) |
| `packages/bridge/src/ports/index.ts` | Update | Re-export `NativeSessionDiscovery` interface |

---

## Rollback Plan

**Phase 1 rollback:** If recovery introduces instability, disable by setting `RECOVERY_ENABLED=false` env var (checked in startup-recovery.ts). The bridge starts with an empty pool as before. The checkpoint sink and lifecycle events remain active (independent of recovery). BUG-1 and BUG-2 fixes are non-revertible improvements.

**Phase 2 rollback:** Frontend changes are purely additive. URL routing can be reverted to the non-parameterized route. Stale-mode hold and banners can be disabled by removing the `bridge_ready` event listener.

---

## Open Questions

| # | Question | Owner | Status |
|---|----------|-------|--------|
| OQ-1 | Exact Claude CLI PID file JSON schema -- needs documentation from observed files | Implementation team | Open -- investigate before P1.5 implementation |
| OQ-2 | Should `recovering` status have a TTL (auto-tombstone after N seconds of no successful prompt)? | PO | Open -- decide during P1.6 implementation |
| OQ-3 | Default `RecoveryIntent` when unset -- `'resume'` (recover by default) or undefined (opt-in)? | PO | Open -- decide during P1.3 implementation |

---

## Domain Invariants (Extensions)

### Sessions domain (`packages/bridge/src/domains/sessions/README.md`)

**I-9: Composition-time integrity**

`createAgent()` is called exactly once per session lifetime, at session construction. The resulting agent is reused for all prompts. Middleware state (budget enforcement, cost tracking) accumulates across prompts, never resets. Enforced by architecture gate test in `architecture.test.ts`.

### System-level (`packages/bridge/src/README.md` or `docs/arch/bridge-resilience.md`)

**I-8: Recovery fidelity**

After bridge restart, every session that had a live Claude CLI process is automatically recovered into the pool with its metadata intact. No manual API call required. Sessions whose backing process died are marked dead, not silently dropped. Recovered sessions start in `recovering` status until the first successful prompt transitions them to `ready`.

**I-10: Lifecycle observability**

Every bridge state transition (starting, ready, stopping) emits a typed `BridgeEvent`. Every recovery attempt emits telemetry. A consumer subscribed to the event bus can reconstruct the bridge lifecycle without access to logs. Crash events are written synchronously to survive process termination.

---

## References

- Council session: `.method/council/memory/bridge-resilience.yaml`
- Council transcript: `tmp/council-debate-transcript.md`
- PRD 027: `docs/prds/027-pacta.md` (Pacta SDK)
- PRD 028: `docs/prds/028-pacta-print-mode-convergence.md` (Print-mode, PTY removal)
- PRD 026: `docs/prds/026-universal-event-bus.md` (EventBus)
- FCA spec: `docs/fractal-component-architecture/`
- Sessions domain invariants: `packages/bridge/src/domains/sessions/README.md`
- Review report: `tmp/action-plan-prd029-2026-03-27.md`
