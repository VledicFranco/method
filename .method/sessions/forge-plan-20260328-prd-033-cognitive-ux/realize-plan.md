# Realization Plan — PRD 033: Cognitive Agent Session UX

## PRD Summary

**Objective:** Extend the bridge session system to support cognitive agent sessions with observable reasoning. Users send prompts and receive responses as before, but cognitive sessions additionally emit cycle-by-cycle events that the frontend renders as: (1) inline cycle trace, (2) cognitive state sidebar panel, (3) reflection footer + memory viewer.

**Phases:** 4 (CognitiveAgentProvider backend, inline cycle trace, cognitive sidebar, reflection footer + memory viewer)
**Acceptance criteria:** AC-1 through AC-7
**Success criteria:** SC-1 through SC-6
**Domains affected:** bridge (sessions domain — backend + frontend), pacta (consumed, NOT modified)
**Dependencies:** PRD 030 (cognitive composition), PRD 031 (memory module), PRD 032 (advanced patterns), PRD 023 (bridge domains)

## Codebase Survey

### Backend — `packages/bridge/src/domains/sessions/`

| File | Role | Relevance |
|------|------|-----------|
| `pool.ts` | Session pool — `create()`, `promptStream()`, `SessionPool` interface | Provider factory: `promptStream` currently delegates to `session.sendPromptStream()`. Must route cognitive sessions through CognitiveAgentProvider instead. `SessionMode` type (`'print'`) needs `'cognitive-agent'` variant. `StreamEvent` type needs cognitive event variants. |
| `print-session.ts` | Print-mode session — `PtySession` interface, `createPrintSession()` factory | Reference implementation for session lifecycle. CognitiveAgentProvider parallels this but runs cognitive cycle internally instead of shelling out to `claude --print`. |
| `routes.ts` | HTTP route registration — POST `/sessions`, POST `/sessions/:id/prompt/stream` | POST `/sessions` body needs `provider_type` and `config` fields. SSE stream route already passes `StreamEvent` objects through `sendSSE()` — cognitive events flow through same pipe. |
| `types.ts` | Domain type re-exports barrel | Needs to re-export new cognitive session types. |
| `config.ts` | Domain config (Zod schema) | May need cognitive-specific config fields. |

### Frontend — `packages/bridge/frontend/src/domains/sessions/`

| File | Role | Relevance |
|------|------|-----------|
| `types.ts` | Frontend type definitions — `SessionSummary`, `ChatTurn`, `SpawnRequest` | Needs `CognitiveTurnData`, extended `ChatTurn` with cognitive data, `SessionSummary.mode` extended to include `'cognitive-agent'`, `SpawnRequest` extended with `provider_type`/`config`/`patterns`. |
| `usePromptStream.ts` | SSE streaming hook — parses `text`/`done`/`error` events | Must parse new `CognitiveSSEEvent` types (`cycle-start`, `cycle-action`, `monitor`, `affect`, `memory`, `reflection`) and accumulate `CognitiveTurnData`. |
| `ChatView.tsx` | Turn renderer — markdown output with syntax highlighting | Renders `<CycleTrace>` between prompt and response when `CognitiveTurnData` exists. Renders reflection footer below response. |
| `SessionSidebar.tsx` | 228px left panel — session list, health dot | Conditionally renders `<CognitivePanel>` when active session is cognitive. Shows brain badge for cognitive sessions in the list. |
| `Sessions.tsx` | Composition root — wires sidebar, chat, prompt, status bar | Passes cognitive state data from `usePromptStream` through to child components. |
| `SpawnSessionModal.tsx` | Session spawn form | Needs provider_type selector (print vs cognitive-agent) and optional config dropdown. |
| `pairTurns.ts` | Groups transcript entries into ChatTurn pairs | May need extension for cognitive turn data attachment. |

### Pacta — consumed, NOT modified

| File | Role | Consumed by |
|------|------|-------------|
| `cognitive/engine/create-cognitive-agent.ts` | `createCognitiveAgent()` factory, `CognitiveAgent` interface | CognitiveAgentProvider wraps this |
| `cognitive/engine/cycle.ts` | `CycleModules`, `CycleConfig`, `CycleResult` | Provider wires modules into cycle |
| `cognitive/algebra/events.ts` | `CognitiveEvent` union type | Provider maps these to `CognitiveSSEEvent` |
| `cognitive/modules/*` | 8+ cognitive module factories | Provider creates and wires these |
| `ports/agent-provider.ts` | `AgentProvider` interface | Provider uses `anthropicProvider` via this |

### Shared surface types (new, consumed by both backend and frontend)

The PRD defines two key shared types that bridge the backend emitter and frontend parser:

1. **`CognitiveSSEEvent`** — discriminated union of SSE event types emitted during cognitive session streaming. Extends the existing `StreamEvent` (`text`/`done`/`error`) with cognitive-specific variants. Defined on the backend in the sessions domain types, mirrored in the frontend types.

2. **`CognitiveTurnData`** — accumulated cognitive state for a single turn, built up from SSE events during streaming. Frontend-only accumulation type, but its shape is determined by the SSE event contract.

## FCA Partition

| Commission | Domain | Phase | Title | Depends On | Wave |
|------------|--------|-------|-------|------------|------|
| C-0 | shared surface | Pre | Shared types: CognitiveSSEEvent, CognitiveTurnData, SessionMode extension | -- | 0 |
| C-1 | bridge/sessions (backend) | P1 | CognitiveAgentProvider + route/pool extensions | C-0 | 1 |
| C-2 | bridge/sessions (frontend) | P2 | Inline Cycle Trace — CycleTrace component + usePromptStream cognitive parsing | C-0 | 2 |
| C-3 | bridge/sessions (frontend) | P3 | Cognitive State Sidebar Panel | C-0 | 2 |
| C-4 | bridge/sessions (frontend) | P4 | Reflection Footer + Memory Viewer | C-2 | 3 |
| C-5 | bridge/sessions (frontend) | P1-P4 | SpawnSessionModal + session list cognitive badging | C-1 | 3 |

**Total:** 6 commissions (C-0 through C-5), 4 waves (0-3)

## Waves

### Wave 0 — Shared Surface Preparation

Orchestrator applies before any commission starts. These are type definitions that both backend and frontend depend on.

**Changes:**

1. **`packages/bridge/src/domains/sessions/pool.ts`** — Extend `SessionMode` type:
   ```typescript
   export type SessionMode = 'print' | 'cognitive-agent';
   ```
   This is additive — existing code that checks `mode === 'print'` continues to work. The `SessionStatusInfo.mode` field already uses this type.

2. **`packages/bridge/src/domains/sessions/pool.ts`** — Extend `StreamEvent` type with cognitive variants:
   ```typescript
   export interface StreamEvent {
     type: 'text' | 'done' | 'error' | 'cycle-start' | 'cycle-action' | 'monitor' | 'affect' | 'memory' | 'reflection';
     content?: string;
     output?: string;
     metadata?: Record<string, unknown> | null;
     timed_out?: boolean;
     error?: string;
     // Cognitive fields (present only for cognitive event types)
     cycle?: number;
     maxCycles?: number;
     action?: string;
     confidence?: number;
     tokens?: number;
     intervention?: string;
     restricted?: string[];
     label?: string;
     valence?: number;
     arousal?: number;
     retrieved?: number;
     stored?: number;
     totalCards?: number;
     lessons?: string[];
   }
   ```
   Alternatively, this can be a discriminated union — the commission agent should decide based on TypeScript best practices. The key constraint is backward compatibility: existing `type: 'text' | 'done' | 'error'` handling must not break.

3. **`packages/bridge/src/domains/sessions/pool.ts`** — Extend `SessionPool.create()` options:
   ```typescript
   // Add to create() options:
   provider_type?: 'print' | 'cognitive-agent';
   cognitive_config?: string;       // config name (e.g. 'baseline')
   cognitive_patterns?: string[];   // pattern flags (e.g. ['P5', 'P6'])
   ```

4. **`packages/bridge/frontend/src/domains/sessions/types.ts`** — Add frontend types:
   ```typescript
   export interface CognitiveCycleData {
     number: number;
     action: string;
     confidence: number;
     tokens: number;
     monitor?: { intervention: string; restricted?: string[] };
     affect?: { label: string; valence: number; arousal: number };
   }

   export interface CognitiveTurnData {
     cycles: CognitiveCycleData[];
     memory?: { retrieved: number; stored: number; totalCards: number };
     reflection?: { lessons: string[] };
     profile?: string;
   }
   ```
   Extend `SessionSummary.mode` to `'pty' | 'print' | 'cognitive-agent'`.
   Extend `SpawnRequest` with `provider_type?: string`, `cognitive_config?: string`, `cognitive_patterns?: string[]`.
   Extend `ChatTurn` streaming variant to include optional `cognitiveData?: CognitiveTurnData`.

**Verification:** `npm run build` passes after Wave 0 changes. Existing tests remain green because all changes are additive (new union members, new optional fields, new interfaces).

### Wave 1 — Backend: CognitiveAgentProvider

Single commission: C-1 implements the cognitive agent provider and wires it into the session pool.

- **C-1: CognitiveAgentProvider** — `cognitive-provider.ts` (new file), modifications to `pool.ts` (provider factory in `create()` and `promptStream()`), modifications to `routes.ts` (new fields in POST `/sessions` body parsing).

This is a solo wave because all frontend work depends on the backend emitting cognitive SSE events correctly.

### Wave 2 — Frontend: Cycle Trace + Sidebar (parallel)

Two independent frontend commissions that write to different files:

- **C-2: Inline Cycle Trace** — `CycleTrace.tsx` (new component), modifications to `usePromptStream.ts` (cognitive event parsing), modifications to `ChatView.tsx` (render cycle trace between prompt and response)
- **C-3: Cognitive State Sidebar Panel** — `CognitivePanel.tsx` (new component), modifications to `SessionSidebar.tsx` (conditional render)

These are parallel because:
- C-2 writes to `CycleTrace.tsx` (new), `usePromptStream.ts`, `ChatView.tsx`
- C-3 writes to `CognitivePanel.tsx` (new), `SessionSidebar.tsx`
- No file overlap. Both read from the same `CognitiveTurnData` type (defined in Wave 0).
- Both consume SSE events but accumulate/render them independently.

**Conflict surface:** Both commissions modify `Sessions.tsx` to thread cognitive data. Mitigation: C-2 owns the data flow (usePromptStream accumulation + ChatView prop), C-3 consumes the same accumulated state but reads it from a different prop path (sidebar panel). The `Sessions.tsx` integration is handled in C-5 (Wave 3) which runs after both are done.

### Wave 3 — Frontend: Reflection + Spawn Integration (parallel)

- **C-4: Reflection Footer + Memory Viewer** — `ReflectionFooter.tsx` (new component), `MemoryViewer.tsx` (new component), modifications to `ChatView.tsx` (render reflection below response, memory viewer trigger)
- **C-5: SpawnSessionModal + Session List Cognitive Badging** — modifications to `SpawnSessionModal.tsx` (provider_type selector), `SessionSidebar.tsx` (brain badge), `Sessions.tsx` (cognitive data threading to all components)

These are parallel because:
- C-4 writes to `ReflectionFooter.tsx` (new), `MemoryViewer.tsx` (new), `ChatView.tsx` (reflection section)
- C-5 writes to `SpawnSessionModal.tsx`, `SessionSidebar.tsx` (badge only — disjoint from C-3's panel), `Sessions.tsx`
- File overlap on `ChatView.tsx` is minimal: C-4 adds a new section below the response, C-5 does not touch ChatView.

## Commission Cards

### C-0: Shared Surface — CognitiveSSEEvent, CognitiveTurnData, SessionMode Extension

- **Domain:** shared surface (backend + frontend types)
- **Executed by:** Orchestrator (not a sub-agent commission)
- **Wave:** 0
- **Files modified:**
  - `packages/bridge/src/domains/sessions/pool.ts` — extend `SessionMode` with `'cognitive-agent'`, extend `StreamEvent` with cognitive variants, extend `create()` options
  - `packages/bridge/frontend/src/domains/sessions/types.ts` — add `CognitiveCycleData`, `CognitiveTurnData`, extend `SessionSummary.mode`, extend `SpawnRequest`, extend `ChatTurn` streaming variant
- **Verification:** `npm run build` passes, existing tests green (all changes additive)
- **Tasks:**
  1. Add `'cognitive-agent'` to `SessionMode` type in `pool.ts` (line 28)
  2. Extend `StreamEvent` type in `pool.ts` with cognitive event fields (additive optional fields or discriminated union variants)
  3. Add `provider_type`, `cognitive_config`, `cognitive_patterns` optional fields to `SessionPool.create()` options
  4. Add `CognitiveCycleData` and `CognitiveTurnData` interfaces to frontend `types.ts`
  5. Extend `SessionSummary.mode` to `'pty' | 'print' | 'cognitive-agent'`
  6. Extend `SpawnRequest` with `provider_type`, `cognitive_config`, `cognitive_patterns` optional fields
  7. Extend `ChatTurn` streaming variant with optional `cognitiveData?: CognitiveTurnData`
  8. Run `npm run build` — verify no breakage

### C-1: CognitiveAgentProvider — Backend Provider + Route/Pool Wiring

- **Domain:** bridge/src/domains/sessions (backend)
- **Allowed paths:**
  - `packages/bridge/src/domains/sessions/cognitive-provider.ts` (new)
  - `packages/bridge/src/domains/sessions/cognitive-provider.test.ts` (new)
  - `packages/bridge/src/domains/sessions/pool.ts` (provider factory in `create()` and `promptStream()`)
  - `packages/bridge/src/domains/sessions/routes.ts` (POST `/sessions` body parsing)
  - `packages/bridge/src/domains/sessions/types.ts` (re-export new types)
  - `packages/bridge/src/domains/sessions/index.ts` (re-export)
- **Forbidden paths:** `packages/pacta/**` (consume only, do not modify), `packages/bridge/frontend/**`, `registry/**`, `theory/**`
- **Branch:** `feat/prd033-c1-cognitive-provider`
- **Wave:** 1
- **Depends on:** C-0 (SessionMode extended, StreamEvent extended, create() options extended)
- **PRD phase:** P1
- **Deliverables:**
  - `cognitive-provider.ts` — new file containing:
    - `CognitiveSessionConfig` interface: config name, pattern flags, module overrides
    - `createCognitiveSession()` factory function that:
      - Creates cognitive modules (observer, memory, reasoner, actor, monitor, evaluator, planner, reflector) using factories from `@method/pacta`
      - Creates a `CognitiveAgent` via `createCognitiveAgent()` from `@method/pacta`
      - Returns a session-like object implementing a `sendCognitivePrompt()` method
    - `sendCognitivePrompt(agent, input, onEvent)`:
      - Invokes `agent.invoke(input)` with an `onEvent` callback
      - Maps `CognitiveEvent` objects (from pacta algebra) to `StreamEvent` objects (bridge SSE types)
      - Emits `cycle-start`, `cycle-action`, `monitor`, `affect`, `memory`, `reflection` events via the callback
      - Emits `text` events for streaming output
      - Emits `done` event with final output + metadata
  - `pool.ts` modifications:
    - In `create()`: when `provider_type === 'cognitive-agent'`, store the cognitive config and set `sessionModes` to `'cognitive-agent'`
    - In `promptStream()`: when session mode is `'cognitive-agent'`, route through `sendCognitivePrompt()` instead of `session.sendPromptStream()`
    - The cognitive provider runs the cognitive cycle internally — it does NOT shell out to `claude --print`. It uses `anthropicProvider` from `@method/pacta-provider-anthropic` (or the existing claude-cli provider) for LLM calls within the cycle.
  - `routes.ts` modifications:
    - POST `/sessions` body: parse `provider_type`, `config`, `patterns` fields
    - Pass `provider_type`, `cognitive_config`, `cognitive_patterns` through to `pool.create()`
    - Response: include `mode: 'cognitive-agent'` when applicable
- **Acceptance criteria:**
  - AC-1: POST /sessions accepts `provider_type='cognitive-agent'` and config parameter
  - AC-2: SSE stream emits `CognitiveSSEEvent` types during cognitive processing
  - SC-5: Existing print sessions completely unaffected
- **Tasks:**
  1. Create `cognitive-provider.ts` with `CognitiveSessionConfig` interface
  2. Implement `createCognitiveSession()` — wire 8 cognitive modules using pacta factories, create workspace config, create cycle config
  3. Implement cognitive event mapping: `CognitiveEvent` (pacta) -> `StreamEvent` (bridge). Map `cognitive:cycle_phase` -> `cycle-start`, `cognitive:module_step` (actor) -> `cycle-action`, `cognitive:monitoring_signal` -> `monitor`, etc.
  4. Implement `sendCognitivePrompt()` — invoke cognitive agent, relay mapped events via callback, emit `done` with final output
  5. Modify `pool.ts` `create()`: store cognitive config when `provider_type === 'cognitive-agent'`, track mode
  6. Modify `pool.ts` `promptStream()`: branch on session mode — cognitive sessions use `sendCognitivePrompt()`, print sessions use existing path
  7. Modify `routes.ts` POST `/sessions`: parse and pass through `provider_type`, `config`, `patterns` fields
  8. Write unit tests: cognitive session creation, event emission sequence, print session non-regression
- **Estimated tasks:** 8

### C-2: Inline Cycle Trace — CycleTrace Component + usePromptStream Cognitive Parsing

- **Domain:** bridge/frontend/src/domains/sessions (frontend)
- **Allowed paths:**
  - `packages/bridge/frontend/src/domains/sessions/CycleTrace.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/CycleTrace.test.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/usePromptStream.ts` (extend SSE parser)
  - `packages/bridge/frontend/src/domains/sessions/ChatView.tsx` (render CycleTrace)
- **Forbidden paths:** `packages/bridge/src/**` (backend), `packages/pacta/**`, `packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx` (owned by C-3)
- **Branch:** `feat/prd033-c2-cycle-trace`
- **Wave:** 2
- **Depends on:** C-0 (CognitiveTurnData type, ChatTurn extension, StreamEvent cognitive variants)
- **PRD phase:** P2
- **Deliverables:**
  - `usePromptStream.ts` modifications:
    - Extend internal state to accumulate `CognitiveTurnData` alongside `streamingText`
    - In the SSE event parser loop, handle new event types:
      - `cycle-start` -> initialize new cycle entry in `cycles[]`
      - `cycle-action` -> update current cycle with action, confidence, tokens
      - `monitor` -> attach monitor data to current cycle
      - `affect` -> attach affect data to current cycle
      - `memory` -> set memory summary
      - `reflection` -> set reflection lessons
    - Expose `cognitiveData: CognitiveTurnData | null` in `UsePromptStreamResult`
    - Return `cognitiveData` alongside `output` in `StreamDoneResult`
  - `CycleTrace.tsx` — new component:
    - Props: `{ cycles: CognitiveCycleData[], expanded?: boolean }`
    - **Compact mode** (default): horizontal timeline of cycle badges
      - Format: `[c1] Read -> [c2] Glob -> [c3] Read ! -> [c4] Write`
      - Color coding: green (confidence > 0.7), yellow (monitor intervention), red (confidence < 0.3), blue (final cycle)
      - Shows cycle number + action name + optional warning/check icon
    - **Expanded mode** (click to toggle): vertical list with per-cycle detail
      - Action, confidence bar, token count, monitor intervention text, affect label
    - Collapsible via click on compact bar — defaults to compact
    - Style: monospace font, subdued background (`var(--slate-dark)`), no more than 40px height in compact mode
  - `ChatView.tsx` modifications:
    - When a turn (streaming or live) has `cognitiveData`, render `<CycleTrace>` between the prompt bubble and the response bubble
    - Pass `cognitiveData.cycles` to `CycleTrace`
    - Non-cognitive turns: no change (AC-6: visual diff = 0)
- **Acceptance criteria:**
  - AC-3: CycleTrace renders compact timeline, expandable to full detail
  - AC-6: Non-cognitive sessions render identically to current behavior
- **Tasks:**
  1. Extend `UsePromptStreamResult` and `StreamDoneResult` interfaces with `cognitiveData` field
  2. Add cognitive event accumulation state (`cyclesRef`, `memoryRef`, `reflectionRef`) to `usePromptStream`
  3. Implement SSE event handlers for `cycle-start`, `cycle-action`, `monitor`, `affect`, `memory`, `reflection`
  4. Build `CycleTrace.tsx` compact mode — horizontal badge timeline with color coding
  5. Build `CycleTrace.tsx` expanded mode — vertical detail view with confidence bars, token counts, monitor text
  6. Implement collapsible toggle (compact <-> expanded) with smooth transition
  7. Modify `ChatView.tsx` — render `<CycleTrace>` between prompt and response when cognitive data present
  8. Write tests: CycleTrace renders correct badges, expand/collapse works, non-cognitive turns unaffected
- **Estimated tasks:** 8

### C-3: Cognitive State Sidebar Panel

- **Domain:** bridge/frontend/src/domains/sessions (frontend)
- **Allowed paths:**
  - `packages/bridge/frontend/src/domains/sessions/CognitivePanel.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/CognitivePanel.test.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx` (conditional panel render)
- **Forbidden paths:** `packages/bridge/src/**` (backend), `packages/pacta/**`, `packages/bridge/frontend/src/domains/sessions/ChatView.tsx` (owned by C-2), `packages/bridge/frontend/src/domains/sessions/usePromptStream.ts` (owned by C-2)
- **Branch:** `feat/prd033-c3-cognitive-panel`
- **Wave:** 2
- **Depends on:** C-0 (CognitiveTurnData type)
- **PRD phase:** P3
- **Deliverables:**
  - `CognitivePanel.tsx` — new sidebar component:
    - Props: `{ data: CognitiveTurnData | null, isStreaming: boolean }`
    - Sections:
      - **Workspace meter**: entries used / capacity (horizontal bar)
      - **Memory summary**: card counts by type (HEURISTIC, FACT, RULE, PROCEDURE, OBSERVATION) as small badge row
      - **Affect indicator**: emoji + label + valence bar (green-to-red gradient)
      - **Monitor activity**: intervention count + last intervention type
      - **Profile badge**: meta-composer classification (e.g., "routine", "deliberate")
    - Live updating: re-renders as props change during streaming
    - Hidden when `data` is null (non-cognitive session)
    - Style: fits within sidebar width (228px), dark theme, compact layout
  - `SessionSidebar.tsx` modifications:
    - Accept optional `cognitiveData` prop
    - Below the session list, conditionally render `<CognitivePanel>` when active session is cognitive AND `cognitiveData` is non-null
    - Panel appears below the session list with a section divider
- **Acceptance criteria:**
  - AC-4: CognitivePanel shows workspace/memory/affect/monitor state
  - SC-4: Sidebar cognitive panel updates in real time during processing
- **Tasks:**
  1. Build `CognitivePanel.tsx` workspace meter section (horizontal progress bar)
  2. Build memory summary section (badge row with counts per epistemic type)
  3. Build affect indicator section (emoji lookup table + valence gradient bar)
  4. Build monitor activity section (count + last intervention)
  5. Build profile badge section
  6. Modify `SessionSidebar.tsx` — accept `cognitiveData` prop, render `<CognitivePanel>` conditionally below session list
  7. Write tests: CognitivePanel renders all sections, hidden when data is null, updates during streaming simulation
- **Estimated tasks:** 7

### C-4: Reflection Footer + Memory Viewer

- **Domain:** bridge/frontend/src/domains/sessions (frontend)
- **Allowed paths:**
  - `packages/bridge/frontend/src/domains/sessions/ReflectionFooter.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/MemoryViewer.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/ReflectionFooter.test.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/MemoryViewer.test.tsx` (new)
  - `packages/bridge/frontend/src/domains/sessions/ChatView.tsx` (render reflection footer, memory viewer trigger)
- **Forbidden paths:** `packages/bridge/src/**` (backend), `packages/pacta/**`, `packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx` (owned by C-3/C-5)
- **Branch:** `feat/prd033-c4-reflection-footer`
- **Wave:** 3
- **Depends on:** C-2 (ChatView renders cognitive turns, usePromptStream provides reflection data)
- **PRD phase:** P4
- **Deliverables:**
  - `ReflectionFooter.tsx` — new component:
    - Props: `{ lessons: string[] }`
    - Renders a visually distinct card below the agent response
    - Header: "Reflection" with a lightbulb or book icon
    - Body: bulleted list of lesson strings
    - Style: distinct background (slightly lighter than chat bubble), left border accent in `var(--solar)`, subtle card shadow
    - Hidden when `lessons` is empty
  - `MemoryViewer.tsx` — new component (modal/panel):
    - Props: `{ memoryData: { retrieved: number; stored: number; totalCards: number }, sessionId: string, open: boolean, onClose: () => void }`
    - Fetches full memory card details via GET `/sessions/:id/memory` (new route — or reads from accumulated cognitive data if available)
    - Displays FactCards grouped by type (HEURISTIC, FACT, RULE, PROCEDURE, OBSERVATION)
    - Each card shows: content preview, confidence score, source metadata, links to related cards
    - Sorted by confidence within each group
    - Style: overlay modal or slide-in panel, dark theme, scrollable
  - `ChatView.tsx` modifications:
    - Below each response bubble with reflection data, render `<ReflectionFooter lessons={turn.cognitiveData.reflection.lessons} />`
    - Add "View Memory" button in turns with memory data — opens `<MemoryViewer>`
    - Non-cognitive turns: no change
- **Acceptance criteria:**
  - AC-5: Reflection footer displays lessons after task completion
  - SC-6: Cognitive UX works as a research tool — cycle traces can be exported
- **Tasks:**
  1. Build `ReflectionFooter.tsx` — visually distinct card with lesson list
  2. Build `MemoryViewer.tsx` — modal with grouped FactCard display
  3. Implement FactCard type display (grouped tabs or sections by EpistemicType)
  4. Add "View Memory" button to ChatView for cognitive turns with memory data
  5. Modify `ChatView.tsx` — render `<ReflectionFooter>` below response when reflection data present
  6. Write tests: ReflectionFooter renders lessons, hidden when empty, MemoryViewer groups cards correctly
- **Estimated tasks:** 6

### C-5: SpawnSessionModal + Session List Cognitive Badging

- **Domain:** bridge/frontend/src/domains/sessions (frontend)
- **Allowed paths:**
  - `packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx` (provider_type selector)
  - `packages/bridge/frontend/src/domains/sessions/SessionSidebar.tsx` (brain badge in session list)
  - `packages/bridge/frontend/src/domains/sessions/Sessions.tsx` (cognitive data threading)
- **Forbidden paths:** `packages/bridge/src/**` (backend), `packages/pacta/**`, `packages/bridge/frontend/src/domains/sessions/ChatView.tsx` (owned by C-2/C-4)
- **Branch:** `feat/prd033-c5-spawn-and-badges`
- **Wave:** 3
- **Depends on:** C-1 (backend accepts `provider_type`), C-2 (usePromptStream exposes `cognitiveData`), C-3 (CognitivePanel exists)
- **PRD phase:** P1-P4 (integration)
- **Deliverables:**
  - `SpawnSessionModal.tsx` modifications:
    - Add "Session Type" dropdown: `Print` (default) | `Cognitive Agent`
    - When cognitive agent is selected, show:
      - Config name field (text input, default "baseline")
      - Pattern checkboxes: P1-P8 (optional, empty array means all defaults)
    - Submit payload includes `provider_type`, `cognitive_config`, `cognitive_patterns` in `SpawnRequest`
  - `SessionSidebar.tsx` modifications:
    - In the session list item renderer, show a brain icon/badge next to session name when `session.mode === 'cognitive-agent'` (AC-7)
    - Brain badge is small, monochrome, non-intrusive
  - `Sessions.tsx` modifications:
    - Thread `cognitiveData` from `usePromptStream` to:
      - `ChatView` (already done by C-2 for turns, but streaming state needs threading)
      - `SessionSidebar` (for `CognitivePanel` prop — integrates C-3's component)
      - Ensure `cognitiveData` is cleared when switching sessions
    - Pass `provider_type` etc. from `SpawnSessionModal` through to the spawn API call
- **Acceptance criteria:**
  - AC-7: Session list shows brain badge for cognitive sessions
  - SC-1: Cognitive sessions spawnable via same /sessions API with type parameter
  - SC-3: Users can distinguish cognitive from flat sessions at a glance
- **Tasks:**
  1. Add "Session Type" dropdown to SpawnSessionModal
  2. Add conditional config/pattern fields that appear when cognitive is selected
  3. Extend spawn submission to include `provider_type`, `cognitive_config`, `cognitive_patterns`
  4. Add brain badge to session list items in SessionSidebar for cognitive sessions
  5. Wire `cognitiveData` from `usePromptStream` through `Sessions.tsx` to `SessionSidebar` (CognitivePanel prop)
  6. Wire `cognitiveData` to `ChatView` turn rendering for streaming turns
  7. Handle session-switch cleanup (clear cognitive data when active session changes)
  8. Write tests: SpawnSessionModal renders cognitive options, badge renders for cognitive sessions, data threading
- **Estimated tasks:** 8

## Verification Report

### Gate 1/8 — Every PRD AC maps to >= 1 commission AC

| PRD AC | Commission(s) | Covered |
|--------|---------------|---------|
| AC-1: POST /sessions accepts provider_type='cognitive-agent' and config parameter | C-1 (backend routes + pool) | YES |
| AC-2: SSE stream emits CognitiveSSEEvent types during cognitive processing | C-1 (cognitive provider event mapping) | YES |
| AC-3: CycleTrace component renders compact timeline, expandable to full detail | C-2 (CycleTrace.tsx) | YES |
| AC-4: CognitivePanel shows workspace/memory/affect/monitor state | C-3 (CognitivePanel.tsx) | YES |
| AC-5: Reflection footer displays lessons after task completion | C-4 (ReflectionFooter.tsx) | YES |
| AC-6: Non-cognitive sessions render identically to current behavior | C-2 (conditional rendering, non-cognitive path unchanged) | YES |
| AC-7: Session list shows brain badge for cognitive sessions | C-5 (SessionSidebar badge) | YES |

**Result: 7/7 ACs covered. PASS.**

### Gate 2/8 — No commission modifies files outside its allowed-paths

| Commission | Allowed paths | Boundary violations |
|------------|---------------|---------------------|
| C-0 (orchestrator) | `pool.ts`, frontend `types.ts` | N/A — orchestrator |
| C-1 | `cognitive-provider.ts` (new), `pool.ts`, `routes.ts`, `types.ts`, `index.ts` | None — all in `bridge/src/domains/sessions/` |
| C-2 | `CycleTrace.tsx` (new), `usePromptStream.ts`, `ChatView.tsx` | None — all in `bridge/frontend/src/domains/sessions/` |
| C-3 | `CognitivePanel.tsx` (new), `SessionSidebar.tsx` | None — all in `bridge/frontend/src/domains/sessions/` |
| C-4 | `ReflectionFooter.tsx` (new), `MemoryViewer.tsx` (new), `ChatView.tsx` | None — all in `bridge/frontend/src/domains/sessions/` |
| C-5 | `SpawnSessionModal.tsx`, `SessionSidebar.tsx`, `Sessions.tsx` | None — all in `bridge/frontend/src/domains/sessions/` |

**Result: PASS.**

### Gate 3/8 — Parallel commissions within each wave have zero file overlap

| Wave | Commissions | Files per commission | Overlap |
|------|-------------|---------------------|---------|
| 0 | C-0 only | `pool.ts`, frontend `types.ts` | N/A |
| 1 | C-1 only | `cognitive-provider.ts`, `pool.ts`, `routes.ts`, backend `types.ts`, `index.ts` | N/A |
| 2 | C-2, C-3 | C-2: `CycleTrace.tsx`, `usePromptStream.ts`, `ChatView.tsx` / C-3: `CognitivePanel.tsx`, `SessionSidebar.tsx` | **ZERO overlap** |
| 3 | C-4, C-5 | C-4: `ReflectionFooter.tsx`, `MemoryViewer.tsx`, `ChatView.tsx` / C-5: `SpawnSessionModal.tsx`, `SessionSidebar.tsx`, `Sessions.tsx` | **ZERO overlap** |

**Result: PASS.**

### Gate 4/8 — Every commission depends only on commissions in earlier waves

| Commission | Wave | Depends on | Dependency waves | Valid |
|------------|------|------------|------------------|-------|
| C-0 | 0 | -- | -- | YES |
| C-1 | 1 | C-0 | 0 | YES |
| C-2 | 2 | C-0 | 0 | YES |
| C-3 | 2 | C-0 | 0 | YES |
| C-4 | 3 | C-2 | 2 | YES |
| C-5 | 3 | C-1, C-2, C-3 | 1, 2, 2 | YES |

**Result: PASS.**

### Gate 5/8 — No commission modifies `@method/pacta` source

| Commission | Modifies pacta? |
|------------|----------------|
| C-0 | NO (modifies bridge types only) |
| C-1 | NO (imports from pacta, does not modify) |
| C-2 | NO (frontend only) |
| C-3 | NO (frontend only) |
| C-4 | NO (frontend only) |
| C-5 | NO (frontend only) |

**Result: PASS.**

### Gate 6/8 — Commission count and wave count within bounds

- **Commissions:** 6 (C-0 through C-5) — within 5-7 range. PASS.
- **Waves:** 4 (Wave 0 through Wave 3) — within 3-4 range. PASS.

**Result: PASS.**

### Gate 7/8 — Each commission has a branch name, scope, ACs, and task list

| Commission | Branch | Scope | ACs | Tasks |
|------------|--------|-------|-----|-------|
| C-0 | N/A (orchestrator) | Shared types | build passes | 8 |
| C-1 | `feat/prd033-c1-cognitive-provider` | Backend provider + wiring | AC-1, AC-2, SC-5 | 8 |
| C-2 | `feat/prd033-c2-cycle-trace` | CycleTrace + SSE parsing | AC-3, AC-6 | 8 |
| C-3 | `feat/prd033-c3-cognitive-panel` | Sidebar panel | AC-4, SC-4 | 7 |
| C-4 | `feat/prd033-c4-reflection-footer` | Reflection + memory viewer | AC-5, SC-6 | 6 |
| C-5 | `feat/prd033-c5-spawn-and-badges` | Spawn modal + badges + data threading | AC-7, SC-1, SC-3 | 8 |

**Result: PASS.**

### Gate 8/8 — SC-5 (zero regression for print sessions) is explicitly addressed

SC-5 is addressed at multiple levels:

1. **Wave 0:** All type changes are additive — new union members, new optional fields. Existing code paths that handle `SessionMode = 'print'` or `StreamEvent.type = 'text' | 'done' | 'error'` are unaffected.
2. **C-1 (backend):** `pool.promptStream()` branches on session mode. The existing print session path is untouched — cognitive sessions take a new code path. C-1 test suite must include a print session non-regression test.
3. **C-2 (frontend):** `usePromptStream` SSE parser handles unknown event types gracefully (existing `continue` in parse loop). `ChatView` only renders `CycleTrace` when `cognitiveData` is present — non-cognitive turns skip the component entirely.
4. **C-5 (frontend):** `Sessions.tsx` passes `cognitiveData: null` to components when the active session is not cognitive, triggering all conditional-render guards to hide cognitive UI.

**Result: PASS.**

---

**Verification summary: 8/8 gates passed.**

## Execution Order

```
Wave 0: C-0 (orchestrator applies shared types)
  |
Wave 1: C-1 (backend cognitive provider)
  |
Wave 2: C-2 (cycle trace) || C-3 (sidebar panel)
  |
Wave 3: C-4 (reflection footer) || C-5 (spawn + badges + integration)
```

Total commissions: 6 (1 orchestrator + 5 sub-agent)
Total sub-agent commissions: 5
Parallelism: 2 parallel pairs (Wave 2 and Wave 3)
Estimated total tasks: 45
