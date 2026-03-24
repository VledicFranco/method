---
title: Sessions
scope: domain
package: bridge
contents:
  - adaptive-settle.ts
  - adaptive-settle.test.ts
  - auto-retro.ts
  - auto-retro.test.ts
  - channels.ts
  - channels.test.ts
  - diagnostics.ts
  - diagnostics.test.ts
  - live-output-route.ts
  - parser.ts
  - parser.test.ts
  - pattern-matchers.ts
  - pool.ts
  - pool.test.ts
  - print-session.ts
  - print-session.test.ts
  - pty-session.ts
  - pty-watcher.ts
  - pty-watcher.test.ts
  - scope-hook.ts
  - scope-hook.test.ts
  - scope-violation.test.ts
  - spawn-queue.ts
  - spawn-queue.test.ts
  - transcript-reader.ts
  - transcript-reader.test.ts
  - transcript-route.ts
  - worktree-stale.test.ts
---

# Sessions

The core domain of the bridge server. Sessions manages the lifecycle of Claude Code PTY processes — spawning, pooling, prompting, killing, and observing agent sessions. It encompasses the channel infrastructure for structured agent visibility, PTY output parsing and pattern detection, adaptive response timing, scope enforcement via git hooks, transcript reading from session logs, and automatic retrospective generation when sessions terminate.

| Module | Purpose |
|--------|---------|
| [pool.ts](pool.ts) | Session pool manager — spawn, prompt, kill, list, stale detection, and batch operations |
| [pty-session.ts](pty-session.ts) | Low-level PTY process wrapper using node-pty with prompt queue and adaptive settle |
| [print-session.ts](print-session.ts) | Non-PTY session mode that delegates to ClaudeCodeProvider for headless invocation |
| [channels.ts](channels.ts) | Ring-buffered message channels for structured agent-to-agent visibility (PRD 008) |
| [parser.ts](parser.ts) | Extracts agent responses from raw PTY output, stripping TUI chrome and ANSI escapes |
| [pattern-matchers.ts](pattern-matchers.ts) | Pure functions detecting structured signals in PTY output (tool calls, git commits, tests, errors) |
| [pty-watcher.ts](pty-watcher.ts) | Per-session subscriber that runs pattern matchers on PTY output and auto-emits observations to channels |
| [adaptive-settle.ts](adaptive-settle.ts) | Per-session adaptive delay algorithm that starts fast and backs off only on false-positive cutoffs |
| [diagnostics.ts](diagnostics.ts) | Per-session timing metrics — time to first output, tool call counts, settle overhead, stall detection |
| [spawn-queue.ts](spawn-queue.ts) | FIFO queue enforcing minimum gap between PTY process launches to prevent API rate-limit contention |
| [scope-hook.ts](scope-hook.ts) | Pre-commit hook generator enforcing allowed_paths scope constraints in git worktrees (PRD 014) |
| [auto-retro.ts](auto-retro.ts) | Synthesizes a minimal retrospective YAML from PTY watcher observations on session termination |
| [transcript-reader.ts](transcript-reader.ts) | Reads and parses Claude Code JSONL session logs into structured transcript turns |
| [transcript-route.ts](transcript-route.ts) | Fastify route serving parsed JSON transcripts for individual sessions |
| [live-output-route.ts](live-output-route.ts) | SSE endpoint streaming raw PTY output for browser-side xterm.js rendering |
