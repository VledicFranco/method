---
title: Sessions
scope: domain
package: bridge
contents:
  - auto-retro.ts
  - auto-retro.test.ts
  - channels.ts
  - channels.test.ts
  - config.ts
  - diagnostics.ts
  - diagnostics.test.ts
  - index.ts
  - persistence-routes.ts
  - pool.ts
  - pool.test.ts
  - print-session.ts
  - print-session.test.ts
  - routes.ts
  - scope-hook.ts
  - scope-hook.test.ts
  - session-persistence.ts
  - session-persistence.test.ts
  - spawn-queue.ts
  - spawn-queue.test.ts
  - transcript-reader.ts
  - transcript-reader.test.ts
  - transcript-route.ts
  - transcript-route.test.ts
  - types.ts
  - worktree-stale.test.ts
---

# Sessions

The core domain of the bridge server. Sessions manages the lifecycle of Claude Code agent processes — spawning, pooling, prompting, killing, and observing print-mode sessions. All sessions run via `claude --print` (PTY mode was removed in PRD 028). The domain also owns channel infrastructure for agent-to-agent visibility, scope enforcement via git hooks, transcript reading from JSONL session logs, and automatic retrospective generation on session termination.

## Domain Invariants

These invariants must hold across all session operations. Violations are bugs.

### I-1: Transcript fidelity

After a page refresh, the user sees the exact same prompt/response pairs they saw before refreshing. The transcript API returns collapsed `(user_prompt, final_assistant_response)` pairs — intermediate tool-use rounds (tool_use, tool_result) are internal and never surfaced to the consumer.

### I-2: Transcript identity

Each bridge session's transcript is resolved by matching the session ID to the JSONL filename (`{session_id}.jsonl`). The bridge session ID is passed to the Claude CLI as `--session-id`, which names the JSONL file. Time-proximity heuristics exist only as fallback for legacy sessions.

### I-3: Turn completeness

A completed prompt/response cycle shows the agent's final text response, never an intermediate tool-use step. If the agent used 15 tools before answering, the transcript shows only the question and the answer.

### I-4: Append-only transcript consistency

The JSONL transcript is append-only — turns are never modified or reordered. New turns appear at the end. `useTranscript` uses `staleTime: Infinity` because historical turns never change.

### I-5: Prompt metadata in-place

`pool.prompt()` reads `session.printMetadata` synchronously after `sendPrompt()` resolves — same tick, no separate getter, no race condition. The metadata travels with the response from backend to frontend without a second request.

### I-6: Event-driven list updates

Session list updates are signal-driven via BridgeEvents (`session.prompt.completed`, `session.spawned`, etc.) triggering `invalidateQueries`. The frontend never manually patches the session list — React Query owns the cache, events are just invalidation signals.

### I-7: Pool is the single owner

All session state flows through `SessionPool`. No route handler, event sink, or external consumer mutates session state directly. The pool enforces spawn limits, stale detection, budget constraints, and kill semantics.

### I-8: Restored sessions are inert

`pool.restoreSession()` hydrates internal Maps from a `SessionSnapshot` without spawning a process. The restored session is a minimal stub that lazy-upgrades to a real print session on first `sendPrompt()` (with `recovered: true` to trigger `--resume`). Restored sessions do not increment `totalSpawned`.

### I-9: Agent hoisted to session scope

`createAgent()` is called exactly once per `createPrintSession()` closure — at session scope, not inside `sendPrompt()`. This ensures `agent.state` accumulates cost, turns, and tokens across all invocations. The architecture gate `I-9` in `architecture.test.ts` enforces this structurally.

## Modules

| Module | Purpose |
|--------|---------|
| [pool.ts](pool.ts) | Session pool manager — spawn, prompt, kill, list, stale detection, batch operations |
| [print-session.ts](print-session.ts) | Print-mode session — delegates to Pacta `claudeCliProvider` for `claude --print` invocation |
| [routes.ts](routes.ts) | Fastify routes — CRUD for sessions, prompt endpoint, metadata enrichment, BridgeEvent emission |
| [channels.ts](channels.ts) | Ring-buffered message channels for structured agent-to-agent visibility (PRD 008) |
| [transcript-reader.ts](transcript-reader.ts) | Reads Claude Code JSONL logs, collapses tool-use rounds into prompt/response pairs |
| [transcript-route.ts](transcript-route.ts) | Fastify route serving collapsed JSON transcripts, matched by session ID |
| [diagnostics.ts](diagnostics.ts) | Per-session timing metrics — time to first output, tool call counts, stall detection |
| [spawn-queue.ts](spawn-queue.ts) | FIFO queue enforcing minimum gap between process launches (rate-limit protection) |
| [scope-hook.ts](scope-hook.ts) | Pre-commit hook generator enforcing `allowed_paths` in git worktrees (PRD 014) |
| [auto-retro.ts](auto-retro.ts) | Synthesizes minimal retrospective YAML from session observations on termination |
| [session-persistence.ts](session-persistence.ts) | Session state persistence across server restarts |
| [persistence-routes.ts](persistence-routes.ts) | Routes for session history and persistence queries |
| [config.ts](config.ts) | Session domain configuration (Zod schema) |
| [types.ts](types.ts) | Domain type definitions |
| [index.ts](index.ts) | Domain barrel export |
