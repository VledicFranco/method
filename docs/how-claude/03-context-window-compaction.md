# 03 — Context Window & Compaction

How Claude Code manages context limits, compacts conversations, and what state
survives compaction.

## Key Insight: JSONL is History, Not Context

The JSONL file is the **complete conversation history** — every message ever
exchanged, including thinking blocks. It is NOT the context window.

The context window is **reconstructed at runtime** by Claude Code when processing
each prompt. For `--resume` sessions, Claude reads the JSONL and builds the context
from it, subject to compaction rules.

There is no file that says "here is exactly what is in the context window right now."
But the context window state can be reconstructed from the JSONL.

## Compaction Mechanics

When the conversation approaches the context limit (~200K tokens for Opus/Sonnet),
Claude Code performs automatic compaction:

### 1. Compaction Trigger

A `compact_boundary` system event is written to the JSONL:

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 167300,
    "preCompactDiscoveredTools": [
      "mcp__github-personal__create_pull_request",
      "mcp__github-personal__merge_pull_request"
    ]
  }
}
```

| Field | Meaning |
|-------|---------|
| `trigger` | `"auto"` — compaction triggered by context limit approaching |
| `preTokens` | Token count before compaction (the "how full was the window") |
| `preCompactDiscoveredTools` | MCP tools that were dynamically discovered during the conversation and need to be preserved across compaction |

### 2. Summary Injection

Immediately after the `compact_boundary`, a new `user` message is injected containing
a structured summary of everything that was compacted. The summary follows a consistent
template:

```
This session is being continued from a previous conversation that ran out of context.
The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent:
   [What the user asked for, high-level goals]

2. Key Technical Concepts:
   [Domain concepts, types, patterns discussed]

3. Files and Code Sections:
   [Specific files read/modified with code snippets]

4. Errors and fixes:
   [What broke, root causes, how it was fixed]

5. Problem Solving:
   [Design decisions, architectural choices]

6. All user messages:
   [Chronological list of every user prompt]

7. Pending Tasks:
   [In-progress work, background agents]

8. Current Work:
   [What was happening at compaction time]

9. Optional Next Step:
   [What should happen next]
```

This summary replaces all messages before the boundary in the **runtime context
window**. The JSONL still retains everything (append-only), but Claude Code's
internal message array for the API call starts from the summary.

### 3. Conversation Continues

Messages after the `compact_boundary` are the "current" conversation. The runtime
context window is: `[system prompt] + [summary message] + [post-boundary messages]`.

## Reconstructing the Context Window

From the JSONL, you can determine what is in the context window:

1. **Find the last `compact_boundary`** event (scan from the end)
2. **The user message immediately after it** contains the summary of everything before
3. **All messages after the boundary** are in the current context window
4. **Pre-boundary messages** are in the JSONL but NOT in the active context

If no `compact_boundary` exists, the entire JSONL is in the context window
(the conversation has not been compacted yet).

## Token Budget Tracking

The `preTokens` field on `compact_boundary` events tracks context usage over time:

| Compaction # | preTokens | Notes |
|---|---|---|
| 1 | 167,300 | First compaction — conversation reached ~167K tokens |
| 2 | 167,927 | Second compaction — refilled to ~168K after first compaction |
| 3 | 172,647 | Third compaction — slightly higher (more tools discovered) |

The gap between compactions tells you how much useful work fits in one context window.
A session that compacts every 5 minutes is context-thrashing; one that compacts every
2 hours has good context efficiency.

## What Survives Compaction

| Survives | Does Not Survive |
|----------|-----------------|
| Summary of prior work (structured, ~2-5K tokens) | Exact tool call arguments and results |
| File paths and code snippets mentioned in summary | Full file contents that were read |
| User message text (listed in summary section 6) | Intermediate reasoning and thinking blocks |
| Current task state and pending work | Tool execution progress events |
| Key decisions and their rationale | Per-message usage/token counts |
| Error history (what broke, what was fixed) | Exact git diffs and commit SHAs |

## Implications for the Bridge

### Transcript Reader

The transcript reader reads the FULL JSONL — it does not respect compaction boundaries.
This is correct for transcript display (the user wants to see all historical turns).
But it means the transcript can be much larger than what the agent currently "remembers."

### Session Observability

A `compact_boundary` event with `preTokens` data could power a "context health"
indicator in the bridge UI:
- Show percentage of context used: `preTokens / maxContextTokens`
- Flag sessions that have compacted N times (potential context drift)
- Show "compacted N minutes ago" as a freshness indicator

### Recovery

On recovery, the bridge does not need to reconstruct the context window. Claude Code
handles that internally via `--resume`. The bridge only needs to restore its own
metadata (nickname, purpose, chain, budget). Claude handles conversation continuity.

### Sub-Agent Context

Sub-agent messages (`isSidechain: true`) are in the parent JSONL but are NOT part
of the parent context window. They run in separate context windows. The parent sees
only the final result returned by the sub-agent, not its internal conversation.

---

**Observed on:** Claude Code CLI v2.1.84 (2026-03-27)
**Context window sizes observed:** ~167K-173K tokens before compaction triggers
