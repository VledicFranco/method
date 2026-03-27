# Realization Plan: PRD 029 — Bridge Resilience

**Session:** realize-20260327-prd-029-bridge-resilience
**PRD:** docs/prds/029-bridge-resilience.md
**Date:** 2026-03-27
**Packages:** @method/pacta, @method/pacta-provider-claude-cli, @method/bridge

---

## FCA Partition Map

```
L3 packages (pre-wave — orchestrator applies directly):
  pacta/src/pact.ts              RecoveryIntent type + recovery field
  pacta/src/agent.ts             AgentState, Agent.state, Agent.dispose()
  pacta/src/engine/create-agent.ts  State accumulation wrapper

L4 backend — Wave 1 (parallel commissions, disjoint file sets):
  C-1  sessions domain        pool.ts, print-session.ts
  C-2  shared/event-bus       session-checkpoint-sink.ts, agent-event-adapter.ts
  C-3  composition root       startup-recovery.ts, server-entry.ts, native-session-discovery.ts

L4 frontend — Wave 2 (depends on Wave 1):
  C-4  frontend sessions      Sessions.tsx, useSessions.ts, SessionSidebar.tsx, App.tsx
```

---

## Commissions

| ID | Domain/Package | Title | Depends On | Status |
|----|---------------|-------|------------|--------|
| C-1 | bridge/sessions (backend) | Bug fixes + pool.restoreSession API | pre-wave-0 | pending |
| C-2 | bridge/shared/event-bus | Checkpoint sink + AgentEvent adapter | pre-wave-0 | pending |
| C-3 | bridge/composition-root + ports | Startup recovery + lifecycle events + crash handler | pre-wave-0 | pending |
| C-4 | bridge/frontend/sessions | URL routing + stale-mode + recovery banners + health indicator | C-1, C-2, C-3 | blocked |

---

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| pre-wave-0 | pacta/src/pact.ts | Add RecoveryIntent + recovery field | C-1, C-3 consume |
| pre-wave-0 | pacta/src/agent.ts | Add AgentState + state + dispose() | C-1 reads agent.state |
| pre-wave-0 | pacta/src/engine/create-agent.ts | State accumulation wrapper | C-1 hoists createAgent |
| pre-wave-0 | bridge/src/ports/event-bus.ts | Add agent to EventDomain | C-2 needs for adapter |
| post-wave-1 | None | Lifecycle events exist on master | C-4 consumes bridge_ready |

---

## Execution Order

```
pre-wave-0 (orchestrator):
  Apply L3 Pacta changes + EventDomain update
  Verify: npm run build && npm test

Wave 1 (parallel):
  C-1  sessions domain
  C-2  shared/event-bus
  C-3  composition root

post-wave-1 (orchestrator):
  Merge C-1, C-2, C-3 sequentially
  Verify: npm run build && npm test

Wave 2:
  C-4  frontend sessions

post-wave-2 (orchestrator):
  Merge C-4, full gate check, report
```

---

## Acceptance Gates

| # | Criterion | Commissions | Status |
|---|-----------|-------------|--------|
| 1 | createAgent called once per session (I-9 gate) | C-1 | pending |
| 2 | Budget enforcement: 3 prompts accumulate, 4th exhausts | C-1 | pending |
| 3 | Resumed sessions use --resume | C-1 | pending |
| 4 | pool.restoreSession hydrates without spawning | C-1 | pending |
| 5 | Checkpoint sink fires on session lifecycle events | C-2 | pending |
| 6 | AgentEvent to BridgeEvent mapping correct | C-2 | pending |
| 7 | system.bridge_ready fires after recovery | C-3 | pending |
| 8 | uncaughtException uses writeFileSync | C-3 | pending |
| 9 | 30s setInterval removed from server-entry | C-3 | pending |
| 10 | Recovery: alive=recovering, dead=tombstone | C-3 | pending |
| 11 | Genesis dedup on recovery | C-3 | pending |
| 12 | /sessions/:id deep-links | C-4 | pending |
| 13 | Stale-mode hold on WS disconnect | C-4 | pending |
| 14 | Recovery banner on bridge_ready | C-4 | pending |
| 15 | npm test passes | all | pending |
| 16 | npm run build passes | all | pending |

---

## Status Tracker

```
Total: 4 commissions, 2 waves
Completed: 0 / 4
Current wave: pre-wave-0
Blocked: C-4 (awaits C-1, C-2, C-3)
Failed: --
```
