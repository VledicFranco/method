---
title: "PRD 033: Cognitive Agent Session UX — Observable Reasoning in the Bridge"
status: implemented
date: "2026-03-28"
tier: medium
depends_on: [30, 31, 32, 23]
enables: []
blocked_by: []
complexity: medium
domains_affected: [bridge, pacta]
---

# PRD 033: Cognitive Agent Session UX — Observable Reasoning in the Bridge

**Status:** Implemented (all 4 phases — CognitiveProvider, CycleTrace, CognitivePanel, MemoryViewer)
**Author:** PO + Lysica
**Date:** 2026-03-28
**Packages:** `@methodts/bridge` (L4), `@methodts/pacta` (L3)
**Depends on:** PRD 030 (Cognitive Composition), PRD 031 (Memory Module), PRD 032 (Advanced Patterns), PRD 023 (Bridge Domains)
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Problem Statement

The bridge exposes Claude Code sessions through a chat interface (POST /sessions, prompt/stream SSE). The cognitive agent (PRD 030-032) runs internally as a multi-cycle process with rich observable state — workspace entries, monitor interventions, affect signals, memory retrievals, reflection lessons. None of this is visible to users. A cognitive session looks identical to a flat claude --print session from the outside.

Users cannot:
- See why the agent chose a particular action (reasoning trace)
- Watch the agent's strategy shifts happen in real time (monitor interventions)
- Understand the agent's emotional trajectory (affect signals)
- Review what the agent remembers from past tasks (memory state)
- Intervene when the agent is stuck (cycle-level observability)

The cognitive architecture's value is invisible. Making it observable is both a UX improvement and a research tool — the cycle trace IS the experiment data.

## Objective

Extend the bridge session system to support cognitive agent sessions with observable reasoning. The existing chat UX is preserved — users still send prompts and receive responses. But cognitive sessions additionally emit cycle-by-cycle events that the frontend renders as:

1. **Inline cycle trace** (collapsible, between prompt and response) — compact action timeline
2. **Cognitive state sidebar panel** — live workspace, memory, affect, monitor status
3. **Reflection footer** — post-task lessons displayed below the response

The approach is **parameterized current view, not a separate view**. The session component conditionally renders cognitive UI when `session.mode === 'cognitive-agent'`.

## Architecture

### Backend: Cognitive Agent as AgentProvider

The bridge already supports `providerOverride` in session creation. A new `CognitiveAgentProvider` implements `AgentProvider` by running the cognitive cycle internally:

```
POST /sessions { provider_type: 'cognitive-agent', config: 'baseline' }
  → pool.create() selects CognitiveAgentProvider
  → session.sendPromptStream() runs the cognitive cycle
  → each cycle emits a CognitiveEvent via SSE
  → final response is the last action's output
```

The provider wraps the existing cognitive modules (reasoner-actor, monitor, memory-v2, etc.) and emits structured events during processing:

```typescript
type CognitiveSSEEvent =
  | { type: 'cycle-start'; cycle: number; maxCycles: number }
  | { type: 'cycle-action'; cycle: number; action: string; confidence: number; tokens: number }
  | { type: 'monitor'; cycle: number; intervention: string; restricted?: string[] }
  | { type: 'affect'; cycle: number; label: string; valence: number; arousal: number }
  | { type: 'memory'; retrieved: number; stored: number; totalCards: number }
  | { type: 'reflection'; lessons: string[] }
  | { type: 'text'; content: string }  // existing: streaming text output
  | { type: 'done'; output: string; metadata: PrintMetadata }  // existing: completion
```

### Frontend: Parameterized ChatView

The existing `ChatView.tsx` renders turns (user prompt → agent response). For cognitive sessions, each turn additionally contains:

```typescript
interface CognitiveTurnData {
  cycles: Array<{
    number: number;
    action: string;
    confidence: number;
    tokens: number;
    monitor?: { intervention: string; restricted?: string[] };
    affect?: { label: string; valence: number; arousal: number };
  }>;
  memory?: { retrieved: number; stored: number; totalCards: number };
  reflection?: { lessons: string[] };
  profile?: string;  // meta-composer classification
}
```

This data is accumulated from SSE events during streaming and rendered as:
- **Cycle trace** — compact horizontal timeline with action icons, expandable
- **Reflection** — below the response text, visually distinct

### Sidebar: Cognitive State Panel

The `SessionSidebar.tsx` gets a conditional panel when the selected session is cognitive:

```
── Cognitive State ──
Workspace: 5/8 entries
Memory: 12 cards (3 HEURISTIC, 5 OBSERVATION, 3 PROCEDURE, 1 RULE)
Affect: 😊 confident (v=0.8, a=0.2)
Monitor: 2 interventions this turn
Profile: routine → baseline
```

This updates live during streaming via the same SSE events.

## Phases

### Phase 1 — CognitiveAgentProvider (Backend)

**Deliverables:**
- `bridge/src/domains/sessions/cognitive-provider.ts` — new file
  - Implements `AgentProvider` interface
  - Internally runs the cognitive cycle (observer → monitor → reasoner-actor)
  - Accepts `CognitiveConfig` from strategies.ts (config name passed at session creation)
  - Emits `CognitiveSSEEvent` objects via a callback during processing
  - Uses `anthropicProvider` for LLM calls (same as experiment harness)
  - Supports memory (optional, via FactCardStore for persistence)
  - Supports all PRD 032 patterns (via PatternFlags)
- `bridge/src/domains/sessions/routes.ts` — extend POST /sessions to accept:
  ```json
  { "provider_type": "cognitive-agent", "config": "baseline", "patterns": ["P5", "P6"] }
  ```
- `bridge/src/domains/sessions/pool.ts` — provider factory based on `provider_type`

**Exit criteria:**
- `POST /sessions { provider_type: 'cognitive-agent' }` creates a cognitive session
- `POST /sessions/:id/prompt/stream` emits cycle events interleaved with text events
- Existing print sessions are unaffected

### Phase 2 — Inline Cycle Trace (Frontend)

**Deliverables:**
- `CycleTrace.tsx` — new component rendering the cycle timeline
  - Compact mode: `[c1] Read → [c2] Glob → [c3] Read ⚠ → [c4] Write ✅`
  - Expanded mode: shows plan/reasoning/action per cycle
  - Color-coded: green (success), yellow (monitor), red (error), blue (done)
  - Collapsible — defaults to compact, click to expand
- `usePromptStream.ts` — parse `CognitiveSSEEvent` types alongside existing `text`/`done`
  - Accumulate `CognitiveTurnData` during streaming
  - Pass to `ChatView.tsx` for rendering
- `ChatView.tsx` — render `<CycleTrace>` between prompt and response when data exists

**Exit criteria:**
- Cognitive sessions show cycle trace inline
- Non-cognitive sessions render identically to current behavior
- Cycle trace is collapsible and doesn't dominate the view

### Phase 3 — Cognitive State Sidebar Panel

**Deliverables:**
- `CognitivePanel.tsx` — new sidebar component
  - Workspace meter (entries / capacity)
  - Memory summary (card counts by type)
  - Affect indicator (emoji + label + valence bar)
  - Monitor activity (intervention count + last intervention type)
  - Meta-composer profile badge
- `SessionSidebar.tsx` — conditionally render `<CognitivePanel>` when session is cognitive
- Live updates during streaming via accumulated SSE events

**Exit criteria:**
- Sidebar shows cognitive state for cognitive sessions
- Updates in real time during prompt processing
- Hidden for non-cognitive sessions

### Phase 4 — Reflection Footer + Memory Viewer

**Deliverables:**
- Reflection lessons rendered below agent response (visually distinct card)
- "View Memory" button opens a modal/panel showing all FactCards
  - Grouped by type (HEURISTIC, FACT, RULE, PROCEDURE, OBSERVATION)
  - Sorted by confidence
  - Shows links between cards
- Memory persists across prompts in the same session
- Optionally persists across sessions via FactCardStore

**Exit criteria:**
- Reflection lessons visible after each task completion
- Memory viewer accessible and shows card details
- Cross-session memory works when enabled

## Success Criteria

1. **SC-1:** Cognitive sessions are spawnable via the same /sessions API with a type parameter
2. **SC-2:** Cycle trace renders inline without degrading the chat experience
3. **SC-3:** Users can distinguish cognitive sessions from flat sessions at a glance (🧠 badge)
4. **SC-4:** The sidebar cognitive panel updates in real time during processing
5. **SC-5:** Existing print sessions are completely unaffected (zero regression)
6. **SC-6:** The cognitive UX works as a research tool — cycle traces can be exported for analysis

## Acceptance Criteria

- AC-1: POST /sessions accepts provider_type='cognitive-agent' and config parameter
- AC-2: SSE stream emits CognitiveSSEEvent types during cognitive processing
- AC-3: CycleTrace component renders compact timeline, expandable to full detail
- AC-4: CognitivePanel shows workspace/memory/affect/monitor state
- AC-5: Reflection footer displays lessons after task completion
- AC-6: Non-cognitive sessions render identically to current behavior (visual diff = 0)
- AC-7: Session list shows 🧠 badge for cognitive sessions

## Non-Goals

- Real-time user intervention mid-cycle (Option C from design discussion — deferred)
- Cognitive agent without bridge (CLI-only usage via experiment harness is already done)
- Mobile/responsive design for cognitive panels (desktop-first)
- Performance optimization of cognitive cycle (that's PRD 030-032, not UX)

## Technical Notes

- The bridge's EventBus (PRD 026) already supports WebSocket event broadcasting. CognitiveSSEEvents can be routed through the existing WebSocketSink for sidebar updates.
- The `usePromptStream.ts` hook parses SSE generically — new event types just need new handlers in the accumulator.
- The cognitive provider needs access to VirtualToolProvider OR real filesystem tools. For the bridge, real filesystem tools via the session's workdir are appropriate (same as print sessions).
- Memory persistence: FactCardStore writes to `.method/memory/` — bridge sessions should use a session-scoped or project-scoped path.
