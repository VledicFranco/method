# PRD 012 — Session Reliability at Scale

**Status:** Partially implemented
**Date:** 2026-03-15
**Previous:** Draft (2026-03-15)
**Scope:** Adaptive settle delay, PTY parser replacement, concurrency ceiling testing, diagnostic instrumentation
**Depends on:** PRD 005 (bridge), PRD 010 (PTY watcher)
**Evidence:** OBS-03 (empty PTY responses), OBS-12 (settle delay compounding), OBS-17 (40% completion at 5 agents), OBS-18 (edit-vs-create reliability gap)
**Origin:** RFC #1 (council triage — 4-1 vote, highest impact/effort ratio)
**Implementation:** Phase 0 (staggered batch spawn), Phase 1 (diagnostic instrumentation), and Phase 2 (adaptive settle delay) implemented. Phase 3 (concurrency ceiling testing) and Phase 4 (print-mode sessions) remain unimplemented.

---

## 1. Purpose and Problem Statement

### The bridge is unreliable above 3 concurrent agents

The bridge's core value proposition is orchestrating multiple agent sessions in parallel. Stress testing at 5 concurrent agents revealed a 40% completion rate (OBS-17): only 2 of 5 agents finished their tasks. The 3 failures shared a pattern — agents editing existing files stalled mid-task, while agents creating new content completed (OBS-18).

Three independent mechanisms compound into this unreliability:

**Settle delay compounding (OBS-12).** The bridge detects prompt response completion by waiting for PTY silence — currently 1s of inactivity. Every tool call adds 1s of dead time. An agent making 20 tool calls accumulates 20s of idle overhead. For tool-heavy agents (file reads, greps, edits), wall-clock time inflates 2-3x. This isn't just slow — it increases the window for contention and stall conditions.

**PTY parser fragility (OBS-03).** `bridge_prompt` consistently returns empty or partial responses. The parser in `packages/bridge/src/parser.ts` relies on markers (`●`, `❯`) that don't always appear in Claude Code's PTY output. ANSI escapes, terminal width, and response content all affect whether markers are present. The result: the primary communication channel between the bridge and spawned agents is unreliable.

**Unknown concurrency ceiling.** The 40% completion rate at 5 agents could be resource contention (API rate limits, CPU/memory), permission prompt blocking, or task complexity. Without diagnostic data, we can't distinguish these causes. The reliable concurrency ceiling is unknown — it might be 3, might be 7, and may differ by workload type.

### What this PRD delivers

PRD 012 makes the bridge reliably orchestrate concurrent agents by:
1. Reducing idle overhead via adaptive settle delay
2. Replacing the fragile PTY parser with structured output
3. Establishing the empirical concurrency ceiling via systematic testing
4. Adding diagnostic instrumentation to detect and diagnose stalls in production

---

## 2. Components

### Component 1: Adaptive Settle Delay

Replace the fixed 1s `SETTLE_DELAY_MS` with an adaptive algorithm that starts fast and backs off only when needed.

**Current behavior:** After each PTY data chunk, the bridge waits `SETTLE_DELAY_MS` (1000ms) of silence before declaring the response complete. Every tool call pays this cost.

**New behavior:** The settle delay adapts per-session based on observed output patterns:

```typescript
interface AdaptiveSettleConfig {
  /** Starting delay — aggressive default. */
  initialDelayMs: number;       // 300ms
  /** Maximum delay — cap to prevent runaway backoff. */
  maxDelayMs: number;           // 2000ms
  /** Backoff multiplier when a false-positive cutoff is detected. */
  backoffFactor: number;        // 1.5
  /** Reset delay to initial when a tool-output marker is detected. */
  resetOnToolMarker: boolean;   // true
  /** Minimum delay floor — never go below this. */
  floorDelayMs: number;         // 200ms
}
```

**Algorithm:**

1. Start each session at `initialDelayMs` (300ms)
2. After each response completion, check for false-positive cutoff:
   - If the next PTY data arrives within 100ms of the settle timer firing, the response was cut short → multiply delay by `backoffFactor`
3. When a tool-output marker is detected in the PTY stream (via PTY watcher Pattern 1), reset to `initialDelayMs` — tool calls produce predictable output patterns, so shorter delays are safe
4. Cap at `maxDelayMs` to prevent runaway backoff
5. Track `false_positive_count` per session for diagnostics

**Expected impact:** 50-70% reduction in idle wait time for tool-heavy agents. A 20-tool-call sequence drops from 20s overhead (fixed 1s) to ~6s (300ms base with occasional backoff).

**Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `ADAPTIVE_SETTLE_ENABLED` | `true` | Enable adaptive settle delay |
| `ADAPTIVE_SETTLE_INITIAL_MS` | `300` | Starting delay |
| `ADAPTIVE_SETTLE_MAX_MS` | `2000` | Maximum delay cap |
| `ADAPTIVE_SETTLE_BACKOFF` | `1.5` | Backoff multiplier |

**Backward compatibility:** When `ADAPTIVE_SETTLE_ENABLED=false`, falls back to fixed `SETTLE_DELAY_MS` (current behavior). The `settle_delay_ms` per-prompt override in `bridge_prompt` continues to work — it sets a fixed delay for that specific prompt, bypassing the adaptive algorithm.

### Component 2: PTY Parser Replacement

Replace the regex-based PTY parser with Claude Code's `--output-format stream-json` structured output.

**Current parser (`packages/bridge/src/parser.ts`):** Scans raw PTY output for `●` markers and `❯` prompt characters. Extracts the response text between markers. Fails when: markers are absent, ANSI escapes corrupt the text, terminal width causes line-wrapping that breaks patterns, or Claude Code version changes output format.

**Replacement strategy:** Claude Code supports `--output-format stream-json`, which emits newline-delimited JSON objects to stdout. Each object has a `type` field indicating the message kind (assistant text, tool call, tool result, system message, etc.).

```typescript
interface StreamJsonMessage {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'result';
  // Fields vary by type — assistant has content, tool_use has name+input, etc.
  [key: string]: unknown;
}
```

**Migration path:**

Phase A — **Probe:** Spawn a test session with `--output-format stream-json` and validate that the JSON stream is parseable from the PTY buffer. Confirm that tool calls, assistant text, and completion signals are all present. This is the blocking experiment.

Phase B — **Dual-mode parser:** Add a `JsonStreamParser` alongside the existing regex parser. On session spawn, detect whether the PTY output starts with JSON (first line starts with `{`). If yes, use `JsonStreamParser`. If no, fall back to the regex parser. Both parsers implement the same interface:

```typescript
interface ResponseParser {
  /** Feed a chunk of PTY output. */
  feed(chunk: string): void;
  /** Returns the parsed response when complete, null if still accumulating. */
  getResponse(): string | null;
  /** Reset for next prompt cycle. */
  reset(): void;
}
```

Phase C — **Deprecate regex parser:** Once `JsonStreamParser` is validated in production across multiple sessions, remove the regex parser and make `--output-format stream-json` the default spawn flag.

**PTY watcher integration:** If the PTY output is structured JSON, the PTY watcher (PRD 010) can parse tool calls from the JSON `type: 'tool_use'` messages instead of regex matching on raw text. This eliminates the fragility risk noted in PRD 010 §11 (ANSI patterns breaking across versions). The watcher should detect parser mode and use JSON-based detection when available.

**Risk: `--output-format stream-json` may not be available or may behave differently in PTY mode vs pipe mode.** Claude Code may require stdout to be a pipe (not a TTY) for structured output. If so, the PTY session would need to be spawned differently — potentially using `stdio: 'pipe'` instead of a PTY for the stdout channel while keeping stdin as a PTY. This is the key unknown that Phase A must resolve.

### Component 3: Concurrency Ceiling Testing

Systematic stress tests at increasing agent counts to establish the reliable concurrency ceiling.

**Test matrix:**

| Agents | Task mix | Metric targets |
|--------|----------|----------------|
| 3 | 2 create + 1 edit | Baseline — expect >90% completion |
| 5 | 3 create + 2 edit | Current stress test level — target >80% |
| 7 | 4 create + 3 edit | Target >60% completion |
| 10 | 5 create + 5 edit | Ceiling probe — expect degradation |

**Task design:**

- **Create tasks:** Write a new markdown file with specified content (~200 lines). Single tool call (Write). Minimal tool chain.
- **Edit tasks:** Read an existing file, make specific changes (add a section, update a value), commit. Multi-step tool chain (Read → Edit → Bash).
- All tasks include `bridge_event "completed"` instruction to measure completion reliably.
- All tasks use worktree isolation to eliminate git conflicts.

**Metrics collected per run:**

```typescript
interface StressTestMetrics {
  agent_count: number;
  completed_count: number;
  completion_rate: number;           // completed / total
  time_to_first_output_ms: number[]; // per agent
  time_to_completion_ms: number[];   // per completed agent
  stall_count: number;               // agents that went idle without completing
  false_positive_settles: number;    // adaptive settle backoffs triggered
  peak_memory_mb: number;            // bridge process RSS
  peak_cpu_percent: number;          // bridge process CPU
}
```

**Test runner:** A script at `packages/bridge/scripts/stress-test.ts` that:
1. Starts the bridge (or connects to running instance)
2. Spawns N agents with the specified task mix
3. Waits for all agents to complete or timeout (5 min per agent)
4. Collects metrics from bridge `/health`, session channels, and system stats
5. Outputs a results table and writes to `docs/stress-test-results-YYYYMMDD.md`

**Acceptance criteria:**
- 3 agents: ≥90% completion rate
- 5 agents: ≥80% completion rate (up from current 40%)
- Document the ceiling where completion drops below 60%
- All results reproducible (run 3 times, variance <15%)

### Component 4: Diagnostic Instrumentation

Per-session timing metrics and stall detection to answer "why did this agent fail?" after the fact.

**New metrics tracked per session:**

```typescript
interface SessionDiagnostics {
  /** Time from spawn to first PTY output (ms). */
  time_to_first_output_ms: number | null;
  /** Time from spawn to first tool call detection (ms). */
  time_to_first_tool_ms: number | null;
  /** Total tool calls observed (from PTY watcher). */
  tool_call_count: number;
  /** Total settle delay overhead (sum of all settle waits, ms). */
  total_settle_overhead_ms: number;
  /** Number of false-positive settle cutoffs detected. */
  false_positive_settles: number;
  /** Current adaptive settle delay (ms). */
  current_settle_delay_ms: number;
  /** Number of times the session went idle (back to prompt). */
  idle_transitions: number;
  /** Longest continuous idle period (ms). */
  longest_idle_ms: number;
  /** Whether the session ever received a permission prompt. */
  permission_prompt_detected: boolean;
  /** Stall classification (null if not stalled). */
  stall_reason: 'resource_contention' | 'permission_blocked' | 'task_complexity' | 'unknown' | null;
}
```

**Stall classification heuristic:**

When a session transitions to idle without completing:

| Condition | Classification |
|-----------|---------------|
| `time_to_first_tool_ms === null` (no tool calls ever) | `permission_blocked` — likely hit a permission prompt on first tool |
| `tool_call_count > 0` AND `idle_transitions > 3` | `task_complexity` — agent started but got stuck in a read-think-stall loop |
| `time_to_first_output_ms > 10000` AND other agents also slow | `resource_contention` — API or system resource pressure |
| None of the above | `unknown` |

**Exposure:**

1. **`GET /sessions/:id/status` response** — add a `diagnostics` field with the metrics above. Available for any session, active or dead (retained until session cleanup).

2. **Dashboard integration** — diagnostics panel per session showing key metrics:
   ```
   Session abc-123 [impl-1] — diagnostics
     First output: 1.2s | First tool: 3.4s | Tools: 47
     Settle overhead: 14.1s (47 waits, 2 backoffs)
     Idle transitions: 3 | Longest idle: 45s
     Stall: none
   ```

3. **Stress test output** — the stress test runner (C3) consumes diagnostics to produce per-agent breakdowns.

**Permission prompt detection:**

Claude Code prints a recognizable pattern when it hits a tool permission prompt (e.g., "Allow X? (y/n)"). Add a PTY watcher pattern for this:

```typescript
// Permission prompt: "Allow" followed by tool name and y/n prompt
const PERMISSION_PROMPT_RE = /\bAllow\b.*\?\s*\([Yy](?:es)?\/[Nn](?:o)?\)/;
```

When detected, set `permission_prompt_detected = true` on the session diagnostics. This is critical for distinguishing "agent is stuck" from "agent is waiting for human approval" — the most common false-stall scenario.

### Component 5: Staggered Spawn

Spawn agents with a configurable delay between each to prevent API rate limit contention.

**Evidence (2026-03-15):** 0/5 agents completed when spawned simultaneously. 3/3 completed when staggered by 5s. The API rate limit or auth handshake creates a thundering herd when multiple Claude Code processes initialize at the same instant.

**New bridge behavior:**

```typescript
// Option A: per-spawn delay
bridge_spawn({ ..., spawn_delay_ms: 3000 })
// Bridge waits spawn_delay_ms before actually spawning the PTY process

// Option B: batch endpoint
POST /sessions/batch
{
  sessions: [
    { workdir, initial_prompt, ... },
    { workdir, initial_prompt, ... },
  ],
  stagger_ms: 3000  // delay between each spawn
}
// Bridge spawns each session stagger_ms apart, returns all session IDs
```

**Recommended defaults:**
- `stagger_ms`: 3000 (3s between spawns — enough for API handshake, fast enough for practical use)
- Individual `spawn_delay_ms`: 0 (no delay for single spawns)

**Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `BATCH_STAGGER_MS` | `3000` | Default stagger between batch spawns |

**MCP tool update:** Add `bridge_spawn_batch` tool that accepts an array of session configs and a `stagger_ms` parameter.

---

## 3. Implementation Order

### Phase 0: Staggered Spawn (C5) — IMPLEMENTED

**Deliverables:**
- [x] `spawn_delay_ms` field on `POST /sessions` — bridge waits before spawning PTY
- [x] `POST /sessions/batch` endpoint — accepts array of session configs + `stagger_ms`
- [x] `bridge_spawn_batch` MCP tool
- [x] Tests: batch spawn with stagger, verify all sessions initialize sequentially

**Implementation:** `POST /sessions/batch` in `index.ts`, `bridge_spawn_batch` MCP tool in `mcp/src/index.ts`. Default stagger: 3000ms via `BATCH_STAGGER_MS`.

### Phase 1: Diagnostic Instrumentation (C4) — IMPLEMENTED

**Deliverables:**
- [x] `SessionDiagnostics` interface and tracking in `packages/bridge/src/diagnostics.ts`
- [x] Metrics collection from PTY watcher observations (tool count, idle transitions)
- [x] Stall classification heuristic
- [x] Permission prompt detection pattern added to PTY watcher (`pattern-matchers.ts`)
- [x] `GET /sessions/:id/status` extended with `diagnostics` field
- [x] Dashboard diagnostics panel
- [ ] Unit tests for stall classification logic

**Implementation:** `DiagnosticsTracker` class in `diagnostics.ts` with all 10 metrics fields. Permission prompt pattern via `matchPermissionPrompt()` in `pattern-matchers.ts`. Stall classification heuristic with 4 categories.

### Phase 2: Adaptive Settle Delay (C1) — IMPLEMENTED

**Deliverables:**
- [x] `AdaptiveSettleDelay` class in `packages/bridge/src/adaptive-settle.ts`
- [x] Integration with `pty-session.ts` response completion detection
- [x] False-positive detection logic (next-chunk-within-100ms heuristic)
- [x] Tool-marker reset integration with PTY watcher
- [x] Configuration via env vars
- [x] Backward compatibility: `ADAPTIVE_SETTLE_ENABLED=false` preserves current behavior
- [ ] Unit tests with synthetic timing scenarios
- [ ] Integration test: spawn agent, verify response parsing still works with adaptive delay

**Implementation:** `AdaptiveSettleDelay` class with configurable initial (300ms), max (2000ms), floor (200ms) delays. Backoff on false-positive cutoff, reset on tool markers.

### Phase 3: Concurrency Ceiling Testing (C3)

**Deliverables:**
- `packages/bridge/scripts/stress-test.ts` — automated stress test runner
- Test matrix execution at 3, 5, 7, 10 agents
- Results documented at `docs/stress-test-results-YYYYMMDD.md`
- Concurrency ceiling established with evidence
- Recommendations for `MAX_SESSIONS` default based on findings

**Why third:** Requires both diagnostics (to understand failures) and adaptive settle (to reduce overhead). Running the matrix without these would produce the same uninformative results as OBS-17.

### Phase 4: Print-Mode Sessions (C2) — REVISED after EXP-012-P4

**Experiment result (2026-03-15):** `--output-format stream-json` does NOT work in interactive PTY mode — it requires `--print`. However, `--print` with `--resume <session_id>` maintains full conversation context across calls. This enables a fundamentally better architecture:

**Replace PTY-based sessions with `--print --resume` sessions for prompted work.**

```
OLD (PTY mode):
  spawn PTY → raw terminal → regex parse → empty string 50% of the time

NEW (print mode):
  --print -p "prompt" --output-format json --resume <session_id>
  → clean JSON → result field → always works
```

**Key findings from experiment:**
- `--print --output-format json` returns `{ result: "answer" }` — clean, structured, never empty
- `--resume <session_id>` continues an existing conversation — full multi-turn support
- `--output-format stream-json --verbose` gives real-time streaming with tool calls
- No settle delay needed — `--print` exits when done, deterministic completion
- No PTY parsing needed — stdout is structured JSON

**Architecture: dual-mode sessions**

The bridge gains a `mode` field on sessions:

```typescript
type SessionMode = 'pty' | 'print';
```

- **`mode: "pty"`** (existing) — persistent PTY process, TUI rendering, live output via xterm.js. Used for: interactive admin sessions, live monitoring, phone portal chat.
- **`mode: "print"`** (new) — each prompt spawns `claude --print --resume <id>`. Used for: commissions, automated tasks, anything that needs reliable structured output.

**Deliverables:**
- `PrintSession` class alongside existing `PtySession` — same interface, different backend
- `mode: "print" | "pty"` field on `POST /sessions` and `bridge_spawn`
- `PrintSession.sendPrompt()` runs `claude --print --output-format json --resume <session_id> -p "prompt"`, parses JSON, returns `result`
- For streaming: `--output-format stream-json --verbose` piped to SSE endpoint
- Bridge auto-selects: commissions default to `print`, admin sessions default to `pty`
- PTY watcher still works for `pty` sessions. For `print` sessions, tool calls come from JSON `type: "tool_use"` messages — more reliable than regex
- Backward compatible: existing `pty` sessions unchanged

**Why this is the right Phase 4:** Print-mode sessions eliminate OBS-03 (empty responses) entirely for commissioned work. The phone portal's `bridge_prompt` would return actual text instead of empty strings. PTY mode is preserved for live output viewing. Both modes coexist.

---

## 4. Success Criteria

1. **Settle delay reduction:** Adaptive settle reduces total idle overhead by ≥50% compared to fixed 1s delay, measured across a 20-tool-call agent session
2. **Diagnostic visibility:** Every session exposes `time_to_first_output_ms`, `tool_call_count`, `stall_reason` via `GET /sessions/:id/status`
3. **Permission detection:** When an agent hits a permission prompt, `permission_prompt_detected` is true within 5s
4. **Stall classification:** Stalled sessions receive a non-null `stall_reason` that matches manual diagnosis in ≥80% of cases
5. **Concurrency ceiling documented:** Stress test results at 3, 5, 7, 10 agents with completion rates, per-agent diagnostics, and resource usage
6. **5-agent completion rate ≥80%:** Up from the current 40% baseline (OBS-17)
7. **Parser probe complete:** Phase A experiment executed with documented findings — either JSON parser shipped or explicit rationale for deferral
8. **No regression:** Existing single-agent and 2-agent workflows maintain current reliability (no false-positive settle cutoffs introduced)
9. **Staggered spawn:** `bridge_spawn_batch` with 3s stagger achieves ≥80% completion at 5 agents (up from 0% simultaneous)

---

## 5. Configuration Summary

| Variable | Default | Description |
|----------|---------|-------------|
| `ADAPTIVE_SETTLE_ENABLED` | `true` | Enable adaptive settle delay algorithm |
| `ADAPTIVE_SETTLE_INITIAL_MS` | `300` | Starting settle delay |
| `ADAPTIVE_SETTLE_MAX_MS` | `2000` | Maximum settle delay cap |
| `ADAPTIVE_SETTLE_BACKOFF` | `1.5` | Backoff multiplier on false-positive cutoff |
| `SETTLE_DELAY_MS` | `1000` | Fixed settle delay (used when adaptive is disabled) |
| `DIAGNOSTICS_ENABLED` | `true` | Enable per-session diagnostic metrics |
| `PTY_PARSER_MODE` | `auto` | Parser mode: `auto` (detect), `json` (force JSON), `regex` (force legacy) |

---

## 6. Out of Scope

- **Agent-side reliability improvements:** This PRD is bridge-side only. Prompt engineering, methodology routing, and commission skill improvements are separate concerns.
- **Persistent diagnostic storage:** Diagnostics live in memory with the session. No database or time-series store. Historical analysis uses the stress test result documents.
- **Auto-recovery from stalls:** Diagnostics detect and classify stalls but do not auto-remediate (no auto-retry, no auto-kill-and-respawn). Auto-recovery is a future PRD after stall patterns are well-understood.
- **Claude Code CLI changes:** This PRD works with the CLI as-is. If `--output-format stream-json` doesn't work in PTY mode, we defer C2 rather than requesting CLI changes.
- **Cross-session resource allocation:** No CPU/memory budgeting per session. The concurrency ceiling is empirically determined, not enforced via resource limits.
- **Unified session contract model:** Orion's proposal (RFC minority position) for formal session contracts with resource budgets, file scope, and lifecycle guarantees is deferred. PRD 012 addresses the immediate reliability gaps. If the contract model proves necessary, it evolves from the diagnostic data and concurrency findings produced here.

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Adaptive settle introduces false-positive cutoffs** — shorter delays cause response truncation | MEDIUM | HIGH | Backoff algorithm self-corrects. `false_positive_settles` metric alerts on elevated rates. Fallback to fixed delay via `ADAPTIVE_SETTLE_ENABLED=false`. |
| **`--output-format stream-json` incompatible with PTY mode** | HIGH | MEDIUM | Phase A is a blocking experiment. If it fails, C2 is deferred. PRD still delivers C1, C3, C4 independently. |
| **Concurrency ceiling is hardware-specific** — results don't generalize | MEDIUM | LOW | Document hardware specs in stress test results. Ceiling is a baseline, not a guarantee. Users tune `MAX_SESSIONS` for their environment. |
| **Permission prompt detection false positives** — regex matches non-permission text | LOW | LOW | Pattern is specific (`Allow ... ? (y/n)`). False positives only affect the `permission_prompt_detected` flag, not session behavior. |
| **Stall classification is wrong** — heuristic misdiagnoses cause | MEDIUM | LOW | Classification is advisory, not actionable. Diagnostics expose raw metrics so humans can override the heuristic. Target ≥80% accuracy, not 100%. |
| **Diagnostic overhead** — tracking metrics slows the bridge | LOW | LOW | Metrics are counters and timestamps — nanosecond cost. No per-chunk allocation. PTY watcher already processes the same data. |

---

## 8. Relationship to Existing PRDs

| PRD | Relationship |
|-----|-------------|
| **PRD 005** (Bridge + Dashboard) | C4 extends the dashboard with diagnostics panel. C1 modifies the response completion logic in `pty-session.ts`. |
| **PRD 008** (Agent Visibility) | C4 diagnostics complement PRD 008 channels — channels show what agents report, diagnostics show what the bridge observes about session health. |
| **PRD 010** (PTY Auto-Detection) | C4 consumes PTY watcher observations for tool counts and idle detection. C1 uses PTY watcher tool-marker events to reset settle delay. C2 provides a JSON-based alternative to PTY watcher regex patterns. Permission prompt pattern (C4) extends PRD 010's pattern catalog. |
| **PRD 011** (Remote Bridge) | Reliability improvements directly benefit remote access. A remote operator needs higher confidence that commissioned agents will complete — 40% completion is unacceptable for phone-based mission control. |

---

## 9. Estimated Effort

| Phase | Component | Sessions | Sub-agents |
|-------|-----------|----------|------------|
| 1 | Diagnostic instrumentation | 3-4 | 1 |
| 2 | Adaptive settle delay | 2-3 | 1 |
| 3 | Concurrency ceiling testing | 2-3 | 1 (test runner) |
| 4 | PTY parser replacement | 3-5 | 1-2 |
| **Total** | | **10-15** | **2 (sequential)** |

Phases 1 and 2 can be parallelized across sub-agents. Phase 3 requires Phases 1-2 complete. Phase 4 is independent but benefits from Phase 1 diagnostics.
