# PRD 025: Universal Genesis — Ambient Agent UI

**Nickname:** GES (Genesis Event Store) — the frontend user activity & page context system.
Distinct from UEB (Universal Event Bus, PRD 026) which handles backend system events.

**Status:** Draft
**Author:** PO + Lysica
**Date:** 2026-03-24
**Depends on:** None (foundational — WS-3 session UX builds on top)
**Complementary:** PRD 026 (UEB) — Genesis consumes both GES (user activity) and UEB (system events)

## Problem

Genesis (the persistent coordination agent) is currently scoped to the Dashboard page.
Navigate away → Genesis disappears. The chat, FAB, and all Genesis state are local React
state inside `Dashboard.tsx`. This means:

- Genesis has no awareness of what the user is doing on other pages
- Genesis cannot guide the user across pages (e.g., "look at this strategy execution")
- The chat conversation is lost on navigation
- Genesis cannot control the UI (navigate, highlight, open panels)
- Mobile users lose the agent entirely when browsing sessions or strategies

Genesis should be an **ambient presence** — always available, always aware, always able
to act on the user's behalf across the entire application.

## Objective

Make Genesis a universal, page-aware, UI-controlling agent that persists across all
navigation and adapts to the device (desktop floating panel, mobile full-screen chat).

## Architecture

### Core Principle: Store-Mediated Pub/Sub

Genesis communicates with the rest of the UI through a shared Zustand store — never
through direct imports. This preserves FCA boundary discipline:

```
Pages (context producers)                 Genesis (context consumer + action producer)
─────────────────────────                 ────────────────────────────────────────────
domains/sessions/      ──write context──→ shared/stores/genesis-store.ts ←──read context──  domains/genesis/
domains/strategies/    ──write context──→
domains/projects/      ──write context──→                                ──write actions──→
domains/registry/      ──write context──→
                       ←──read actions──  shared/stores/genesis-store.ts
```

No domain imports another domain. The store IS the port.

### Genesis Dual-Source Intelligence: GES + UEB

Genesis achieves full situational awareness by consuming two complementary event sources:

```
┌─────────────────────────────────────────────────────────────────┐
│                     GENESIS AGENT                               │
│                                                                 │
│  "User is on the Registry page looking at M1-IMPL v3.1.        │
│   Meanwhile, session abc-123 has been idle for 8 minutes        │
│   and strategy smoke-test has a failed gate."                   │
│                                                                 │
│         ┌──────────────┐          ┌──────────────┐              │
│         │   GES input  │          │   UEB input  │              │
│         │  (frontend)  │          │  (backend)   │              │
│         └──────┬───────┘          └──────┬───────┘              │
└────────────────┼─────────────────────────┼──────────────────────┘
                 │                         │
    ┌────────────▼────────────┐  ┌─────────▼──────────────┐
    │  GES — Genesis Store    │  │  UEB — Universal Event  │
    │  (PRD 025, frontend)    │  │  Bus (PRD 026, backend) │
    │                         │  │                         │
    │  • User navigation      │  │  • Session lifecycle    │
    │  • Page context          │  │  • Strategy execution   │
    │  • Selected project     │  │  • Trigger fires        │
    │  • UI interactions      │  │  • Methodology steps    │
    │  • Chat state           │  │  • PTY observations     │
    │  • Idle detection       │  │  • System health        │
    │                         │  │                         │
    │  Zustand store          │  │  EventBus port          │
    │  Client-side only       │  │  Server-side only       │
    │  Per-browser instance   │  │  Per-bridge instance    │
    └─────────────────────────┘  └─────────────────────────┘
```

**GES (this PRD)** tells Genesis what the **user** is doing:
- Which page they're on, what they've selected, how long they've been looking at it
- What they typed in the chat, what actions they triggered from the UI
- Whether they're idle (tab backgrounded) or actively engaged
- Per-client, per-browser — no server round-trip needed

**UEB (PRD 026)** tells Genesis what the **system** is doing:
- Which sessions are running, stale, or dead
- Which strategy gates passed or failed
- Which triggers fired and what they spawned
- What methodology steps were advanced
- Delivered via GenesisSink — batched, filtered, summarized every 30s

**Why two systems, not one:**
- User activity is client-specific — two users looking at different pages should each have
  their own Genesis context. Sending user clicks through the backend bus would leak
  cross-client state.
- System events are global — a strategy gate failure matters regardless of which page
  the user is on. The backend bus is the right place for this.
- Latency: GES is in-process (Zustand read = synchronous). UEB round-trips through
  WebSocket + GenesisSink batching (~30s delay). User context needs to be instant;
  system context can be batched.

**How Genesis combines them:**
The Genesis chat panel reads from GES (page context, chat history) and receives UEB
summaries via the GenesisSink prompt. When composing a response, Genesis has:
1. **Immediate context** (GES): "User is on /registry, looking at M1-IMPL"
2. **System context** (UEB): "3 sessions active, 1 stale, strategy gate failed 2 min ago"
3. **Chat history** (GES): previous conversation messages
4. **Action capability** (GES): can navigate user, highlight elements, spawn sessions

This is what makes Genesis an **ambient agent** rather than a chatbot — it doesn't just
answer questions, it proactively notices situations across both user behavior and system
state, and can act on both.

### State Model

```typescript
// shared/stores/genesis-store.ts
interface GenesisState {
  // ── Chat state (persists across navigation) ──
  isOpen: boolean;
  messages: ChatMessage[];
  inputDraft: string;

  // ── Agent state ──
  sessionId: string | null;
  status: 'active' | 'idle' | 'disconnected';
  budgetPercent: number;

  // ── Page awareness (written by pages on mount) ──
  currentPage: {
    route: string;               // e.g., '/strategies/smoke-test'
    domain: string;              // e.g., 'strategies'
    context: Record<string, unknown>;  // page-specific data
  };
  selectedProject: ProjectMetadata | null;

  // ── System awareness (received from UEB via WebSocket) ──
  systemSummary: {
    activeSessions: number;
    staleSessions: string[];
    recentEvents: Array<{ type: string; summary: string; timestamp: string }>;
    lastUpdated: string;
  } | null;

  // ── UI control (written by Genesis, read by pages) ──
  pendingAction: GenesisAction | null;

  // ── Actions ──
  setOpen: (open: boolean) => void;
  addMessage: (msg: ChatMessage) => void;
  setPageContext: (page: string, domain: string, context: Record<string, unknown>) => void;
  setSelectedProject: (project: ProjectMetadata | null) => void;
  setSystemSummary: (summary: GenesisState['systemSummary']) => void;
  dispatchAction: (action: GenesisAction) => void;
  consumeAction: () => GenesisAction | null;
}
```

### Action Types

```typescript
type GenesisAction =
  | { type: 'navigate'; path: string }
  | { type: 'highlight'; selector: string; duration?: number }
  | { type: 'openPanel'; panel: string; id: string }
  | { type: 'closePanel' }
  | { type: 'toast'; message: string; severity: 'info' | 'warning' | 'error' }
  | { type: 'spawnSession'; projectId: string; prompt?: string }
  | { type: 'focusProject'; projectId: string };
```

### Component Placement

```tsx
// App.tsx — Genesis renders at the root, outside Routes
<ErrorBoundary>
  <BrowserRouter basename="/app">
    <Suspense fallback={<RouteSkeleton />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sessions" element={<Sessions />} />
        {/* ... */}
      </Routes>
    </Suspense>

    {/* Universal Genesis — always present */}
    <GenesisProvider>
      <GenesisFAB />
      <GenesisChatPanel />
    </GenesisProvider>
  </BrowserRouter>
</ErrorBoundary>
```

## Requirements

### R1: Universal Rendering

- GenesisFAB and GenesisChatPanel render on every page, not just Dashboard
- Chat conversation persists across navigation (state in Zustand store, not component state)
- FAB position persists across sessions (localStorage, already implemented)
- Opening/closing the chat does not trigger page re-renders (store slices, not top-level state)

### R2: Page Awareness

- Each page publishes its context to the genesis store on mount via a `useGenesisPageContext` hook:
  ```typescript
  // In Sessions.tsx
  useGenesisPageContext('sessions', {
    activeCount: activeSessions.length,
    selectedSession: selectedSessionId,
  });
  ```
- Genesis can read this context to tailor its responses:
  - On Dashboard: "You have 3 active sessions and your 7-day ceiling is at 76%"
  - On Sessions: "Session abc-123 has been idle for 10 minutes — want me to check on it?"
  - On Registry: "You're looking at M1-IMPL v3.1 — this is the main implementation method"
  - On Strategies: "This strategy has 2 failed gates — want me to analyze why?"
- Context updates are lightweight — only the active page writes, and only on meaningful state changes

### R3: UI Control

- Genesis can dispatch actions that pages consume:
  - `navigate` — programmatic navigation (e.g., "go to the strategies page")
  - `highlight` — temporarily highlight a DOM element (CSS pulse animation)
  - `openPanel` — open a slide-over or detail panel on the current page
  - `spawnSession` — trigger session spawn for a specific project
  - `toast` — show a notification toast
- Pages subscribe to actions via `useGenesisAction` hook:
  ```typescript
  // In Strategies.tsx
  useGenesisAction((action) => {
    if (action.type === 'highlight' && action.selector.startsWith('#strategy-')) {
      highlightElement(action.selector);
    }
  });
  ```
- Actions are fire-and-forget — Genesis dispatches, pages consume if relevant, ignore if not.
  No acknowledgment protocol. Keep it simple.

### R4: Responsive Layout

#### Desktop (>= 768px)
- FAB: floating button, bottom-right corner, draggable (current behavior)
- Chat panel: slide-over from right (420px width), does NOT block the page content
  (no backdrop overlay — the page remains interactive alongside the chat)
- Chat panel pushes content left when open (optional, configurable) or overlays without backdrop

#### Mobile (< 768px)
- FAB: smaller (48px), docked to bottom-right, NOT draggable (finger targets are imprecise)
- Chat panel: FULL SCREEN — takes over the viewport completely
  - Nav bar hidden while chat is open
  - Back button / swipe-down to close
  - Input bar sticky at bottom, above the soft keyboard
  - Messages scroll naturally (newest at bottom, scroll up for history)
- Keyboard handling:
  - `visualViewport` API to detect keyboard open/close
  - Input bar repositions above keyboard, not behind it
  - Viewport doesn't bounce or resize unexpectedly
- Reference implementations to study:
  - ChatGPT mobile (excellent keyboard handling)
  - Claude mobile (good input positioning)
  - Slack mobile (good message threading in constrained space)

### R5: FCA Compliance

- Genesis domain (`frontend/src/domains/genesis/`) owns: FAB, ChatPanel, chat logic, agent API calls
- Shared store (`frontend/src/shared/stores/genesis-store.ts`) owns: state, actions, page context
- Pages own: their own `useGenesisPageContext` calls and `useGenesisAction` handlers
- No cross-domain imports between genesis and other frontend domains
- Architecture gate G-BOUNDARY must pass after all changes
- Co-locate: genesis types in genesis domain, shared types in shared store

### R6: Bridge Integration

- Chat messages are sent to/from the Genesis bridge session via the existing
  `POST /sessions/:id/prompt` endpoint
- Genesis session auto-spawns on first chat message if not already running
  (lazy spawn — don't require bridge genesis to be enabled)
- Session status polled via existing `/health` endpoint
- WebSocket channel (`events` topic) delivers real-time updates to the chat

### R7: Playwright Smoke Testing

- Every UI change must be verified with Playwright MCP tools
- Required test scenarios:
  1. **Navigation persistence:** Open chat on Dashboard → navigate to Sessions → chat still open with messages
  2. **Page context:** Navigate to Registry, select a method → Genesis store shows registry context
  3. **Mobile viewport (375x667):** FAB visible, chat opens full-screen, input above keyboard
  4. **Desktop viewport (1280x800):** FAB in corner, chat opens as side panel, page still interactive
  5. **Action dispatch:** Genesis navigates user to a different page
- Screenshots saved to `tmp/` for PR review

## Phases

### Phase 1: State Extraction + Universal Rendering
- Create `genesis-store.ts` Zustand store
- Move Genesis state from Dashboard.tsx local state → store
- Move GenesisFAB + GenesisChatPanel to App.tsx
- Remove Genesis-specific code from Dashboard.tsx (Dashboard becomes a pure data page)
- Verify: chat persists across navigation
- Playwright: test navigation persistence

### Phase 2: Page Awareness
- Create `useGenesisPageContext` hook
- Wire into all pages: Dashboard, Sessions, Strategies, Triggers, Registry, Governance, Analytics
- Genesis reads page context from store
- Verify: store reflects correct page context as user navigates
- Playwright: test context updates on navigation

### Phase 3: Responsive Layout
- Web research: mobile chat UX best practices (ChatGPT, Claude, Slack, Discord)
- Design doc with findings before coding
- Implement mobile full-screen chat mode (< 768px breakpoint)
- Implement desktop side-panel mode (no backdrop, page stays interactive)
- Smaller FAB on mobile, non-draggable
- Keyboard avoidance using `visualViewport` API
- Playwright: test mobile viewport (375x667) + desktop viewport (1280x800)

### Phase 4: UI Control Actions
- Create `useGenesisAction` hook
- Implement action types: navigate, highlight, toast, spawnSession
- Wire action consumers into pages (at minimum: navigate works everywhere)
- Verify: Genesis can navigate user to a different page
- Playwright: test action dispatch

### Phase 5: Polish + Edge Cases
- Genesis auto-reconnect on WebSocket drop
- Chat message retry on network failure
- Graceful degradation when bridge is down (FAB shows disconnected state, chat shows offline message)
- Session transcript export (download chat history as markdown)
- Playwright: full end-to-end flow (spawn → chat → navigate → resume)

## Non-Goals

- **Agent intelligence** — this PRD is about the UI shell, not what Genesis says. The agent's
  prompt engineering, methodology awareness, and decision-making are separate concerns.
- **Multi-agent chat** — one Genesis session per bridge instance. No multi-tenant or multi-agent UI.
- **Voice input** — text only for now.
- **Offline mode** — Genesis requires a running bridge. No offline fallback.

## Success Criteria

1. Genesis FAB + chat visible on every page (not just Dashboard)
2. Chat conversation survives navigation between all pages
3. Genesis store reflects the correct page context as user navigates
4. Mobile (375x667): chat is full-screen, input visible above keyboard, no wasted space
5. Desktop (1280x800): chat is side panel, page content remains interactive
6. Architecture gate tests pass (G-PORT, G-BOUNDARY, G-LAYER)
7. Playwright screenshots prove all five test scenarios pass
8. Zero cross-domain imports between genesis and other frontend domains
