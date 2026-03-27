# How Claude Code Works — Internal Reference

Reverse-engineered documentation of Claude Code's internal filesystem persistence,
session management, and context window mechanics. Based on empirical observation of
`~/.claude/` directory structure and JSONL session logs.

**Purpose:** The bridge (`@method/bridge`) spawns and manages Claude Code sessions.
Understanding Claude's native persistence is essential for building correct recovery,
observability, and transcript features. This directory documents what we have learned
through experimentation — none of it is part of an official API.

**Stability warning:** Everything documented here is based on observed behavior of
Claude Code CLI. These are undocumented internals that may change between versions.
The bridge isolates itself from these details through port abstractions
(`NativeSessionDiscovery`, `TranscriptReader`) so that format changes require only
adapter updates, not architectural changes.

## Documents

| # | Document | Summary |
|---|----------|---------|
| 01 | [Filesystem Persistence](01-filesystem-persistence.md) | What Claude Code writes to disk: session JSONL, PID files, project directories, subagents, history |
| 02 | [JSONL Session Format](02-jsonl-session-format.md) | Line-by-line structure of `<session-id>.jsonl`: event types, message roles, content blocks, metadata |
| 03 | [Context Window & Compaction](03-context-window-compaction.md) | How Claude manages context limits: compaction boundaries, summary injection, token tracking |

## How to use this

- **Building recovery features** — start with 01 (what files exist) then 02 (what data is in them)
- **Building transcript features** — 02 covers the JSONL format that `transcript-reader.ts` parses
- **Understanding context health** — 03 explains compaction mechanics for session observability
- **Adding a new port adapter** — check 01 for the file layout, write defensive parsers

## Contributing

When you discover new Claude Code internals through experimentation:
1. Add findings to the appropriate numbered document
2. If a new concern area is needed, create the next numbered document
3. Mark any field or behavior that changed between Claude versions
4. Always note the Claude Code version where the behavior was observed
