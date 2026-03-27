# 02 — JSONL Session Format

Line-by-line structure of the session transcript files at
`~/.claude/projects/<project>/<session-id>.jsonl`.

## Event Types

Each line is a JSON object with a `type` field. From a real session (our current
session has 2396 lines):

| Type | Count | Description |
|------|-------|-------------|
| `assistant` | ~983 | Model responses (text, thinking, tool_use) |
| `user` | ~640 | User messages (prompts, tool_result blocks) |
| `progress` | ~600 | Tool execution progress events |
| `file-history-snapshot` | ~66 | File modification snapshots |
| `queue-operation` | ~56 | Prompt queue management (enqueue/dequeue) |
| `system` | ~47 | System events (turn_duration, compact_boundary) |
| `last-prompt` | ~4 | Resume marker — last prompt text |

## Common Fields (all event types)

```json
{
  "type": "assistant",
  "timestamp": "2026-03-27T02:06:41.646Z",
  "uuid": "3d1e6ae5-1b00-49cb-951a-7eeb9dbdf711",
  "sessionId": "0025a02d-74a4-47ed-9cc6-21579f667f88",
  "version": "2.1.84",
  "gitBranch": "master",
  "slug": "eventual-churning-metcalfe",
  "userType": "external",
  "entrypoint": "cli",
  "cwd": "C:\Users\atfm0\Repositories\method-1",
  "parentUuid": "...",
  "isSidechain": false
}
```

| Field | Notes |
|-------|-------|
| `uuid` | Unique ID for this JSONL line |
| `parentUuid` | UUID of the preceding message (forms a linked list) |
| `isSidechain` | `true` for sub-agent messages (they share the same JSONL file) |
| `agentId` | Present when `isSidechain: true` — identifies which sub-agent |
| `slug` | Session slug (human-readable session name) |

## `user` Messages

User prompts and tool results.

**Simple prompt (first message in a session):**
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "What is the purpose of this project?"
  }
}
```

The `content` field is a plain string for user-typed prompts.

**Tool result (after an assistant tool_use):**
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_01M73...",
        "type": "tool_result",
        "content": "file contents here...",
        "is_error": false
      }
    ]
  }
}
```

Tool result `content` is an array of `tool_result` blocks. Each references the
`tool_use_id` from the preceding assistant message.

**Key distinction:** A "real user prompt" has `content` as a string. A tool result
message has `content` as an array of `tool_result` blocks. This is how
`transcript-reader.ts` distinguishes them when collapsing tool-use rounds
(see `isToolResult` flag in the parsing phase).

## `assistant` Messages

Model responses. The `content` field is always an array of typed blocks.

**Thinking block:**
```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "model": "claude-opus-4-6",
    "content": [
      {
        "type": "thinking",
        "thinking": "The user is asking about the purpose..."
      }
    ],
    "stop_reason": null,
    "usage": { ... }
  }
}
```

**Text response:**
```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "model": "claude-opus-4-6",
    "content": [
      {
        "type": "text",
        "text": "**pv-method** is a runtime that makes formal methodologies..."
      }
    ],
    "stop_reason": "end_turn",
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 12090,
      "cache_read_input_tokens": 11367,
      "output_tokens": 266,
      "service_tier": "standard"
    }
  }
}
```

**Tool use:**
```json
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01M73...",
        "name": "Read",
        "input": { "file_path": "/path/to/file.ts" }
      }
    ],
    "stop_reason": "tool_use"
  }
}
```

**Mixed content (text + tool_use in same message):**

An assistant message can contain multiple blocks — e.g., a text explanation followed
by a tool call, or thinking + text + tool_use. The `stop_reason` indicates what ended
the turn: `"end_turn"` (natural stop), `"tool_use"` (wants to call a tool), or `null`
(streaming/partial).

### Usage Block

Present on assistant messages with `stop_reason` set:

```json
{
  "input_tokens": 3,
  "cache_creation_input_tokens": 12090,
  "cache_read_input_tokens": 11367,
  "output_tokens": 266,
  "server_tool_use": {
    "web_search_requests": 0,
    "web_fetch_requests": 0
  },
  "service_tier": "standard",
  "cache_creation": {
    "ephemeral_5m_input_tokens": 12090,
    "ephemeral_1h_input_tokens": 0
  }
}
```

Notable: `cache_read_input_tokens` shows how many tokens were served from Claude's
prompt cache. High cache hit ratios indicate effective prompt caching.

## `system` Events

Two subtypes observed:

### `turn_duration`
```json
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 79394,
  "messageCount": 27
}
```

Emitted at the end of each agentic turn. `messageCount` is the number of API messages
in that turn (including intermediate tool calls). Useful for understanding how many
round-trips a single user prompt required.

### `compact_boundary`
```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "level": "info",
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

See [03-context-window-compaction.md](03-context-window-compaction.md) for details.

## `queue-operation` Events

Track the prompt queue (for `--print` mode sessions):

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "2026-03-27T04:56:26.642Z",
  "sessionId": "4ced8541-...",
  "content": "What is the purpose of this project?"
}
```

## `last-prompt` Events

Resume marker — written to record the last prompt for `--resume` functionality:

```json
{
  "type": "last-prompt",
  "lastPrompt": "What is the purpose of this project?",
  "sessionId": "4ced8541-..."
}
```

## `progress` Events

Tool execution progress updates. Structure varies by tool.

## `file-history-snapshot` Events

File modification tracking. Written periodically during sessions that edit files.

## Sub-Agent Messages

Sub-agent messages appear in the SAME JSONL file as the parent session, distinguished by:

- `isSidechain: true`
- `agentId: "agent-<hex-id>"`

This means a single JSONL file contains interleaved parent and sub-agent messages.
The `parentUuid` chain links them, and `agentId` groups sub-agent messages.

---

**Observed on:** Claude Code CLI v2.1.84 (2026-03-27)
