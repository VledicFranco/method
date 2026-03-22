# PRD 010 — PTY Activity Auto-Detection

**Status:** Implemented
**Date:** 2026-03-15
**Previous:** Draft (2026-03-15)
**Scope:** Real-time PTY output parsing, auto-channel emission, auto-retrospective generation
**Depends on:** PRD 008 (channel infrastructure), PRD 005 (bridge + dashboard)
**Evidence:** OBS-01 (agents don't use channel tools), OBS-02 (agents stall without visibility), OBS-09 (PTY output contains parseable signals), OBS-11 (agents deliver well but silently), PR-03 enforcement gap (0/12 retros placed correctly)
**Council:** SESSION-022 (D-035 scope), SESSION-023 (D-038 confirmation, 7 design gaps resolved)
**Implementation:** PTY watcher with 7 pattern matchers, auto-channel emission, auto-retro generator, persistent sessions. Bridge config: 10 max sessions, 1s settle delay. OBS-01/09/11 resolved. OBS-12 mitigated (settle delay reduced).
**PRD 021 impact:** **Complemented.** MethodTS's typed `StateTrace<S>` produces richer retrospectives than PTY pattern matching (computed from typed data, not inferred from terminal output). Auto-retro from trace replaces PTY-based retro for MethodTS-driven sessions. Observation patterns remain useful for non-MethodTS sessions and for `pty_watcher` triggers (PRD 018).

---

## 1. Purpose and Problem Statement

### The observability gap is structural, not behavioral

PRD 008 built a complete channel infrastructure: `progress` and `events` channels per session, push notifications, cursor-based reads, dashboard integration. The tools work. The agents don't use them.

OBS-01 documents this across every bridge commission to date: despite having `bridge_progress` and `bridge_event` in their `allowedTools`, agents never spontaneously call them. Prompt-level instructions ("call bridge_progress when you complete a step") are ignored. The root cause is motivational — channel tools don't affect task completion, so the agent optimizes them away.

This is not fixable at the prompt layer. Commission skill Section 10 added explicit tool call instructions with payload examples. Agents still skip them. The pattern is consistent: agents do excellent work silently (OBS-11), producing high-quality deliverables with zero visibility into the process.

A second gap compounds the first: PR-03 requires retrospectives at `.method/retros/retro-YYYY-MM-DD-NNN.yaml`. Evidence shows 0/12 retrospectives placed correctly — all ended up in `tmp/` or were never produced. Commissioned agents don't generate retros because it's cleanup work after the "real" task is done.

### The solution: make the bridge self-observing

The bridge already has all the raw data. The PTY session accumulates a full transcript buffer (`pty-session.ts`, line 83-96). Subscribers can tap into live output via `onOutput` (line 99-101). OBS-09 confirms that Claude Code's PTY output contains structured, parseable markers for tool calls, file operations, git commands, and test results.

PRD 010 adds a pattern-matching layer on the PTY output stream. When patterns match, the bridge auto-emits channel messages to the session's `progress` and `events` channels via `appendMessage`. When a session terminates, the bridge synthesizes a retrospective from accumulated observations.

No agent changes. No MCP tool changes. No prompt modifications. The bridge becomes the observer.

---

## 2. Components

### Component 1: PTY Watcher

A per-session subscriber that attaches to `onOutput` when the session spawns. Receives raw PTY data chunks, feeds them through the pattern matching pipeline.

```typescript
interface PtyWatcher {
  readonly sessionId: string;
  /** Accumulated activity observations for auto-retro. */
  readonly observations: ActivityObservation[];
  /** Unsubscribe from PTY output. Called on session kill/death. */
  detach(): void;
}

interface ActivityObservation {
  timestamp: string;        // ISO 8601
  category: ObservationCategory;
  detail: Record<string, unknown>;
}

type ObservationCategory =
  | 'tool_call'
  | 'git_commit'
  | 'test_result'
  | 'build_result'
  | 'file_operation'
  | 'error'
  | 'idle';
```

**Data pipeline:**

Raw PTY chunks arrive via `onOutput`. The watcher processes them through a pipeline:

1. **ANSI strip** — `stripAnsi(chunk)` on the watcher's own copy. Never mutate the shared data that other subscribers (transcript buffer, live output) receive.
2. **Line buffering** — The watcher maintains a `lineBuffer: string` for handling patterns that span chunks. On each chunk: prepend `lineBuffer` to the cleaned chunk, split by `\n`, process all complete lines through pattern matchers, keep the last incomplete segment as the new `lineBuffer`. Cap `lineBuffer` at 4KB — any line longer than that isn't a parseable signal; truncate from the left.
3. **Pattern matching** — Run all registered matchers against each complete line.
4. **Dedup + rate limit** — Filter matches through the emitter's sliding window.
5. **Channel emission** — Write to session channels via `appendMessage`.
6. **Observation recording** — Store in the watcher's `observations[]` for auto-retro.

**Lifecycle:**
1. Pool `create()` spawns a PTY session, then creates a `PtyWatcher` attached via `session.onOutput()` AND `session.onExit()`
2. Watcher buffers incoming data through the pipeline above
3. On match, watcher calls `appendMessage` on the session's channels and records an `ActivityObservation`
4. On session death (via `onExit` callback), watcher collects final observations and triggers the auto-retro generator synchronously before detaching

**Death detection (GAP 1 fix):** The `PtySession` interface must expose an `onExit(cb: (exitCode: number) => void): void` method, mirroring the existing `onOutput` pattern. In `pty-session.ts`, this wraps `ptyProcess.onExit()`. The watcher subscribes to both `onOutput` (for live pattern matching) and `onExit` (for retro generation). This keeps death detection self-contained in the watcher — the pool does not need modification for auto-retro triggering.

```typescript
// Addition to PtySession interface
onExit(cb: (exitCode: number) => void): void;
```

### Component 2: Pattern Matchers

A set of pure functions, each detecting one activity pattern. Matchers receive a text chunk (plus line buffer context) and return zero or more matches.

```typescript
interface PatternMatch {
  category: ObservationCategory;
  channelTarget: 'progress' | 'events';
  messageType: string;
  content: Record<string, unknown>;
}

type PatternMatcher = (chunk: string, lineBuffer: string) => PatternMatch[];
```

Matchers are registered in an array. The watcher runs all matchers against each chunk. This is intentionally simple — no parser combinator, no state machine. Each matcher is an independent regex scan.

### Component 3: Auto-Channel Emitter

The glue between matchers and channels. When a matcher returns hits, the emitter:

1. Deduplicates against recent emissions (sliding window of 10 seconds, keyed by `category + messageType`)
2. Rate-limits per category (max 1 emission per category per 5 seconds to prevent flooding)
3. Calls `appendMessage(channel, 'pty-watcher', messageType, content)`

The sender field is always `'pty-watcher'` — distinguishable from agent-emitted messages (sender = session ID) and bridge-emitted messages (sender = `'bridge'`). This enables consumers to distinguish auto-detected activity from explicit agent reports.

### Component 4: Auto-Retro Generator

When a session transitions to `dead` status (via kill, exit, or stale auto-kill), the generator synthesizes a retrospective from the watcher's accumulated observations.

The retro is minimal — it captures what was observed, not what was intended. It does not replace a human-written or agent-written retrospective, but it guarantees that PR-03 is never violated: every commissioned session produces at least a basic retro.

---

## 3. Pattern Catalog

Each pattern targets a specific, stable signal in Claude Code's PTY output. Per D-035 (SESSION-022), only stable signals are in scope. Prose interpretation and "understanding what the agent is thinking" are explicitly excluded.

### Pattern 1: Tool Call Detection

**What it detects:** Claude Code tool invocations. Claude Code prints tool names when executing them (e.g., `Read`, `Edit`, `Bash`, `Write`, `Glob`, `Grep`). MCP tool calls appear with their full qualified name (e.g., `mcp__method__step_advance`).

**Heuristic:** Tool invocations in Claude Code's TUI appear with specific formatting — they are preceded by the `●` marker or appear within box-drawing TUI chrome. Bare word matching (e.g., `\bRead\b`) produces false positives from agent prose ("Let me Read the file"). The matcher must use contextual patterns that distinguish tool invocations from prose mentions.

```typescript
// Built-in tools — require TUI context (● marker, box-drawing prefix, or line-start tool name followed by colon/parenthesis)
// The ● marker precedes tool-use blocks in Claude Code's TUI output
const TOOL_INVOCATION_RE = /(?:●\s*|[│├└─]\s*)(Read|Edit|Write|Bash|Glob|Grep|TodoWrite|WebFetch|WebSearch|Agent|LSP)\b/;

// Alternatively: tool name at line start followed by tool-specific patterns
// e.g., "Read  /path/to/file" or "Bash  command here"
const TOOL_LINE_START_RE = /^\s*(Read|Edit|Write|Bash|Glob|Grep)\s{2,}/;

// MCP tools — the mcp__ prefix is unambiguous, no context needed
const MCP_TOOL_RE = /\b(mcp__\w+__\w+)\b/;
```

**Matching strategy:** Try `TOOL_INVOCATION_RE` first (highest confidence — TUI chrome context). Fall back to `TOOL_LINE_START_RE` (medium confidence — structural formatting). Never match bare `\bRead\b` without context. MCP tool names (`mcp__*`) are inherently unambiguous and match without context.

**Channel emission:**

| Channel | Type | Content |
|---------|------|---------|
| `progress` | `tool_call` | `{ tool: string, is_mcp: boolean }` |

**Special case:** When the tool is `mcp__method__step_advance` or `mcp__method__step_current`, also emit to `progress` with type `methodology_activity` and content `{ tool: string }`. This provides methodology-level visibility without duplicating PRD 008's auto-progress from `step_advance`.

### Pattern 2: Git Commit Detection

**What it detects:** Successful `git commit` output, which prints the branch, short hash, and commit message.

**Heuristic:**

```typescript
// Matches: [branch abc1234] commit message here
const GIT_COMMIT_RE = /\[(\S+)\s+([a-f0-9]{7,})\]\s+(.+)/;
```

**Channel emission:**

| Channel | Type | Content |
|---------|------|---------|
| `progress` | `git_commit` | `{ branch: string, hash: string, message: string }` |

### Pattern 3: Test Result Detection

**What it detects:** npm test / Node.js test runner output with pass/fail counts.

**Heuristics:**

```typescript
// Node.js test runner: "# tests 14" / "# pass 14" / "# fail 0"
const NODE_TEST_SUMMARY_RE = /# tests (\d+)/;
const NODE_TEST_PASS_RE = /# pass (\d+)/;
const NODE_TEST_FAIL_RE = /# fail (\d+)/;

// Jest/Vitest: "Tests: 2 failed, 14 passed, 16 total"
const JEST_SUMMARY_RE = /Tests:\s+(?:(\d+) failed,\s+)?(\d+) passed,\s+(\d+) total/;

// Generic: "X passing" / "X failing" (Mocha-style)
const MOCHA_PASS_RE = /(\d+) passing/;
const MOCHA_FAIL_RE = /(\d+) failing/;
```

**Channel emission:**

| Channel | Type | Content |
|---------|------|---------|
| `progress` | `test_result` | `{ total: number, passed: number, failed: number, runner: string }` |
| `events` | `test_failure` | (only if `failed > 0`) `{ failed: number, total: number }` |

### Pattern 4: File Operation Detection

**What it detects:** Read/Write/Edit tool calls with file paths. Provides an activity heartbeat — "the agent is actively working on files."

**Heuristic:**

```typescript
// File path in tool call context — look for paths with extensions
const FILE_PATH_RE = /(?:Read|Write|Edit|file_path)[:\s]+["']?([^\s"']+\.\w{1,10})["']?/;
```

**Channel emission:**

| Channel | Type | Content |
|---------|------|---------|
| `progress` | `file_activity` | `{ path: string, operation: 'read' \| 'write' \| 'edit' }` |

**Rate limiting:** File operations are high-frequency. Rate-limit to 1 emission per 10 seconds (override the default 5-second category rate limit). The observation is still recorded for the auto-retro — only channel emission is throttled.

### Pattern 5: Build Result Detection

**What it detects:** TypeScript compiler (`tsc`) and `npm run build` output.

**Heuristics:**

```typescript
// tsc success: no output or "Successfully compiled"
// tsc failure: "error TS2345: ..."
const TSC_ERROR_RE = /error TS\d+:/;

// npm build: "npm run build" exit code in Bash tool output
const BUILD_EXIT_RE = /exit code:\s*(\d+)/;
```

**Channel emission:**

| Channel | Type | Content |
|---------|------|---------|
| `progress` | `build_result` | `{ success: boolean, error_count?: number }` |
| `events` | `build_failure` | (only if failed) `{ error_count: number }` |

### Pattern 6: Agent Idle Detection

**What it detects:** The Claude Code prompt character (`❯`) appearing after a period of working activity. Indicates the agent has returned to an idle/ready state.

**Heuristic:**

```typescript
// The ❯ character appears when Claude Code is waiting for input
const PROMPT_CHAR_RE = /❯/;
```

**Logic:** The watcher tracks whether the session has been in a `working` state (any tool call or activity detected in the last 30 seconds). When the prompt character appears after a working period, emit an `idle` status. Do NOT emit on every prompt character — only on the transition from active to idle.

**Channel emission:**

| Channel | Type | Content |
|---------|------|---------|
| `progress` | `idle` | `{ idle_after_seconds: number, last_activity: string }` |

### Pattern 7: Error Detection

**What it detects:** Error patterns in PTY output — stack traces, unhandled exceptions, process crashes.

**Heuristics:**

```typescript
// Stack trace: "at Object.<anonymous> (/path/to/file.js:10:5)"
const STACK_TRACE_RE = /^\s+at\s+.+\(.+:\d+:\d+\)/m;

// Node.js uncaught: "Error: ..." or "TypeError: ..."
const NODE_ERROR_RE = /^(Error|TypeError|RangeError|SyntaxError|ReferenceError):\s+(.+)/m;

// Process exit with non-zero code
const EXIT_CODE_RE = /exit code:\s*([1-9]\d*)/;
```

**Channel emission:**

| Channel | Type | Content |
|---------|------|---------|
| `events` | `error_detected` | `{ error_type: string, message: string, has_stack_trace: boolean }` |

**Deduplication:** Errors often produce multi-line output. Deduplicate within a 15-second window to avoid emitting one event per stack frame.

---

## 4. Pattern Summary Table

| # | Pattern | Regex/Heuristic | Detects | Channel | Type | Rate Limit |
|---|---------|----------------|---------|---------|------|------------|
| 1 | Tool call | `BUILTIN_TOOL_RE`, `MCP_TOOL_RE` | Tool invocations | progress | `tool_call` | 5s per tool |
| 2 | Git commit | `GIT_COMMIT_RE` | Commit hash + message | progress | `git_commit` | none |
| 3 | Test result | `NODE_TEST_*_RE`, `JEST_SUMMARY_RE` | Pass/fail counts | progress + events | `test_result` / `test_failure` | none |
| 4 | File op | `FILE_PATH_RE` | File read/write/edit | progress | `file_activity` | 10s |
| 5 | Build result | `TSC_ERROR_RE`, `BUILD_EXIT_RE` | Build success/failure | progress + events | `build_result` / `build_failure` | none |
| 6 | Idle | `PROMPT_CHAR_RE` | Agent returned to prompt | progress | `idle` | transition only |
| 7 | Error | `STACK_TRACE_RE`, `NODE_ERROR_RE` | Exceptions, crashes | events | `error_detected` | 15s |

---

## 5. Auto-Retro Specification

### Data Collected

The watcher accumulates `ActivityObservation` entries throughout the session's lifetime. When the session terminates, the auto-retro generator produces a retrospective from these observations.

**Collected per session:**

| Data | Source | Purpose |
|------|--------|---------|
| Tool call counts | Pattern 1 | Activity profile — what tools were used and how often |
| Files modified | Pattern 4 | Scope — what files the agent touched |
| Git commits | Pattern 2 | Deliverables — what was committed with what messages |
| Test results | Pattern 3 | Quality — did tests pass or fail |
| Build results | Pattern 5 | Build health — did the build succeed |
| Errors encountered | Pattern 7 | Issues — what went wrong |
| Session duration | Spawn → death timestamps | Effort — how long the agent worked |
| Idle periods | Pattern 6 | Efficiency — how much time was spent idle vs active |

### Retro Format

```yaml
# Auto-generated retrospective — PTY activity detection (PRD 010)
# This is a machine-observed retro, not an agent-authored one.

retro:
  session_id: "abc-123-def"
  nickname: "impl-1"
  generated_by: pty-watcher
  generated_at: "2026-03-15T14:30:00Z"

  timing:
    spawned_at: "2026-03-15T14:00:00Z"
    terminated_at: "2026-03-15T14:30:00Z"
    duration_minutes: 30
    active_minutes: 25          # time with tool activity
    idle_minutes: 5             # time at prompt with no activity
    termination_reason: "completed" | "killed" | "stale" | "exited"

  activity_summary:
    tool_calls: 47              # total tool invocations observed
    tool_breakdown:             # top tools by frequency
      - tool: Read
        count: 18
      - tool: Edit
        count: 12
      - tool: Bash
        count: 9
      - tool: mcp__method__step_advance
        count: 4
      - tool: Grep
        count: 4
    files_touched:
      - packages/bridge/src/pool.ts
      - packages/bridge/src/channels.ts
      - packages/bridge/tests/channels.test.ts
    git_commits:
      - hash: abc1234
        message: "feat(bridge): add channel infrastructure"
      - hash: def5678
        message: "test(bridge): add channel unit tests"

  quality:
    tests_run: true
    last_test_result:
      total: 138
      passed: 138
      failed: 0
    build_succeeded: true
    errors_observed: 0

  # Placeholder — auto-retro doesn't know what was hardest or what could improve.
  # A human or agent can fill these in later.
  hardest_decision: "(auto-generated — not available)"
  observations:
    - "Machine-observed activity profile. See activity_summary for details."
  card_feedback:
    essence_feedback: "(auto-generated — not available)"
```

### File Placement

Retros are saved to `.method/retros/retro-YYYY-MM-DD-NNN.yaml` per PR-03. The generator:

1. Resolves the retro directory from the session's **original workdir** (see below)
2. Reads the `.method/retros/` directory to find the next sequence number for today
3. Writes the file with the computed filename
4. Emits a channel event `{ type: 'retro_generated', content: { path: '...' } }` to the session's events channel

If the `.method/retros/` directory does not exist (e.g., agent running outside this project), the retro is skipped. Auto-retros are best-effort — failure to write is non-fatal.

**Workdir resolution for worktree sessions (GAP 5 fix):** For sessions using worktree isolation (PRD 006 C2), pool.ts stores `effectiveWorkdir` (the worktree path) in `sessionWorkdirs`. But the auto-retro must write to the **original project's** `.method/retros/`, not the worktree's — the worktree may be discarded after the session.

The pool must store the original workdir separately. Add a `sessionOriginalWorkdirs` map in pool.ts:

```typescript
const sessionOriginalWorkdirs = new Map<string, string>();

// In create():
sessionOriginalWorkdirs.set(sessionId, workdir);  // always the original, pre-worktree path
sessionWorkdirs.set(sessionId, effectiveWorkdir);  // may be worktree path
```

The auto-retro generator reads from `sessionOriginalWorkdirs` (via a new pool method `getOriginalWorkdir(sessionId)`) to resolve `.method/retros/`. Clean up in `removeDead()` alongside other maps.

### Relationship to Agent-Authored Retros

Auto-retros do not replace agent-authored retrospectives. They are a floor, not a ceiling. If an agent also produces a retro (via methodology step or explicit instruction), both artifacts coexist. The auto-retro's `generated_by: pty-watcher` field distinguishes it from agent-authored retros.

---

## 6. Configuration

All configuration via environment variables, consistent with existing bridge configuration pattern.

| Variable | Default | Description |
|----------|---------|-------------|
| `PTY_WATCHER_ENABLED` | `true` | Master switch. Set to `false` to disable all PTY activity detection. |
| `PTY_WATCHER_PATTERNS` | `all` | Comma-separated list of enabled patterns: `tool_call,git_commit,test_result,file_operation,build_result,idle,error`. Use `all` for all patterns. |
| `PTY_WATCHER_RATE_LIMIT_MS` | `5000` | Default rate limit per category in milliseconds. |
| `PTY_WATCHER_DEDUP_WINDOW_MS` | `10000` | Deduplication window in milliseconds. |
| `PTY_WATCHER_AUTO_RETRO` | `true` | Enable auto-retrospective generation on session termination. |
| `PTY_WATCHER_LOG_MATCHES` | `false` | Log pattern matches to stdout (debug mode). |

### Per-Session Override

The `bridge_spawn` API accepts an optional `pty_watcher` field in metadata:

```json
{
  "workdir": "/path/to/project",
  "initialPrompt": "...",
  "metadata": {
    "pty_watcher": {
      "enabled": false,
      "patterns": ["git_commit", "test_result"],
      "auto_retro": true
    }
  }
}
```

Per-session overrides take precedence over environment variables. This allows an orchestrator to disable the watcher for specific sessions (e.g., research tasks where tool call noise is unhelpful) or enable only specific patterns.

---

## 7. Implementation Order

### Phase 1: Core Watcher + Tool Call Detection

**Deliverables:**
- `PtyWatcher` class in `packages/bridge/src/pty-watcher.ts`
- Pattern matcher interface and registry
- Pattern 1 (tool call detection) implemented
- Watcher attached in pool `create()`, detached on kill/death
- Auto-channel emission with dedup and rate limiting
- Unit tests with synthetic PTY output fixtures
- Configuration via `PTY_WATCHER_ENABLED`

**Why first:** Tool call detection is the highest-signal pattern. It provides the activity heartbeat that answers "is the agent doing anything?" — the core question OBS-01 makes unanswerable today.

### Phase 2: Git + Test + Build Patterns

**Deliverables:**
- Patterns 2, 3, 5 (git commit, test result, build result) implemented
- These are outcome patterns — they tell you what the agent produced, not just that it's active
- Integration tests with realistic PTY transcript samples

**Why second:** These patterns provide the data auto-retros need. They answer "what did the agent accomplish?"

### Phase 3: File Op + Idle + Error Patterns

**Deliverables:**
- Patterns 4, 6, 7 (file operation, idle detection, error detection) implemented
- Idle detection requires state tracking (active → idle transition)
- Error detection requires dedup tuning to handle multi-line stack traces

**Why third:** These are refinement patterns. File ops add granularity to the heartbeat. Idle detection enables "is it stuck?" monitoring. Errors surface problems that agents don't report.

### Phase 4: Auto-Retro Generator

**Deliverables:**
- Retro generator in `packages/bridge/src/auto-retro.ts`
- Triggered on session death/kill
- Writes to `.method/retros/retro-YYYY-MM-DD-NNN.yaml`
- Retro event emitted to session's events channel
- Integration test: spawn session with synthetic activity → kill → verify retro file

**Why last:** The generator depends on all patterns being implemented to produce a complete activity profile. It also depends on the observation accumulation being stable and well-tested.

---

## 8. Success Criteria

1. **Heartbeat visibility:** A spawned agent that has never called `bridge_progress` shows tool call activity in `bridge_read_progress` within 10 seconds of the tool call occurring
2. **Git commit visibility:** When an agent commits, `bridge_read_progress` shows the commit hash and message without the agent calling `bridge_event`
3. **Test result visibility:** When an agent runs tests, `bridge_read_progress` shows pass/fail counts
4. **Error visibility:** When an agent encounters an error, `bridge_read_events` shows an `error_detected` event
5. **Dashboard integration:** The dashboard's progress timeline shows auto-detected activity alongside agent-reported activity. Auto-detected entries (sender = `pty-watcher`) are visually distinguished from agent-reported entries (sender = session ID) — e.g., dimmed color or a `[auto]` prefix. The dashboard collapses duplicate events (same type within 10s window, different sender) into a single entry.
6. **Auto-retro generation:** When a commissioned session terminates, a retrospective file exists at `.method/retros/` with correct format and observed data. For worktree sessions, the retro is written to the original project's `.method/retros/`, not the worktree's.
7. **No false positive storms:** Rate limiting prevents more than 12 channel emissions per minute per session under normal operation
8. **Opt-out works:** Setting `PTY_WATCHER_ENABLED=false` produces zero auto-detected channel messages
9. **No agent changes:** All 8 criteria above are met without modifying any MCP tool, agent prompt, or commission skill

---

## 9. Out of Scope

- **Prose interpretation:** Parsing what the agent is "thinking" or "planning" from its natural language output. Only structured signals (tool names, git output, test output) are in scope.
- **Agent behavior modification:** The watcher observes; it does not influence. No auto-prompting, no auto-correction, no intervention.
- **PTY output format stabilization:** Claude Code's output format may change between versions. Pattern matchers are best-effort and expected to degrade gracefully (false negatives are acceptable; false positives are not).
- **Persistent observation storage:** Observations live in memory with the session. No database, no file-based persistence beyond the auto-retro.
- **Cross-session correlation:** Detecting that two sessions are working on related files or conflicting changes. This is a future orchestration concern.
- **Token/cost tracking:** Token usage observation from PTY output. The bridge has separate subscription usage meters (`CLAUDE_OAUTH_TOKEN`). PTY-based token estimation is too unreliable.
- **Custom pattern plugins:** User-defined pattern matchers. The pattern registry is hardcoded for now. Extension point can be added later if needed.

---

## 10. Relationship to Existing PRDs

| PRD | Relationship |
|-----|-------------|
| **PRD 005** (Bridge + Dashboard) | PRD 010 adds a new subscriber to the PTY session's `onOutput` hook, which PRD 005/007 introduced. Dashboard shows auto-detected activity in the existing progress timeline. |
| **PRD 006** (Recursive Orchestration) | Auto-retros solve the PR-03 gap for commissioned agents. The watcher attaches to every session in the pool, including recursively spawned sub-agents. |
| **PRD 008** (Agent Visibility) | PRD 010 is the infrastructure answer to PRD 008's adoption problem. PRD 008 built the channels; PRD 010 fills them without agent cooperation. The two are complementary — agent-reported events (PRD 008) and auto-detected events (PRD 010) coexist in the same channels, distinguished by sender. PRD 008's Component 4 (heartbeat, deferred) is superseded by PRD 010's Pattern 1 (tool call detection provides the heartbeat). |

### Architectural Note

PRD 010 is entirely within the `@method/bridge` package. It does not touch `@method/core` (no transport deps — DR-03) or `@method/mcp` (no tool surface changes — DR-04). The pattern matchers are pure functions. The watcher is a bridge-internal subscriber. The auto-retro generator writes files to disk. All within bridge's existing boundaries.

---

## 11. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **PTY output format changes** between Claude Code versions break pattern matchers | HIGH | MEDIUM | Matchers degrade to false negatives (miss detections), not false positives. No channel noise on format change. Patterns are independently testable — update one matcher when format changes. |
| **ANSI escape sequences** corrupt regex matches | HIGH | LOW | Watcher strips ANSI from its own copy of each chunk using `strip-ansi` (same library as parser.ts). Stripping happens in the watcher's processing path — never mutates shared subscriber data. |
| **Tool call false positives** from prose mentions ("Let me Read the file") | HIGH | MEDIUM | Pattern 1 uses contextual matching: require TUI chrome context (`●` marker, box-drawing prefix) or structural formatting (tool name at line start with 2+ spaces). Bare `\bRead\b` without context is never matched. MCP tool names (`mcp__*`) are inherently unambiguous. See Pattern 1 specification. |
| **Duplicate events** when agent also reports via channels | MEDIUM | LOW | Different sender field (`pty-watcher` vs session ID). Consumers can filter by sender. Dashboard can collapse duplicates within a time window. |
| **Performance overhead** from running 7 regexes on every PTY chunk | LOW | LOW | PTY chunks are small (typically < 1KB). Regex matching is sub-millisecond. Rate limiting prevents emission storms. |
| **Line buffer memory** from incomplete lines in PTY chunks | LOW | LOW | Line buffer capped at 4KB. Any incomplete line longer than 4KB is truncated from the left — not a parseable signal. Buffer flushed on `\n`. |
| **removeDead() races with auto-retro** | LOW | LOW | Auto-retro fires synchronously in the `onExit` callback, before the session enters the dead cleanup window. Observations are stored in the watcher (not channels), so channel cleanup in `removeDead()` doesn't affect retro data. |
| **Auto-retro file conflicts** when multiple sessions terminate simultaneously | LOW | LOW | Sequence number in filename (`NNN`) is computed at write time with directory scan. Race window is negligible for PTY sessions terminating seconds apart. |
| **Worktree session retro placement** | MEDIUM | MEDIUM | Auto-retro resolves `.method/retros/` from the session's original workdir (pre-worktree), not the effective worktree path. Pool stores original workdir in a separate `sessionOriginalWorkdirs` map. Worktree may be discarded — retro must land in the real project. |
