# PRD 007 — Bridge UI: Agent Identity, Live Output, and Transcript History

**Status:** Draft
**Date:** 2026-03-14
**Scope:** Agent nicknames + progressive disclosure + live PTY output streaming + session transcript browsing
**Depends on:** 005-bridge-v2 (dashboard, token tracking, MCP proxy tools)
**Requested by:** Operator experience during PRD 005 validation — agents are opaque boxes with UUID labels

---

## Contents

| File | Description |
|------|-------------|
| [README.md](README.md) | This file — the PRD specification |
| `mocks/` | UI mockups (live-output and transcript-history views) |

---

## Purpose

PRD 005 gave the operator a dashboard: health cards, subscription meters, a session table. But the session table treats agents as rows of numbers. During PRD 005 validation, we spawned 3 agents in parallel — `d9dea613`, `64cf42b0`, `e623fc2e` — and the only way to know which was which was to cross-reference UUIDs with metadata fields. When something goes wrong, the operator can't see what an agent is doing without reading raw PTY output from the terminal that started the bridge.

This PRD gives agents **identity** (nicknames, purpose, context) and **transparency** (live output streaming, transcript history). The operator should be able to glance at the dashboard and know:

- **Who** is working (nickname, not UUID)
- **Why** they were spawned (purpose, methodology context)
- **What** they're doing right now (live output stream)
- **What** they've done before (transcript history)

---

## Problem

After PRD 005, the operator can see:
- How many agents are alive (session table)
- Token consumption per agent (token tracking)
- Subscription quota (usage meters)

But the operator **cannot**:
- Distinguish agents at a glance — all agents are 8-char hex IDs
- Understand *why* an agent was spawned without inspecting metadata JSON
- See what an agent is currently outputting (live PTY stream is invisible)
- Review what an agent did after it finishes (no transcript access)
- Quickly assess whether an agent is stuck, productive, or spinning

The result: during multi-agent orchestration, the dashboard tells you *that* things are happening but not *what* is happening. The operator must mentally map UUIDs to tasks, which burns working memory that should be reserved for decision-making.

---

## What to Build

### Phase 1: Agent Identity and Progressive Disclosure

#### Agent Nicknames

Extend `bridge_spawn` and `POST /sessions` to accept a `nickname` field:

```
POST /sessions
{
  workdir: string,
  spawn_args?: string[],
  initial_prompt?: string,
  metadata?: Record<string, unknown>,
  nickname?: string,        // NEW: human-readable agent name
  purpose?: string,         // NEW: why this agent was spawned (1-2 sentences)
}
```

If `nickname` is not provided, the bridge auto-generates one. The auto-generated name should be memorable and distinct — not random hex. Options:

- **Methodology-derived:** If `metadata.methodology_session_id` exists, derive from the method being executed: `council-1`, `impl-2`, `plan-1`. Pattern: `{method-short}-{sequence}`.
- **Fallback:** Use a short word list: `alpha`, `bravo`, `cedar`, `drift`, `ember`, `flux`, `grain`, `haze`, etc. Sequential assignment, wraps around.

The nickname is:
- Displayed in the session table instead of the UUID (UUID moves to a tooltip/expandable detail)
- Used in bridge_list output: `nickname` field alongside `bridge_session_id`
- Used in log messages: `[ember] Session spawned` instead of `[d9dea613] Session spawned`
- Unique within a bridge lifetime (no two active sessions share a nickname)

#### Purpose Field

The `purpose` field stores a human-readable description of why the agent was spawned. This is distinct from metadata — metadata is structured data for programmatic use; purpose is a natural language sentence for the operator.

Examples:
- `"Execute M1-COUNCIL sigma_2: adversarial debate on architecture decision"`
- `"Run M1-IMPL for PRD 005 Phase 1 bridge-side changes"`
- `"Drift audit — check theory-implementation alignment after 3 phases"`

If the orchestrator doesn't provide a purpose, the field is null and the dashboard shows the methodology session ID or "—" as fallback.

#### Progressive Disclosure in Dashboard

The session table gains expandable rows. Each row has two states:

**Collapsed (default):** The current view, but with nickname replacing the UUID:

```
┌─────────┬──────────┬──────────┬────────┬───┬────────┬───────┬──────────┐
│ Agent   │ Status   │ Workdir  │ Method │ P │ Tokens │ Cache │ Activity │
│ ember   │ working  │ pv-agi   │ cncl-1 │ 4 │ 68.4k  │ 78%   │ now      │
│ flux    │ ready    │ pv-mthd  │ impl-2 │12 │ 51.2k  │ 82%   │ 32s ago  │
└─────────┴──────────┴──────────┴────────┴───┴────────┴───────┴──────────┘
```

**Expanded (click to toggle):** Shows agent context below the row:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ▾ ember                                                    working     │
├─────────────────────────────────────────────────────────────────────────┤
│  Purpose    Execute M1-COUNCIL sigma_2: adversarial debate on arch     │
│  Full ID    d9dea613-572e-4d16-a4ec-179d5c0846cf                       │
│  Workdir    /home/user/repos/pv-agi                                    │
│  Method     M1-COUNCIL — Synthetic Agents Method (step 2/4)            │
│  Spawned    14:32:07 (4m ago)                                          │
│  Tokens     in: 52.1k · out: 16.3k · cache: 78%                       │
│                                                                         │
│  [View Live Output]                              [View Transcript]      │
└─────────────────────────────────────────────────────────────────────────┘
```

The expanded view provides:
- Full session UUID (copyable)
- Purpose text
- Methodology context (method name, step progress)
- Token breakdown
- Links to the live output view and transcript view

#### MCP Tool Updates

`bridge_spawn` accepts `nickname` and `purpose`:

```
Input: {
  workdir: string,
  spawn_args?: string[],
  initial_prompt?: string,
  session_id?: string,
  nickname?: string,        // NEW
  purpose?: string,         // NEW
}
Output: {
  bridge_session_id: string,
  nickname: string,          // NEW: assigned or auto-generated
  status: string,
  message: "Agent 'ember' spawned. Call bridge_prompt to send work."
}
```

`bridge_list` includes nicknames:

```
Output: {
  sessions: [{
    bridge_session_id: string,
    nickname: string,         // NEW
    purpose: string | null,   // NEW
    status: string,
    ...
  }]
}
```

#### Implementation Files

| File | Change |
|------|--------|
| `packages/bridge/src/pool.ts` | Add `nickname` and `purpose` to create options, store in session metadata, add auto-nickname generation |
| `packages/bridge/src/index.ts` | Accept `nickname` and `purpose` in POST /sessions, pass through |
| `packages/bridge/src/dashboard.html` | Expandable session rows, nickname column, purpose display |
| `packages/bridge/src/dashboard-route.ts` | Render expanded row HTML, pass nickname/purpose data |
| `packages/mcp/src/index.ts` | Update bridge_spawn and bridge_list to handle nickname/purpose |

---

### Phase 2: Live Agent Output

#### PTY Output Streaming

Add the ability to observe an agent's live PTY output through the dashboard.

##### Server-Side: Output Buffer + SSE

Extend `PtySession` to maintain a full output transcript (not just the current prompt's buffer):

```typescript
// In pty-session.ts
export interface PtySession {
  // ... existing
  readonly transcript: string;       // NEW: full PTY output since spawn
  onOutput(cb: (data: string) => void): () => void;  // NEW: subscribe to live output
}
```

The `transcript` field accumulates all PTY data since spawn. The `onOutput` method registers a callback for live streaming and returns an unsubscribe function.

##### SSE Endpoint

```
GET /sessions/:id/stream
Content-Type: text/event-stream
```

Streams PTY output as Server-Sent Events. Each event contains a chunk of text:

```
data: {"text": "● I'll read the file...\n", "timestamp": "2026-03-14T14:32:09.123Z"}
```

The endpoint:
1. Sends the full transcript buffer as an initial burst (so the client catches up)
2. Then streams new data as it arrives via the `onOutput` subscription
3. Cleans up the subscription when the client disconnects
4. Returns 404 if session not found, 400 if session is dead (with the final transcript)

##### Dashboard: Live Output Page

New page at `GET /sessions/:id/live`:

Layout matches the mockup at `tmp/mock-live-output.html`:

- **Header bar:** Nickname, status badge (with pulse), workdir, methodology session
- **Terminal area:** Streaming PTY output with ANSI stripped, monospace font
  - Tool calls highlighted with bio accent
  - Thinking blocks collapsed with nebular accent
  - New content fades in with slide-up animation
  - Auto-scroll with pause toggle
- **Sidebar:** Session stats (prompts, tokens, cache rate, uptime, method/step)
- **Input bar:** Send a prompt directly via bridge_prompt

The page uses `EventSource` to subscribe to `/sessions/:id/stream` and appends output to the terminal area in real-time.

##### Implementation Files

| File | Change |
|------|--------|
| `packages/bridge/src/pty-session.ts` | Add `transcript` buffer, `onOutput` subscription mechanism |
| `packages/bridge/src/index.ts` | Add `GET /sessions/:id/stream` (SSE) and `GET /sessions/:id/live` (HTML page) |
| `packages/bridge/src/live-output.html` | New template — terminal output view |
| `packages/bridge/src/live-output-route.ts` | New route handler — renders live output page |

---

### Phase 3: Session Transcript History

#### JSONL Transcript Parsing

Extend the token tracker's JSONL parsing to extract full conversation turns, not just token counts.

```typescript
// New type
type TranscriptTurn = {
  role: 'user' | 'assistant';
  content: string;              // text content (tool calls summarized)
  toolCalls?: {
    name: string;
    input: string;              // summarized input
    duration?: number;
  }[];
  tokens?: {
    input: number;
    output: number;
    cacheRead: number;
  };
  timestamp: string;
};

// New module
export function createTranscriptReader(config: {
  sessionsDir: string;
}): TranscriptReader

type TranscriptReader = {
  listSessions(workdir: string): SessionSummary[];     // all sessions for a workdir
  getTranscript(sessionFile: string): TranscriptTurn[]; // parse JSONL into turns
};
```

The reader:
1. Lists all JSONL files in the project directory, sorted by modification time
2. Parses each file into conversation turns by grouping messages by role
3. Extracts tool calls from assistant messages (name, summarized input, duration)
4. Computes per-turn token counts from `message.usage`

#### Dashboard: Transcript Browser

New page at `GET /transcripts` (or `GET /sessions/:id/transcript` for a specific session):

Layout matches the mockup at `tmp/mock-transcript-history.html`:

- **Sidebar:** Session list grouped by date
  - Each entry: nickname (or short ID), workdir, timestamp, token count
  - Click to load transcript
  - Active session highlighted with bio accent
- **Main area:** Selected session's conversation
  - User turns: solar left-accent, solar-dim background
  - Assistant turns: bio left-accent, abyss background
  - Tool call blocks: collapsible, nebular accent, show tool name + duration
  - Per-turn token count in dim2
- **Top bar:** Session metadata (full ID, workdir, start time, total tokens, cache rate, duration)
- **Session summary:** At bottom — total turns, tools called, aggregate tokens

#### Implementation Files

| File | Change |
|------|--------|
| `packages/bridge/src/transcript-reader.ts` | New module — JSONL parsing for conversation turns |
| `packages/bridge/src/transcript.html` | New template — transcript browser |
| `packages/bridge/src/transcript-route.ts` | New route handler — renders transcript page |
| `packages/bridge/src/index.ts` | Register transcript routes |

---

## Relationship to Existing Surfaces

| Existing | Change |
|----------|--------|
| `POST /sessions` | Extended: `nickname`, `purpose` fields |
| `GET /sessions` | Extended: includes `nickname`, `purpose` per session |
| `GET /dashboard` | Modified: expandable rows, nickname column |
| `bridge_spawn` MCP tool | Extended: `nickname`, `purpose` parameters |
| `bridge_list` MCP tool | Extended: `nickname`, `purpose` in output |

New surfaces:

| New | Phase |
|-----|-------|
| `GET /sessions/:id/stream` (SSE) | Phase 2 |
| `GET /sessions/:id/live` (HTML) | Phase 2 |
| `GET /transcripts` (HTML) | Phase 3 |
| `GET /sessions/:id/transcript` (HTML) | Phase 3 |

---

## Design System

All new UI follows the Vidtecci OS Design System. Reference: `docs/design/`.

Key constraints for this PRD:
- **Nicknames use `--font-m` (JetBrains Mono)** — they are technical identifiers, not display names
- **Progressive disclosure uses background contrast** — expanded rows are a darker shade, no decorative borders
- **Live output terminal uses the deepest void** — `rgba(2,5,10,.98)`, darker than the main background
- **Tool calls get nebular accent** — `2px left border, rgba(155,127,212,.25)`
- **User messages get solar accent** — `2px left border, rgba(238,170,98,.35)`
- **Assistant messages get bio accent** — `2px left border, rgba(0,212,176,.2)`
- **Auto-scroll indicator pulses bio** — same as status-ready animation

See `docs/guides/14-bridge-dashboard-ui.md` for the full component reference and extension patterns.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_TRANSCRIPT_SIZE_BYTES` | `5242880` (5MB) | Max transcript buffer per session. Older content truncated. |
| `SSE_HEARTBEAT_MS` | `15000` | SSE keepalive interval to prevent connection timeout |

No new environment variables for Phase 1 (nicknames are in-memory, no persistence).

---

## Out of Scope

- **Persistent nickname registry** — nicknames are ephemeral per bridge lifetime. When the bridge restarts, the sequence resets. A persistent name service is a future extension.
- **Agent-to-agent chat view** — showing communication between orchestrator and sub-agents as a conversation. Requires protocol changes beyond PTY observation.
- **Transcript search** — full-text search across transcripts. Deferred until the transcript volume justifies indexing.
- **Transcript export** — downloading transcripts as files. The JSONL files already exist on disk; the UI is read-only.
- **WebSocket for live output** — SSE is simpler, sufficient for unidirectional streaming, and requires no additional dependencies.
- **Agent avatars or icons** — nicknames are sufficient identity. Visual avatars add cognitive load without proportional value.

---

## Implementation Order

### Phase 1: Agent Identity and Progressive Disclosure

Nickname generation, purpose field, expandable dashboard rows. This changes how the operator perceives agents — from opaque UUIDs to named actors with context. Low implementation cost, high cognitive benefit.

### Phase 2: Live Agent Output

SSE streaming endpoint, live output page. This makes agents transparent in real-time. The operator can watch an agent work, spot when it's stuck, and send follow-up prompts. Medium implementation cost.

### Phase 3: Session Transcript History

JSONL transcript parsing, transcript browser page. This makes agent work reviewable after the fact. The operator can audit what happened, compare runs, and learn from agent behavior. Medium implementation cost.

---

## Acceptance Test

**Scenario:** Orchestrator spawns 3 agents for a multi-method session.

1. Agent calls `bridge_spawn({ workdir, nickname: "council", purpose: "Execute M1-COUNCIL for architecture decision" })`
2. Agent calls `bridge_spawn({ workdir, purpose: "Implement M1-IMPL Phase 1 bridge changes" })` — no nickname, auto-generated
3. Agent calls `bridge_spawn({ workdir })` — no nickname, no purpose, auto-generated

**Pass criteria — Phase 1:**
- Dashboard shows `council`, `impl-1` (auto-derived from method), `alpha` (fallback) instead of UUIDs
- Clicking a row expands it to show purpose, full UUID, methodology context
- `bridge_list` returns nicknames in output
- Log messages use nicknames: `[council] Session spawned`

**Pass criteria — Phase 2:**
- Clicking "View Live Output" on an expanded row opens `/sessions/:id/live`
- The terminal area streams PTY output in real-time via SSE
- Tool calls are highlighted with bio accent, thinking blocks are collapsible
- The input bar sends prompts via `POST /sessions/:id/prompt` and the response streams in

**Pass criteria — Phase 3:**
- `/transcripts` shows a sidebar with past sessions grouped by date
- Clicking a session loads its conversation turns
- Tool call blocks are collapsible with nebular accent
- Per-turn token counts are visible
- Session summary shows aggregate stats

---

## Success Criteria

1. An operator running 3+ concurrent agents can identify each agent by nickname at a glance
2. The operator can understand why any agent was spawned without inspecting raw metadata
3. The operator can watch an agent work in real-time through the live output view
4. The operator can review any past session's conversation through the transcript browser
5. All new UI follows the Vidtecci OS design system (passes the 5-principle check)
6. All existing bridge endpoints and MCP tools continue to work unchanged (backward compatible)
