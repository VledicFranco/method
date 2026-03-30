# Realization Plan — PRD 040: Cognitive Agent Maturity

## PRD Summary

**Objective:** Make cognitive agent sessions production-grade — multi-tool cycles, conversation persistence, live streaming, cost tracking, v2 modules, model picker (Opus/Sonnet/Haiku + Ollama), session lifecycle cleanup.

**Phases:** 4 (Core Engine, Streaming+Cost, Model Picker+Ollama, Lifecycle+Polish)
**Acceptance Criteria:** AC-01 through AC-10

## FCA Partition

```
Backend (bridge/src/domains/sessions/):
  cognitive-provider.ts  → cognitive cycle engine (C-2)
  bridge-tools.ts        → filesystem tools for cognitive agents (C-1)
  pool.ts                → session factory, provider routing (C-3)
  routes.ts              → HTTP endpoints, request validation (C-3)

Frontend (bridge/frontend/src/domains/sessions/):
  SpawnSessionModal.tsx  → model picker, provider selection (C-4)
  usePromptStream.ts     → SSE parsing, metadata mapping (C-5)
  ChatView.tsx           → streaming text rendering (C-5)
  Sessions.tsx           → session lifecycle, stale cleanup (C-6)
  types.ts               → SpawnRequest type (shared surface)

Frontend (other):
  App.tsx or genesis panel → Genesis polling backoff (C-6)
```

## Commission Summary

| Commission | Domain | Phase | Title | Depends On | Wave |
|------------|--------|-------|-------|------------|------|
| C-1 | bridge/sessions (bridge-tools) | P1 | Edit tool + tool provider enhancements | — | 1 |
| C-2 | bridge/sessions (cognitive-provider) | P1-P2 | Cognitive engine v2 — multi-tool, persistence, streaming, cost | C-1 | 2 |
| C-3 | bridge/sessions (pool+routes) | P1-P3 | Pool wiring — model passthrough, session cleanup, Ollama validation | C-2 | 3 |
| C-4 | bridge/frontend (SpawnSessionModal) | P3 | Model picker — Anthropic + Ollama model dropdowns | — | 1 |
| C-5 | bridge/frontend (usePromptStream+ChatView) | P2 | Live streaming + cognitive metadata display | — | 1 |
| C-6 | bridge/frontend (Sessions+Genesis) | P4 | Session lifecycle cleanup + Genesis silence | C-3 | 4 |

## Waves

### Wave 0 — Shared Surface Preparation

Orchestrator applies:

1. **Update `frontend/types.ts`** — add `model?: string` to `SpawnRequest`, add `llm_provider_config?: { baseUrl?: string }` if not present
2. **Verify:** `npm run build` passes

### Wave 1 — Foundation (3 parallel, disjoint domains)

- **C-1:** Edit tool (backend bridge-tools.ts)
- **C-4:** Model picker (frontend SpawnSessionModal.tsx)
- **C-5:** Live streaming + metadata (frontend usePromptStream.ts + ChatView.tsx)

C-1 is backend, C-4 and C-5 are frontend but touch disjoint files — SpawnSessionModal vs usePromptStream+ChatView. No overlap.

### Wave 2 — Cognitive Engine

- **C-2:** Cognitive provider v2 rewrite (cognitive-provider.ts)

Depends on C-1 (Edit tool must exist for multi-tool testing).

### Wave 3 — Pool Wiring + Ollama

- **C-3:** Pool + routes — model passthrough, cognitive session cleanup, Ollama end-to-end

Depends on C-2 (cognitive provider v2 must be in place before pool wiring changes).

### Wave 4 — Lifecycle + Polish

- **C-6:** Frontend session lifecycle + Genesis silence

Depends on C-3 (backend cleanup logic must exist before frontend consumes it).

## Commission Cards

### C-1: Edit Tool + Tool Provider Enhancements

- **Domain:** `bridge/sessions` (bridge-tools.ts only)
- **Wave:** 1
- **Scope:**
  - **Allowed paths:**
    - `packages/bridge/src/domains/sessions/bridge-tools.ts`
    - `packages/bridge/src/domains/sessions/__tests__/bridge-tools.test.ts` (NEW)
  - **Forbidden paths:**
    - `packages/bridge/src/domains/sessions/cognitive-provider.ts`
    - `packages/bridge/src/domains/sessions/pool.ts`
    - `packages/bridge/src/domains/sessions/routes.ts`
    - `packages/bridge/src/domains/sessions/index.ts`
    - `packages/*/package.json`
- **Depends on:** —
- **Parallel with:** C-4, C-5
- **Deliverables:**
  - Add `Edit` tool to TOOL_DEFS — `{ name: 'Edit', description: 'Replace a specific string in a file. Input: { path, old_string, new_string }' }`
  - Implement Edit execution: read file, verify old_string exists exactly once, replace, write
  - Return error on 0 matches ("string not found") or 2+ matches ("ambiguous — string appears N times")
  - Same path-traversal security as Read/Write
  - Tests: 5 scenarios (success, not found, ambiguous, path traversal, empty old_string)
- **Acceptance criteria:**
  - AC-08: Edit tool performs targeted file changes → PRD AC-08
- **Estimated tasks:** 4
- **Branch:** `feat/prd040-c1-edit-tool`
- **Status:** pending

### C-2: Cognitive Engine v2 — Multi-Tool, Persistence, Streaming, Cost

- **Domain:** `bridge/sessions` (cognitive-provider.ts only)
- **Wave:** 2
- **Scope:**
  - **Allowed paths:**
    - `packages/bridge/src/domains/sessions/cognitive-provider.ts`
    - `packages/bridge/src/domains/sessions/__tests__/cognitive-provider.test.ts` (NEW)
  - **Forbidden paths:**
    - `packages/bridge/src/domains/sessions/pool.ts`
    - `packages/bridge/src/domains/sessions/routes.ts`
    - `packages/bridge/src/domains/sessions/bridge-tools.ts`
    - `packages/bridge/src/domains/sessions/index.ts`
    - `packages/*/package.json`
- **Depends on:** C-1 (Edit tool available in bridge-tools)
- **Parallel with:** —
- **Deliverables:**
  - Replace inline v1 cycle loop with v2 module composition (MonitorV2, ReasonerActorV2, PrecisionAdapter, EVC via enrichedPreset or manual wiring)
  - Multi-tool execution: up to `maxToolsPerCycle` (default 5) tool calls per cycle
  - Workspace persistence: keep WorkspaceManager across prompts within a session
  - Conversation context: inject previous prompt/response summaries as workspace entries
  - Cost/token accumulation: track totalTokens, inputTokens, outputTokens, costUsd across all LLM calls in a session
  - Emit proper `done` event with accumulated metadata: `{ totalTokens, totalCycles, monitorInterventions, costUsd, inputTokens, outputTokens }`
  - Streaming text: emit `text` events incrementally (if Anthropic provider supports streaming)
  - Tests: 8 scenarios (multi-tool cycle, workspace persistence across prompts, cost accumulation, v2 monitor impasse, Edit tool in cycle, cycle limit, error recovery, streaming text events)
- **Acceptance criteria:**
  - AC-01: Multi-tool Read→Edit→verify in 1-2 cycles → PRD AC-01
  - AC-02: Workspace persists across prompts → PRD AC-02
  - AC-03: Streaming text during execution → PRD AC-03
  - AC-04: Accurate cost/token counts → PRD AC-04
  - AC-09: v2 monitor detects impasse → PRD AC-09
- **Estimated tasks:** 8
- **Branch:** `feat/prd040-c2-cognitive-engine-v2`
- **Status:** pending

### C-3: Pool Wiring — Model Passthrough, Session Cleanup, Ollama

- **Domain:** `bridge/sessions` (pool.ts + routes.ts)
- **Wave:** 3
- **Scope:**
  - **Allowed paths:**
    - `packages/bridge/src/domains/sessions/pool.ts`
    - `packages/bridge/src/domains/sessions/routes.ts`
  - **Forbidden paths:**
    - `packages/bridge/src/domains/sessions/cognitive-provider.ts`
    - `packages/bridge/src/domains/sessions/bridge-tools.ts`
    - `packages/bridge/src/domains/sessions/index.ts`
    - `packages/*/package.json`
- **Depends on:** C-2 (cognitive provider v2 ready)
- **Parallel with:** —
- **Deliverables:**
  - Pass `model` from request body through to cognitive provider factory (Anthropic and Ollama)
  - Add `model` to routes.ts Body type and validation
  - On startup recovery: mark recovered sessions with `mode: 'cognitive-agent'` as dead (not recoverable)
  - Ollama provider: pass `baseUrl` from request config, default from `process.env.OLLAMA_BASE_URL ?? 'http://chobits:11434'`
  - Verify Ollama cognitive session end-to-end (manual test, documented)
- **Acceptance criteria:**
  - AC-06: Ollama cognitive session completes a task → PRD AC-06
  - AC-07: Stale cognitive sessions cleaned on restart → PRD AC-07
- **Estimated tasks:** 5
- **Branch:** `feat/prd040-c3-pool-wiring`
- **Status:** pending

### C-4: Model Picker — Anthropic + Ollama Model Dropdowns

- **Domain:** `bridge/frontend` (SpawnSessionModal.tsx)
- **Wave:** 1
- **Scope:**
  - **Allowed paths:**
    - `packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx`
  - **Forbidden paths:**
    - `packages/bridge/frontend/src/domains/sessions/Sessions.tsx`
    - `packages/bridge/frontend/src/domains/sessions/ChatView.tsx`
    - `packages/bridge/frontend/src/domains/sessions/usePromptStream.ts`
    - `packages/bridge/frontend/src/domains/sessions/types.ts`
    - `packages/*/package.json`
- **Depends on:** — (Wave 0 surface adds `model` to SpawnRequest type)
- **Parallel with:** C-1, C-5
- **Deliverables:**
  - Add model dropdown below LLM Provider toggle
  - Anthropic: hardcoded options — claude-opus-4-6, claude-sonnet-4-6 (default), claude-haiku-4-5
  - Ollama: fetch models from `${ollamaBaseUrl}/api/tags` when Ollama is selected, show in dropdown
  - Include selected `model` in spawn request
  - Handle Ollama fetch failure gracefully (show "Could not load models" with manual input fallback)
- **Acceptance criteria:**
  - AC-05: Model picker shows available models → PRD AC-05
- **Estimated tasks:** 5
- **Branch:** `feat/prd040-c4-model-picker`
- **Status:** pending

### C-5: Live Streaming + Cognitive Metadata Display

- **Domain:** `bridge/frontend` (usePromptStream.ts + ChatView.tsx)
- **Wave:** 1
- **Scope:**
  - **Allowed paths:**
    - `packages/bridge/frontend/src/domains/sessions/usePromptStream.ts`
    - `packages/bridge/frontend/src/domains/sessions/ChatView.tsx`
  - **Forbidden paths:**
    - `packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx`
    - `packages/bridge/frontend/src/domains/sessions/Sessions.tsx`
    - `packages/bridge/frontend/src/domains/sessions/types.ts`
    - `packages/*/package.json`
- **Depends on:** —
- **Parallel with:** C-1, C-4
- **Deliverables:**
  - Ensure `text` events render incrementally in ChatView during cognitive streaming (verify the streaming turn block shows cycle reasoning live)
  - Map cognitive `done` metadata properly (totalTokens→input_tokens, totalCycles→num_turns, costUsd→cost_usd)
  - Show cycle count in metadata chips (e.g. "3 cycles" instead of "3 turns")
  - Clear prompt input text after prompt is sent (not after response)
- **Acceptance criteria:**
  - AC-03: Streaming text visible during execution → PRD AC-03
  - AC-04: Metadata chips show real values → PRD AC-04
- **Estimated tasks:** 4
- **Branch:** `feat/prd040-c5-streaming-metadata`
- **Status:** pending

### C-6: Session Lifecycle Cleanup + Genesis Silence

- **Domain:** `bridge/frontend` (Sessions.tsx + Genesis panel)
- **Wave:** 4
- **Scope:**
  - **Allowed paths:**
    - `packages/bridge/frontend/src/domains/sessions/Sessions.tsx`
    - `packages/bridge/frontend/src/App.tsx` (or Genesis panel component — wherever genesis polling lives)
  - **Forbidden paths:**
    - `packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx`
    - `packages/bridge/frontend/src/domains/sessions/ChatView.tsx`
    - `packages/bridge/frontend/src/domains/sessions/usePromptStream.ts`
    - `packages/*/package.json`
- **Depends on:** C-3 (backend marks stale cognitive sessions as dead)
- **Parallel with:** —
- **Deliverables:**
  - Filter or badge dead/stale cognitive sessions in the sidebar (show "expired" instead of active 🧠)
  - Genesis panel: add exponential backoff to polling — stop after 3 consecutive 503s, show "unavailable" state
  - Prompt input: clear text immediately after sending (not wait for response)
- **Acceptance criteria:**
  - AC-07: Stale sessions show as expired → PRD AC-07 (frontend half)
  - AC-10: Genesis panel stops polling after failures → PRD AC-10
- **Estimated tasks:** 4
- **Branch:** `feat/prd040-c6-lifecycle-genesis`
- **Status:** pending

## Shared Surface Changes

| Wave Slot | File | Change | Lines | Reason |
|-----------|------|--------|-------|--------|
| 0→1 | `frontend/types.ts` | Add `model?: string` to SpawnRequest | ~2 | C-4 (model picker) and C-3 (pool wiring) both need model in the request |

All other changes are commission-internal. No new ports or barrels needed.

## Acceptance Gates

| PRD AC | Description | Commission |
|--------|-------------|------------|
| AC-01 | Multi-tool Read→Edit→verify in 1-2 cycles | C-2 |
| AC-02 | Workspace persists across prompts | C-2 |
| AC-03 | Streaming text during execution | C-2, C-5 |
| AC-04 | Accurate cost/token counts | C-2, C-5 |
| AC-05 | Model picker shows available models | C-4 |
| AC-06 | Ollama cognitive session completes task | C-3 |
| AC-07 | Stale sessions cleaned on restart | C-3, C-6 |
| AC-08 | Edit tool performs targeted changes | C-1 |
| AC-09 | v2 monitor detects impasse | C-2 |
| AC-10 | Genesis stops polling after failures | C-6 |

## Dependency DAG

```
C-1 (Edit tool)    C-4 (Model picker)    C-5 (Streaming)
      \
       → C-2 (Cognitive engine v2)
              \
               → C-3 (Pool wiring + Ollama)
                        \
                         → C-6 (Lifecycle + Genesis)
```

**Topological levels:**
- Level 0: C-1, C-4, C-5
- Level 1: C-2
- Level 2: C-3
- Level 3: C-6

C-4 and C-5 are at Level 0 but in the same domain (frontend). They touch **disjoint files** (SpawnSessionModal vs usePromptStream+ChatView). Allowing them in Wave 1 because there's zero file overlap.

## Risk Assessment

| Factor | Value | Assessment |
|--------|-------|------------|
| Critical path | 4 waves | **Medium** — sequential backend chain (C-1→C-2→C-3) |
| Largest wave | Wave 1 (3 commissions) | **Good** — max parallelism at start |
| Shared surfaces | 1 change (~2 lines) | **Low** |
| Complexity hotspot | C-2 (8 tasks, major rewrite) | **High** — cognitive-provider.ts rewrite is the riskiest commission |
| Ollama dependency | C-3 needs chobits online | **Medium** — external machine, validated reachable |

## Status Tracker

```
Total: 6 commissions, 5 waves (0-4)
Estimated tasks: 30
Completed: 0 / 6

Wave 0: __ surface prep
Wave 1: __ C-1  __ C-4  __ C-5
Wave 2: __ C-2
Wave 3: __ C-3
Wave 4: __ C-6
```
