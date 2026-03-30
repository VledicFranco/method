---
title: "PRD 040: Cognitive Agent Maturity — Production-Grade Cognitive Sessions"
status: proposed
date: "2026-03-29"
tier: heavyweight
depends_on: [33, 35, 37]
enables: []
blocked_by: []
complexity: high
domains_affected: [bridge/sessions, pacta, pacta-provider-ollama, bridge/frontend]
---

# PRD 040: Cognitive Agent Maturity — Production-Grade Cognitive Sessions

**Status:** Proposed
**Author:** PO + Lysica
**Date:** 2026-03-29
**Packages:** `@method/bridge` (L4), `@method/pacta` (L3), `@method/pacta-provider-ollama` (L3)
**Depends on:** PRD 033 (Cognitive Session UX), PRD 035 (Monitoring & Control v2), PRD 037 (Affect & Curiosity)
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Problem Statement

Cognitive agent sessions (PRD 033) demonstrated that observable reasoning cycles work in the bridge UI. However, the current implementation is a **proof-of-concept** that cannot compete with standard `claude --print` sessions for real work. Specific deficiencies:

1. **Single-tool cycles.** The cognitive provider executes one tool per cycle. Standard agents run multi-turn tool loops — read a file, edit it, run tests, fix errors — in a single conversation turn. Cognitive agents must call "done" or hit cycle limit; they cannot chain tool calls within a cycle. This makes even basic tasks (read → edit → verify) take 3+ cycles instead of one fluid turn.

2. **No conversation persistence.** Each prompt starts with a fresh workspace. Standard agents maintain full conversation history — the agent remembers what it read, what files it changed, what errors it saw. Cognitive sessions lose everything between prompts. The second prompt has zero context from the first.

3. **No live streaming.** The `[Cycle N]` reasoning text is emitted as SSE events but doesn't render during streaming. Users see "Working..." then the final answer. Standard agents stream text word-by-word. For a system whose differentiator is *observable reasoning*, the reasoning is ironically invisible during execution.

4. **No cost tracking.** Cognitive sessions show `$0.00` for every prompt. The Anthropic API returns usage data per call, but the cognitive provider discards it. Users have no visibility into how many tokens or dollars a cognitive task consumed.

5. **Inline v1 monitor.** The cognitive provider hardcodes a v1-style monitor (fixed thresholds, stagnation counting) instead of using the v2 modules delivered in PRD 035 (MonitorV2 with prediction error, PriorityAttend, ReasonerActorV2 with impasse detection, EVC control). The v2 modules exist but aren't wired into the bridge.

6. **No model selection.** The spawn modal has an LLM Provider toggle (Anthropic / Ollama) but no model picker. Anthropic now offers `claude-opus-4-6` (best reasoning), `claude-sonnet-4-6` (balanced), and `claude-haiku-4-5` (fast/cheap). Ollama exposes whatever models are pulled locally. Users should choose.

7. **Ollama untested end-to-end.** The `@method/pacta-provider-ollama` package exists and the bridge pool wires it, but no production smoke test has verified that cognitive sessions work with Ollama. The provider defaults to `http://chobits:11434` (Tailscale GPU machine) but connection handling, timeouts, and error UX are unvalidated.

8. **Stale session ghosts.** Cognitive sessions are in-memory only. When the bridge restarts, old session IDs persist in the frontend cache but route to print sessions (which fail). There's no cleanup mechanism — users must manually delete ghost sessions.

9. **No Edit tool.** The bridge tool provider has Read, Write, Glob, Grep, Bash — but no Edit (targeted string replacement). Standard Claude Code agents use Edit heavily for surgical code changes. Write-whole-file is too destructive for most editing tasks.

10. **Genesis console spam.** The Genesis chat panel polls `/genesis/status` which returns 503 when genesis isn't running, flooding the browser console with errors. Not a cognitive agent issue per se, but degrades the overall session UX.

## Objective

Make cognitive agent sessions **production-grade** — capable of performing real software engineering tasks with the same practical capability as standard claude --print sessions, while retaining the observable reasoning advantages (cycle traces, workspace visualization, monitor interventions, affect signals).

Specifically:

1. **Multi-tool cycles** — ReasonerActorV2 executes tool chains within a single cycle
2. **Conversation memory** — workspace entries and context persist across prompts within a session
3. **Live streaming** — reasoning text streams word-by-word during execution
4. **Cost + token tracking** — accurate per-prompt cost and token counts from LLM API usage data
5. **v2 module wiring** — MonitorV2, PriorityAttend, ReasonerActorV2, PrecisionAdapter, EVC policy
6. **Model picker** — UI dropdown for selecting model (Opus/Sonnet/Haiku for Anthropic, pulled models for Ollama)
7. **Ollama production path** — validated end-to-end cognitive sessions with Ollama on Tailscale GPU
8. **Session lifecycle** — clean up stale cognitive sessions on bridge restart
9. **Edit tool** — targeted file editing in the bridge tool provider
10. **Genesis silence** — suppress polling when genesis isn't available

## Architecture & Design

### Multi-Tool Cycle Architecture

The current cognitive provider runs one LLM call → one tool execution per cycle. The upgrade wires in `createReasonerActorV2()` from PRD 035 which supports:

```
Cycle N:
  LLM call → parses <action> → executes tool → writes result to workspace
  → checks for impasse (tie, no-change, rejection, stall)
  → if tool returned actionable data, LLM can request another tool in same cycle
  → loop until "done" or max-tools-per-cycle reached
```

The key change: the reasoner-actor loop runs *within* a single cycle, not across cycles. The monitor evaluates once per cycle (after the tool loop completes), not after every individual tool call. This matches how standard agents work — a single "turn" can involve multiple tool uses.

**Max tools per cycle:** Configurable, default 5. Prevents runaway tool loops.

### Conversation Persistence

The workspace currently resets per prompt. The fix:

1. **Workspace survives across prompts** — entries persist in the session's workspace manager
2. **Conversation history** injected into the workspace as high-salience observer entries
3. **TTL-based eviction** handles stale entries (configured via workspaceConfig.defaultTtl)
4. **Explicit context budget** — workspace capacity scales with conversation length

The workspace manager already supports TTL and capacity limits. The change is to not recreate it per prompt — keep the same `WorkspaceManager` instance across the session's lifetime.

### Live Streaming Architecture

The cognitive provider currently emits `text` events with the full `[Cycle N]` reasoning block after the LLM call completes. For live streaming:

1. Use `ProviderAdapter.invoke()` with streaming enabled (the Anthropic provider supports `stream()`)
2. Emit `text` events token-by-token as the LLM generates
3. Emit `cycle-action` only after the full response is parsed
4. The frontend's `usePromptStream` already handles interleaved `text` and `cycle-*` events

**Constraint:** Ollama provider doesn't support streaming yet. Streaming is Anthropic-only initially. Ollama shows "Working..." then result (current behavior).

### Model Selection UI

Extend the spawn modal's LLM Provider section:

```
LLM Provider:
  [Anthropic ▼] [Ollama ▼]
   └─ Model: [claude-sonnet-4-6 ▼]    └─ Model: [qwen3-coder:30b ▼]
              claude-opus-4-6                    (auto-discovered from /api/tags)
              claude-haiku-4-5
```

For Anthropic: hardcoded model list (Opus, Sonnet, Haiku).
For Ollama: dynamic model list fetched from `GET /api/tags` at the configured base URL.

The selected model is passed through `cognitive_config.model` to the cognitive provider, which forwards it to the `ProviderAdapter`'s pact scope.

### Ollama Production Validation

End-to-end test flow:
1. Spawn cognitive session with `llm_provider: 'ollama'`
2. Bridge pool creates `ollamaProvider({ baseUrl: 'http://chobits:11434' })`
3. Cognitive provider runs cycle with Ollama LLM
4. Verify: cycle trace, tool execution, workspace updates, done event
5. Error handling: Ollama timeout, connection refused, model not found

The Ollama base URL should be configurable via:
- Spawn modal input (already exists)
- Environment variable `OLLAMA_BASE_URL` (fallback)
- Default: `http://chobits:11434`

### Edit Tool

Add an `Edit` tool to `createBridgeToolProvider`:

```typescript
{ name: 'Edit', description: 'Replace a specific string in a file. Input: { path: string, old_string: string, new_string: string }' }
```

Implementation: read file, verify `old_string` exists exactly once, replace, write. Return error if not found or ambiguous (multiple matches). Same path-traversal security as Read/Write.

### Session Lifecycle

On bridge startup:
1. Enumerate recovered sessions
2. For sessions with `mode: 'cognitive-agent'`: mark as `dead` immediately (cognitive sessions can't be recovered — they have no backing process)
3. Frontend auto-refreshes session list after reconnect (already happens via WebSocket)

### Genesis Silence

When genesis service isn't running:
1. First poll to `/genesis/status` returns 503
2. Frontend stops polling (exponential backoff with max 60s, or disable after 3 consecutive failures)
3. Genesis button shows "unavailable" state instead of "idle"

## Scope

### In-Scope

- Multi-tool execution loop within cognitive cycles (max 5 tools per cycle)
- Workspace persistence across prompts within a session
- Live text streaming for Anthropic provider during cognitive cycles
- Per-prompt cost and token tracking from LLM API usage data
- Wire v2 cognitive modules (MonitorV2, PriorityAttend, ReasonerActorV2, PrecisionAdapter, EVC)
- Model picker in spawn modal (Anthropic: Opus/Sonnet/Haiku; Ollama: dynamic from /api/tags)
- Ollama end-to-end smoke test and error handling
- Edit tool in bridge tool provider
- Stale cognitive session cleanup on bridge restart
- Genesis polling backoff

### Out-of-Scope

- Ollama streaming (future — requires provider changes)
- Cross-session memory (PRD 036 concern — dual-store CLS)
- Cognitive session recovery after bridge restart (sessions are ephemeral by design)
- Ollama tool use / function calling (Ollama models don't support tool_use natively)
- Bridge tool permission system (future concern)

### Non-Goals

- Replacing standard `claude --print` sessions — cognitive sessions are a parallel option
- Matching Claude Code CLI feature parity (hooks, MCP, permissions) — cognitive sessions are research infrastructure with a focused tool set
- Supporting arbitrary LLM providers beyond Anthropic and Ollama

## Implementation Phases

### Phase 1: Core Engine Upgrade

Upgrade the cognitive provider from inline v1 logic to v2 modules with multi-tool cycles.

Files:
- `packages/bridge/src/domains/sessions/cognitive-provider.ts` — major rewrite: replace inline cycle loop with `createCognitiveAgent()` using `enrichedPreset`, add multi-tool-per-cycle support, persist workspace across prompts, track cumulative cost/tokens
- `packages/bridge/src/domains/sessions/bridge-tools.ts` — add Edit tool
- `packages/bridge/src/domains/sessions/pool.ts` — pass model selection through to provider factory, add cost tracking to session metadata

Tests:
- `packages/bridge/src/domains/sessions/__tests__/cognitive-provider.test.ts` — 10 scenarios: multi-tool cycle, workspace persistence, cost tracking, Edit tool, impasse detection, v2 monitor integration, cycle limit, error recovery, Ollama fallback, model selection

Checkpoint: cognitive session runs multi-tool cycles with v2 modules. `npm run build && npm test` passes.

### Phase 2: Live Streaming + Cost

Wire streaming LLM output and accurate cost reporting.

Files:
- `packages/bridge/src/domains/sessions/cognitive-provider.ts` — use `adapter.invoke()` with streaming callback, accumulate usage across cycles, emit cost in done metadata
- `packages/bridge/frontend/src/domains/sessions/usePromptStream.ts` — ensure text events render incrementally during cognitive cycles (verify existing logic handles interleaved text + cycle events)
- `packages/bridge/frontend/src/domains/sessions/ChatView.tsx` — render streaming text within cognitive turn blocks

Tests:
- Streaming text appears during cycle execution (manual + integration test)
- Done event includes accumulated `cost_usd`, `input_tokens`, `output_tokens`
- Metadata chips show real values post-completion

Checkpoint: reasoning text streams live. Cost shows real values.

### Phase 3: Model Picker + Ollama Validation

UI for model selection and Ollama production smoke test.

Files:
- `packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx` — add model dropdown: Anthropic (hardcoded list), Ollama (fetched from base URL /api/tags)
- `packages/bridge/frontend/src/domains/sessions/types.ts` — add `model` field to SpawnRequest
- `packages/bridge/src/domains/sessions/routes.ts` — pass model through to pool.create
- `packages/bridge/src/domains/sessions/pool.ts` — forward model to provider factory

Tests:
- Spawn modal shows model dropdown for each provider
- Ollama model list auto-populated from /api/tags
- Cognitive session with Ollama completes a file-reading task
- Ollama connection error shows friendly message (not raw error)

Checkpoint: can spawn cognitive sessions with Opus, Sonnet, Haiku, or qwen3-coder:30b.

### Phase 4: Session Lifecycle + UX Polish

Clean up stale sessions and suppress Genesis noise.

Files:
- `packages/bridge/src/domains/sessions/pool.ts` — on startup recovery, mark cognitive sessions as dead
- `packages/bridge/frontend/src/domains/sessions/Sessions.tsx` — filter dead sessions from sidebar (or show with "expired" badge)
- `packages/bridge/frontend/src/App.tsx` or Genesis panel component — add exponential backoff to genesis polling, stop after 3 consecutive 503s
- `packages/bridge/frontend/src/domains/sessions/SpawnSessionModal.tsx` — clear prompt input after successful spawn

Tests:
- After bridge restart, old cognitive sessions show as dead (not active)
- Genesis panel stops polling after 3 failures
- Prompt input clears after sending

Checkpoint: no more ghost sessions. Genesis console clean. Input UX smooth.

## Acceptance Criteria

### AC-01: Multi-tool cycle executes Read → Edit → verify in a single cycle

**Given** a cognitive session with the Edit tool available
**When** the user prompts "Change the version in package.json to 9.9.9"
**Then** the cognitive agent reads package.json, edits the version field, and reads it again to verify — all within 1-2 cycles (not 5+)
**Automatable:** yes (API test)

### AC-02: Workspace persists across prompts

**Given** a cognitive session where prompt 1 was "Read package.json"
**When** the user sends prompt 2 "What was the project name?"
**Then** the agent answers from workspace context without re-reading the file
**Automatable:** yes (API test — check cycle count and tool usage)

### AC-03: Reasoning text streams live during execution

**Given** a cognitive session with Anthropic provider
**When** the agent processes a multi-cycle task
**Then** reasoning text appears word-by-word in the chat view during execution (not after completion)
**Automatable:** manual (visual verification via Playwright screenshot comparison)

### AC-04: Cost and token counts are accurate

**Given** a cognitive session that completes a 3-cycle task
**When** the done event arrives
**Then** metadata shows non-zero `cost_usd`, `input_tokens`, and `output_tokens` matching the sum of all LLM calls
**Automatable:** yes (API test — verify metadata fields > 0)

### AC-05: Model picker shows available models

**Given** the spawn modal with Anthropic selected
**When** the user opens the model dropdown
**Then** options include claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
**And given** Ollama selected with chobits reachable
**When** the user opens the model dropdown
**Then** options are dynamically populated from Ollama's /api/tags (e.g. qwen3-coder:30b)
**Automatable:** yes (Playwright test)

### AC-06: Ollama cognitive session completes a task

**Given** a cognitive session with `llm_provider: 'ollama'` and `model: 'qwen3-coder:30b'`
**When** the user prompts "List the files in the current directory using Glob"
**Then** the agent executes the Glob tool and returns results within cycle limit
**Automatable:** yes (API test, requires chobits online)

### AC-07: Stale cognitive sessions cleaned up on restart

**Given** a cognitive session created before a bridge restart
**When** the bridge restarts and the frontend reconnects
**Then** the old cognitive session shows as dead/expired, not as active with a 🧠 badge
**Automatable:** yes (API test — spawn, restart bridge, check session status)

### AC-08: Edit tool performs targeted file changes

**Given** a cognitive session with a file containing "hello world"
**When** the agent executes `Edit { path, old_string: "hello", new_string: "goodbye" }`
**Then** the file contains "goodbye world" and the tool returns success
**Automatable:** yes (unit test)

### AC-09: v2 monitor detects impasse and adjusts strategy

**Given** a cognitive session using MonitorV2 + ReasonerActorV2
**When** the agent repeats the same action twice (no-change impasse)
**Then** ReasonerActorV2 generates an alternative-listing subgoal and the monitor lowers the intervention threshold (Gratton effect)
**Automatable:** yes (unit test with mock provider)

### AC-10: Genesis panel stops polling after failures

**Given** the bridge running without genesis service
**When** the sessions page loads
**Then** the Genesis button shows "unavailable" and console has at most 3 genesis-related errors (not hundreds)
**Automatable:** yes (Playwright — count console errors)

## Success Metrics

| Metric | Target | Method | Baseline |
|--------|--------|--------|----------|
| Tools per cycle (multi-tool tasks) | 2-5 avg | Test battery: 10 tasks requiring read+edit+verify | v1: 1 tool/cycle |
| Task completion rate | >80% within cycle limit | 20-task test battery (file ops, search, edit) | v1: ~50% (many hit cycle limit) |
| Cycle efficiency | 2x fewer cycles per task | Compare v1 vs v2 on identical tasks | v1: baseline |
| Cost visibility | 100% of prompts show cost > $0 | Check metadata on Anthropic sessions | v1: 0% |
| Streaming latency | <500ms to first token | Measure time from prompt send to first text event | v1: full-cycle latency |
| Ollama task completion | >60% within cycle limit | 10-task battery on qwen3-coder:30b | N/A (untested) |
| Ghost sessions after restart | 0 active ghost sessions | Restart bridge, count active cognitive sessions | v1: all survive as ghosts |

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Multi-tool loop runs away (infinite tool calls) | High | Max 5 tools per cycle, configurable. Monitor intervention fires if tool count exceeds threshold. |
| Workspace grows unbounded across prompts | Medium | TTL-based eviction (existing). Configurable capacity. Oldest entries evicted first. |
| Ollama models produce unparseable XML actions | High | ReasonerActorV2 impasse detection handles parse errors. Fallback: treat entire response as reasoning, no tool call. Specific XML format instructions in system prompt. |
| Streaming adds complexity to cognitive cycle ordering | Medium | Text events tagged with cycle number. Frontend already handles interleaved events. |
| Cost tracking accuracy depends on Anthropic API response | Low | Usage data is in every API response. Accumulate per cycle. |
| chobits (Ollama GPU) offline during cognitive session | Medium | Ollama provider has configurable timeout (default 60s). Error surfaces as styled error block in chat. Session remains alive for retry. |
| Edit tool produces incorrect changes (wrong match) | Medium | Require exact unique match. Return error on 0 or 2+ matches. Same security as existing Read/Write tools. |

## Dependencies & Cross-Domain Impact

### Depends On

- **PRD 033 (Cognitive Session UX):** The bridge infrastructure — spawn endpoint, SSE streaming, CycleTrace, CognitivePanel — is implemented and stable.
- **PRD 035 (Monitoring & Control v2):** MonitorV2, ReasonerActorV2, PrecisionAdapter, EVC policy, enrichedPreset are implemented and tested (63 tests passing).
- **PRD 037 (Affect & Curiosity):** Curiosity module and affectivePreset available for optional composition.

### Enables

- Cognitive sessions become viable for real software engineering tasks
- Ollama as a zero-cost development/testing LLM for cognitive experiments
- Research experiments comparing v1 vs v2 cognitive modules on identical tasks via the bridge UI

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `docs/guides/cognitive-sessions.md` | Create | User guide for cognitive sessions — spawning, model selection, Ollama setup, tool capabilities, workspace behavior |
| `docs/arch/cognitive-provider.md` | Create | Architecture doc for the cognitive provider — multi-tool cycle, v2 module wiring, streaming, cost tracking |
| `docs/guides/30-bridge-deployment.md` | Update | Add Ollama configuration (OLLAMA_BASE_URL, chobits setup, firewall/Tailscale) |

## Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | Should cognitive sessions support conversation export (transcript download)? Standard sessions have this. | PO | Phase 4 |
| OQ-2 | Should the model picker allow custom model IDs (typed input) or only show discovered models? | PO | Phase 3 |
| OQ-3 | What's the right max-tools-per-cycle default? 5 matches standard agent behavior but may need tuning per model (Ollama models are slower). | Implementation | Phase 1 |
| OQ-4 | Should workspace persistence be opt-in (per session config) or always-on? Always-on is simpler but uses more memory for long sessions. | PO | Phase 1 |
