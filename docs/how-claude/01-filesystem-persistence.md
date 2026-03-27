# 01 — Claude Code Filesystem Persistence

What Claude Code writes to disk, where, and when. All paths are relative to the
user home directory (`~`).

## Directory Structure

```
~/.claude/
  .credentials.json            Auth credentials
  settings.json                User settings (model, theme, permissions)
  mcp.json                     MCP server configuration
  history.jsonl                Global prompt history (all projects)
  backups/                     Unknown — likely config backups
  cache/                       Unknown — likely model or tool cache
  debug/                       Debug logs
  downloads/                   Downloaded files
  file-history/                Per-session file change tracking
    <session-id>/              Directory per session
  ide/                         IDE integration state
  image-cache/                 Cached image renders
  paste-cache/                 Clipboard paste cache
  plans/                       Unknown — may relate to plan mode
  plugins/                     Plugin state
  projects/                    Per-project session data (main data store)
    <derived-project-name>/    One directory per project workdir
      <session-id>.jsonl       Full conversation transcript per session
      <session-id>/            Per-session directory (optional)
        subagents/             Sub-agent transcripts
          agent-<id>.jsonl     Sub-agent conversation
          agent-<id>.meta.json Sub-agent metadata
        tool-results/          Large tool output storage
      memory/                  Project-scoped persistent memory
  sessions/                    Running session PID tracking
    <pid>.json                 One file per running Claude process
```

## Project Directory Name Derivation

The project directory name is deterministically derived from the absolute workdir path:

```
C:\Users\atfm0\Repositories\method-1  →  C--Users-atfm0-Repositories-method-1
/home/user/project                     →  home-user-project
```

Algorithm: resolve to absolute path, replace `:` with `-`, replace `\` and `/` with `-`,
strip leading `-`.

This is the same algorithm used by `deriveProjectDirName()` in `transcript-reader.ts`.

## PID Files (`~/.claude/sessions/<pid>.json`)

One JSON file per running Claude Code process. Written on process start. Example:

```json
{
  "pid": 2900,
  "sessionId": "9e58da12-4451-4ca1-adca-299feacb3377",
  "cwd": "C:\Users\atfm0\Repositories\method-1",
  "startedAt": 1774547748601,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `pid` | number | OS process ID |
| `sessionId` | string (UUID) | Matches the JSONL filename in `projects/` |
| `cwd` | string | Working directory the session was started in |
| `startedAt` | number | Unix timestamp (ms) |
| `kind` | string | `"interactive"` for CLI sessions. Bridge `--print` sessions may differ or not create PID files. |
| `entrypoint` | string | `"cli"` for terminal sessions |

**Lifecycle:** Created on process start. Should be deleted on clean exit. May be
orphaned if the process crashes or is killed with SIGKILL. PID recycling means a
stale PID file could match an unrelated process — always verify process name, not
just PID existence.

**Bridge observation:** Bridge sessions spawned via `claude --print` may NOT create
PID files (the `kind` field suggests these track `interactive` sessions only). This
needs verification per Claude CLI version. The `NativeSessionDiscovery` port should
handle the case where no PID file exists for a known session.

## Session JSONL (`~/.claude/projects/<project>/<session-id>.jsonl`)

The primary data store. One JSONL file per conversation session, named by session UUID.
Written in real-time — each API turn appends lines immediately. Survives process crashes.

The session ID used as the filename matches:
- The `--session-id <id>` flag passed to `claude --print` on first invocation
- The `--resume <id>` flag on subsequent invocations
- The `sessionId` field in PID files

See [02-jsonl-session-format.md](02-jsonl-session-format.md) for the line-by-line format.

## Sub-Agent Data (`~/.claude/projects/<project>/<session-id>/subagents/`)

When a session spawns sub-agents (via the `Agent` tool), each sub-agent gets:

- `agent-<id>.jsonl` — full conversation transcript (same format as session JSONL)
- `agent-<id>.meta.json` — metadata about the sub-agent

Example meta.json:
```json
{
  "agentType": "Explore",
  "description": "Find transcript storage location"
}
```

## Global History (`~/.claude/history.jsonl`)

One line per user prompt across all projects and sessions:

```json
{
  "display": "get familiar with the code :)",
  "pastedContents": {},
  "timestamp": 1768677212133,
  "project": "C:\Users\atfm0\Repositories\constellation-engine",
  "sessionId": "beaddf04-53fa-41e3-8070-cc5fa19d901b"
}
```

This is a global audit trail of every prompt sent, regardless of project. It does NOT
contain responses — only the prompt display text and metadata.

## File History (`~/.claude/file-history/<session-id>/`)

Tracks file modifications per session. Structure and purpose not fully documented.
Likely used for undo/revert functionality within Claude Code.

---

**Observed on:** Claude Code CLI v2.1.84 (2026-03-27)
