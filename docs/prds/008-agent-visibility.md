# PRD 008 — Agent Visibility and Communication

**Status:** Draft
**Date:** 2026-03-14
**Scope:** Progress channels, event notifications, cross-agent visibility
**Depends on:** PRD 005 (bridge + dashboard)
**Evidence:** PRD 006 bridge commission failure (agent produced docs not code, couldn't monitor or redirect), empty bridge_prompt responses, SESSION-015/016 council decisions (D-026, D-027)
**MVP Scope:** Components 1 + 2 only (progress + events). Components 3 + 4 deferred.

---

## Purpose

The bridge can spawn agents. It cannot OBSERVE them. When a commissioned agent runs, the orchestrator (human or parent agent) has no visibility into:
- What step the agent is currently executing
- Whether it's making progress or stuck
- Whether it encountered an error or needs escalation
- What it produced when it finished

PRD 008 adds structured communication channels to the bridge so that agents are observable at every level: human → agent, agent → sub-agent, and council → all commissioned work.

---

## Problem

Three visibility gaps identified from real execution:

### Gap 1: Parent-to-child blindness

When this session spawned a bridge agent for PRD 006:
- `bridge_list` showed `status: working` — but not WHAT it was working on
- `bridge_prompt` returned empty responses — we couldn't ask for status
- The agent committed docs instead of code — we only discovered this AFTER by checking `git log`
- Our "DO NOT RESTART THE BRIDGE" warning may or may not have been received

### Gap 2: No event notifications

When the PRD 006 agent finished:
- It went from `working` to `ready` — but we had to POLL to discover this
- No notification was pushed to us (the parent session)
- If the agent had errored, we wouldn't have known until we polled
- There's no "completion event" or "error event" — just status changes

### Gap 3: Council has no cross-cutting view

The steering council commissioned work (D-025: Phase A validation, PRD 006 implementation). It has no way to check the status of commissioned work except by asking the human to run `bridge_list`. The council should be able to see: "PRD 006 was commissioned in SESSION-014, agent is at step 3 of 9, last activity 5 minutes ago."

---

## Architecture: Channel-Based Communication

Inspired by conclave (oss-conclave), but bridge-native — no separate server.

### Core Concept: Per-Session Channels

Each bridge session gets a set of named channels. Channels are append-only message queues with consumption cursors (from conclave's dual-cursor model, using only the consumption cursor for MVP).

```typescript
type Channel = {
  name: string;              // "progress", "events", "results"
  messages: ChannelMessage[];
  cursors: Map<string, number>;  // reader_id → last-read sequence
};

type ChannelMessage = {
  sequence: number;          // monotonic per channel
  timestamp: string;         // ISO 8601
  sender: string;            // agent/session identifier
  type: string;              // message type (see below)
  content: Record<string, unknown>;  // structured payload
};
```

### Three Channels Per Session

**`progress` channel** — what the agent is doing right now:
```json
{
  "type": "step_started",
  "content": {
    "methodology": "P2-SD",
    "method": "M1-IMPL",
    "step": "sigma_A2",
    "step_name": "Cross-Reference",
    "description": "Auditing spec claims against source code"
  }
}
```

**`events` channel** — lifecycle events:
```json
{
  "type": "completed",
  "content": {
    "methodology": "P2-SD",
    "method": "M1-IMPL",
    "result": "7 tasks implemented, 14 tests pass",
    "commits": ["abc1234", "def5678"],
    "retro_path": ".method/retros/retro-2026-03-14-001.yaml"
  }
}
```

Event types: `started`, `step_completed`, `completed`, `error`, `escalation`, `budget_warning`

**`results` channel** — structured output (deferred to Phase 2):
Reserved for future use. When implemented, replaces PTY stdout parsing for final outputs.

---

## Component 1: Progress Reporting (MVP)

### Agent-Side: MCP Tool

New tool agents call to report progress:

**`bridge_progress`**
```
Input:  {
  bridge_session_id: string,
  type: "step_started" | "step_completed" | "working_on" | "sub_agent_spawned",
  content: { methodology?, method?, step?, step_name?, description?, sub_agent_id? }
}
Output: { sequence: number, acknowledged: true }
```

The agent calls this at natural breakpoints:
- When starting a new methodology step (`step_started`)
- When completing a step (`step_completed`)
- When doing significant work within a step (`working_on`)
- When spawning a sub-agent (`sub_agent_spawned`)

**Integration with method MCP:** When an agent calls `step_advance`, the MCP server can AUTOMATICALLY publish a progress message if a bridge session is active. This means agents that use the method MCP get progress reporting for free — no explicit `bridge_progress` calls needed for step transitions.

### Parent-Side: MCP Tool

New tool parents call to read child progress:

**`bridge_read_progress`**
```
Input:  { bridge_session_id: string, since_sequence?: number }
Output: {
  messages: ChannelMessage[],
  last_sequence: number,
  has_more: boolean
}
```

Returns all progress messages since `since_sequence` (consumption cursor pattern). First call with `since_sequence: 0` gets full history. Subsequent calls with `since_sequence: last_sequence` get only new messages.

### Dashboard Integration

The bridge dashboard (localhost:3456/dashboard) adds a **progress timeline** per session:
```
Session e2c7f8bb [PRD 006] — status: working
  22:01 — step_started: P2-SD/M5-PLAN sigma_0 (Validate Inputs)
  22:03 — step_completed: sigma_0 → sigma_1
  22:05 — step_started: P2-SD/M5-PLAN sigma_1 (Extract Tasks)
  22:08 — working_on: "Reading PRD, extracting 4 implementation tasks"
  22:12 — step_completed: sigma_1 → sigma_2
  ...
```

---

## Component 2: Event Notifications (MVP)

### Agent-Side: MCP Tool

**`bridge_event`**
```
Input:  {
  bridge_session_id: string,
  type: "completed" | "error" | "escalation" | "budget_warning",
  content: { result?, error_message?, escalation_question?, budget_status? }
}
Output: { sequence: number, acknowledged: true }
```

Called at lifecycle boundaries:
- When the agent finishes all work (`completed`)
- When an unrecoverable error occurs (`error`)
- When the agent needs human input (`escalation`)
- When approaching budget limits (`budget_warning`)

**Auto-events:** The bridge itself generates events automatically:
- `started` — when session spawns successfully
- `stale` — when no activity for N seconds (dead session TTL)
- `killed` — when session is killed via bridge_kill

### Parent-Side: MCP Tool

**`bridge_read_events`**
```
Input:  { bridge_session_id: string, since_sequence?: number }
Output: {
  messages: ChannelMessage[],
  last_sequence: number,
  has_more: boolean
}
```

Same consumption cursor pattern as progress. Parent can poll periodically — but see Push Notifications below for the preferred approach.

### Push Notifications to Parent (MVP)

**The bridge proactively notifies the parent when child events occur.** This replaces polling with reactive notification. When a child agent publishes an event, the bridge:

1. Looks up the child's `parent_session_id` (from PRD 006 session chain, or from spawn metadata)
2. Calls `bridge_prompt(parent_session_id, notification_message)` automatically
3. The parent agent receives the prompt as if a human sent it — it can act immediately

**Notification format:**
```
BRIDGE NOTIFICATION — Child agent [session_id] event: {type}
Commission: {metadata.commission_id} — {metadata.task_summary}
Details: {event.content}
Action required: {suggested_action}
```

**Which events trigger push notifications:**

| Event type | Push to parent? | Rationale |
|---|---|---|
| `completed` | YES | Parent needs to collect results and proceed |
| `error` | YES | Parent needs to decide: retry, escalate, or abort |
| `escalation` | YES | Child is blocked and needs parent input |
| `budget_warning` | YES | Parent may need to increase budget or restructure |
| `step_completed` | NO (too noisy) | Parent can poll progress if interested |
| `started` | NO | Parent already knows — it spawned the child |
| `stale` | YES | Child may be stuck — parent should investigate |

**Push to human session:** If the parent is the human's session (root level — no parent_session_id), the bridge pushes to the dashboard instead:
- Dashboard shows a toast notification
- Dashboard plays a subtle sound on error/escalation
- The human can click through to the session's progress timeline

**Recursive push:** In a 3-level chain (human → orchestrator → sub-agent), events bubble up one level at a time:
```
Sub-agent errors → bridge pushes to orchestrator
Orchestrator receives notification → decides to escalate
Orchestrator publishes escalation event → bridge pushes to human (dashboard)
```

Events do NOT auto-bubble through the full chain — each level decides whether to propagate. This prevents notification storms from deep recursion.

### Notification Aggregation for Council

New tool for cross-cutting visibility:

**`bridge_all_events`**
```
Input:  { since_sequence?: number, filter_type?: string }
Output: {
  events: Array<{
    bridge_session_id: string,
    session_metadata: { commission_id?, task_summary?, methodology? },
    message: ChannelMessage
  }>,
  last_sequence: number
}
```

Returns events from ALL active sessions. The steering council (or human) calls this to get a unified view: "what's happening across all my commissioned agents?"

### Dashboard Integration

The dashboard adds:
- **Event feed** — real-time event stream across all sessions
- **Session status icons** — green (working), yellow (escalation pending), red (error), gray (completed)
- **Commission tracking** — if metadata.commission_id exists, show which council decision spawned this agent

---

## Component 3: Structured Result Handoff (Deferred)

When an agent completes, it publishes its structured result to the `results` channel instead of relying on PTY stdout parsing. The parent reads the result via `bridge_read_results`.

**Deferred to Phase 2** — PTY parsing works for file operations (the agent commits code, the parent checks git log). Structured handoff improves quality but doesn't unblock the pipeline.

---

## Component 4: Heartbeat (Deferred)

Agents send periodic heartbeats. Bridge detects stalls when heartbeats stop.

**Deferred to Phase 2** — the bridge already has dead session TTL (5 minutes). Heartbeats add finer-grained stall detection but the TTL is sufficient for MVP.

---

## Implementation

### Bridge Changes

```typescript
// New in pool.ts or new channels.ts
type SessionChannels = {
  progress: Channel;
  events: Channel;
};

// Per session — created automatically on spawn
const channels = new Map<string, SessionChannels>();
```

Channels are in-memory (same as the rest of the bridge state). No persistence needed — channels live and die with the session.

### New MCP Tools (4)

Added to `@method/mcp`:

| Tool | Direction | Purpose |
|---|---|---|
| `bridge_progress` | Agent → Bridge | Report progress |
| `bridge_event` | Agent → Bridge | Report lifecycle events |
| `bridge_read_progress` | Parent → Bridge | Read child's progress |
| `bridge_read_events` | Parent → Bridge | Read child's events |
| `bridge_all_events` | Council → Bridge | Read events across all sessions |

### Auto-Progress from Method MCP

When `step_advance` is called and a bridge session is active, the method MCP server automatically calls `bridge_progress` with `step_completed` + `step_started` for the new step. This means methodology-driven agents get progress reporting with zero additional code.

Implementation: `step_advance` checks if a bridge session ID exists in the methodology session metadata. If yes, POSTs to bridge's progress endpoint.

### Orchestrator Prompt Integration

Guide 8 (prompting) updated: orchestrator prompts should tell agents to call `bridge_progress` for significant non-step-transition work (e.g., "reading PRD", "running tests", "spawning sub-agent"). Step transitions are automatic via the method MCP integration.

---

## Known Gaps and Required Pre-Implementation Experiments

Six gaps identified during design review. Gaps 1-3 require experiments before
implementation begins. Gaps 4-6 are acceptable MVP limitations.

### Gap 1: bridge_prompt delivery reliability (BLOCKING — needs experiment)

Push notifications use `bridge_prompt` to notify the parent. But `bridge_prompt`
returns empty responses in our experience — the PTY output parser is lossy for
text responses. If push notifications use the same unreliable channel, they might
not arrive.

**Key insight:** The empty response problem is in PTY OUTPUT parsing (bridge reads
agent's stdout). Push notifications go in the OPPOSITE direction (bridge sends TO
agent's stdin via PTY write). These are different code paths — sending might work
even when receiving fails.

**Experiment EXP-008-1:** Test bridge_prompt DELIVERY (not response parsing).
- Spawn an agent via bridge
- Send it a prompt that asks it to write a file (not respond with text)
- Check if the file was created
- If yes: bridge_prompt delivery works even when response parsing is lossy
- If no: bridge_prompt is fundamentally unreliable and push notifications need
  a different mechanism (e.g., file-based notification, environment variable flag)

**Mitigation if experiment fails:** Dashboard is the reliable fallback — it reads
directly from the channel store. Push becomes "best-effort bonus." Agents that
need reliable notifications poll `bridge_read_events` instead.

### Gap 2: Agent self-identification (BLOCKING — needs design decision)

To call `bridge_progress` or `bridge_event`, the agent needs its own
`bridge_session_id`. Currently the spawned agent doesn't receive this — only
the spawner knows it.

**Experiment EXP-008-2:** Test three approaches for injecting session identity:
- (a) Environment variable: spawn with `BRIDGE_SESSION_ID=abc` — check if the
  spawned Claude Code agent can read it via `process.env` in tool calls
- (b) Initial prompt injection: include the session_id in the prompt text —
  the agent parses it and uses it in tool calls
- (c) `bridge_whoami` tool: the agent calls a discovery tool that returns its
  session_id based on the PTY session it's running in

**Decision criteria:** (a) is cleanest if env vars propagate to MCP tool contexts.
(b) is most reliable but couples identity to prompt text. (c) is most elegant
but requires matching PTY → session which may be fragile.

### Gap 3: Method MCP → bridge coupling for auto-progress (BLOCKING — needs design)

Auto-progress requires `step_advance` in the method MCP server to POST to the
bridge. The method MCP and bridge are separate processes. The method MCP needs
the bridge URL and the agent's bridge_session_id.

**Design decision:** The method MCP reads `BRIDGE_URL` and `BRIDGE_SESSION_ID`
from environment variables. When `step_advance` fires:
1. Check if `BRIDGE_URL` is set — if not, skip (non-bridge agent)
2. POST to `${BRIDGE_URL}/channels/${BRIDGE_SESSION_ID}/progress`
3. Fire-and-forget (don't block step_advance on bridge response)

**Experiment EXP-008-3:** Test if the method MCP server process has access to
environment variables set on the spawned Claude Code process. The bridge sets
env vars on the PTY spawn → does the MCP server subprocess inherit them?

### Gap 4: In-memory only (ACCEPTABLE for MVP)

Channels are in-memory. Bridge restart = all channel data lost. Consistent with
existing bridge behavior (PTY sessions also die on restart). Persistence is Phase 2.

### Gap 5: No back-pressure (ACCEPTABLE for MVP)

Verbose agents can flood channels. Mitigation: cap at 1000 messages per channel
per session. Oldest messages evicted. Progress is ephemeral — recent state matters,
not full history.

### Gap 6: Human root notification (ACCEPTABLE for MVP)

The human's terminal session is not a bridge session. Bridge can't `bridge_prompt`
the human. Dashboard toasts are the notification channel for the root level.
OS-level browser notifications (Notification API) if dashboard is open.

---

## Pre-Implementation Experiment Plan

Run these experiments BEFORE implementing. Results determine final design.

| Experiment | Question | Method | Pass criteria | Blocks |
|---|---|---|---|---|
| EXP-008-1 | Does bridge_prompt deliver reliably to stdin? | Spawn agent, prompt to write file, check file | File created = delivery works | Push notification design |
| EXP-008-2 | How does agent learn its session_id? | Test env var, prompt injection, whoami tool | Agent can use session_id in tool calls | All agent-side tools |
| EXP-008-3 | Does MCP server inherit bridge env vars? | Set BRIDGE_URL on spawn, check in MCP handler | MCP handler reads env var | Auto-progress feature |

**Estimated experiment time:** 30 minutes total. All three can run on the live bridge.

---

## Out of Scope (MVP)

- Structured result handoff (Component 3)
- Heartbeat (Component 4)
- Sibling-to-sibling communication
- Persistent channels across bridge restarts
- Channel ACLs or authentication
- WebSocket push notifications (polling is sufficient for MVP)
- Full conclave integration

---

## Success Criteria

1. A spawned agent's methodology step transitions appear in `bridge_read_progress` within 5 seconds
2. When a spawned agent completes, `bridge_read_events` returns a `completed` event
3. When a spawned agent errors, `bridge_read_events` returns an `error` event
4. `bridge_all_events` returns events from multiple concurrent sessions
5. The dashboard shows a real-time progress timeline per session
6. Auto-progress from `step_advance` works without the agent explicitly calling `bridge_progress`
7. When a child agent completes/errors, the parent agent receives a push notification via `bridge_prompt` within 10 seconds
8. Push notifications do NOT auto-bubble through the full chain — each level decides whether to propagate

---

## Relationship to Other PRDs

- **PRD 006 (Recursive Orchestration):** PRD 008 is a prerequisite. Recursive agents need visibility at every level. PRD 006's parent-child session chains + PRD 008's progress channels = observable recursive execution.
- **PRD 007 (Bridge UI):** PRD 008 provides the data that PRD 007 displays. The dashboard enhancements in PRD 008 are minimal (timeline, event feed). PRD 007 adds the full UI experience.
- **Conclave:** PRD 008 borrows conclave's channel + consumption cursor pattern but implements it bridge-native. Full conclave integration is Phase 2 if bridge-native proves insufficient.
