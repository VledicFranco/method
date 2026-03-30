# PRD 013 — Bridge Test Coverage Extension

**Status:** Implemented (Phases 1-2 complete; Phase 3 coverage tooling deferred)
**Date:** 2026-03-15
**Previous:** Draft (2026-03-15)
**Scope:** Unit tests for untested bridge modules, test infrastructure, coverage tooling
**Depends on:** PRD 005 (bridge + dashboard), PRD 007 (live output + transcript), PRD 008 (channels), PRD 010 (PTY watcher)
**Evidence:** RFC #2 (council session 2026-03-15, 4-1 vote), retro-prd005-phase2 (proposed delta: "extend DR-09 to bridge"), 5 dashboard rendering bugs caught only in manual review
**Council:** Ad-hoc RFC triage session
**Implementation:** Phase 1 complete — `dashboard-route.test.ts`, `token-tracker.test.ts`, and `transcript-reader.test.ts` all exist with JSONL fixtures. Phase 2 partially complete — `usage-poller.test.ts` (49 tests) implemented. Remaining Phase 2: `live-output-route.test.ts`, `transcript-route.test.ts`, `__tests__/helpers.ts`. Phase 3 (coverage tooling + DR-09 update) not started.

---

## 1. Purpose and Problem Statement

### Six bridge modules have zero test coverage

The bridge package (`packages/bridge/src/`) contains 14 source modules. Five test files cover 7 of them:

| Test File | Modules Covered |
|-----------|----------------|
| `channels.test.ts` | `channels.ts` |
| `parser.test.ts` | `parser.ts` |
| `pool.test.ts` | `pool.ts` |
| `pty-watcher.test.ts` | `pty-watcher.ts`, `pattern-matchers.ts`, `auto-retro.ts` (partial) |
| `worktree-stale.test.ts` | `pool.ts` (stale detection) |

Six modules have zero dedicated test coverage:

| Module | LOC | Responsibility | Regression Risk |
|--------|-----|---------------|-----------------|
| `dashboard-route.ts` | 529 | HTML rendering with session data, formatting helpers | **High** — 5 rendering bugs in PRD 005 Phase 2, all caught in manual review |
| `token-tracker.ts` | 253 | JSONL parsing, token aggregation, project dir derivation | **High** — incorrect counts silently corrupt dashboard metrics |
| `usage-poller.ts` | 148 | OAuth token refresh, API polling, status state machine | **Medium** — 403 handling, network error recovery |
| `live-output-route.ts` | 121 | SSE stream setup/teardown, HTML page rendering | **Medium** — SSE lifecycle, dead session handling |
| `transcript-route.ts` | 175 | Transcript browser, turn rendering, tool call display | **Medium** — HTML rendering, content truncation |
| `transcript-reader.ts` | 185 | JSONL transcript parsing, session file listing | **High** — malformed JSONL handling, content extraction |

Two additional modules are untested but out of scope for unit testing:

| Module | Reason |
|--------|--------|
| `index.ts` | HTTP server entry point — integration testing, not unit testing |
| `pty-session.ts` | PTY process spawning — requires real PTY, integration testing |

### DR-09 does not cover bridge modules

DR-09 mandates real YAML fixtures for core package tests. No equivalent standard exists for bridge modules. The tested bridge modules (channels, parser, pool, pty-watcher) were tested ad hoc during their respective PRDs. As bridge grows, the untested surface area becomes a regression risk.

### The cost of no tests is concrete

The dashboard had 5 rendering bugs in PRD 005 Phase 2 — incorrect token formatting, broken session tree ordering, missing HTML escaping, wrong uptime calculation, and stale cache display. All were caught during manual review. Every one would have been prevented by a unit test against the formatting helpers and render functions.

---

## 2. Proposed Changes

### 2.1 Extend DR-09 to bridge modules

Add to `.method/project-card.yaml`:

> **DR-09 (extended):** Every bridge module that handles HTTP requests, processes PTY output, or generates artifacts must have tests with realistic fixtures. Route handlers are tested via exported pure functions (formatting, rendering); HTTP transport is tested via integration tests.

### 2.2 Test targets (by priority)

#### Priority 1: Pure function extraction (high value, low effort)

These modules export testable pure functions that need no HTTP mocking:

**`dashboard-route.ts` — formatting and rendering helpers**

Already-exported functions to test:
- `formatTokens(n)` — token count formatting (0, 1k, 1.5M)
- `formatUptime(startedAt)` — uptime string (5m, 2h 15m)
- `formatTimeAgo(date)` — relative time (now, 30s ago, 5m ago, 2h ago)
- `renderSubscriptionPanel(usage, status)` — HTML generation for all status states
- `renderSessionRows(sessions, tokenTracker)` — session table HTML, tree ordering, depth badges

Internal functions to export for testing:
- `formatStartedAt(date)` — date formatting
- `formatTimeUntil(isoString)` — countdown formatting
- `meterClass(utilization)` — CSS class selection (healthy/warning/critical)
- `cacheRateClass(rate)` — CSS class selection (good/mid/low)
- `statusBadgeClass(status)` — status CSS class
- `escapeHtml(str)` — XSS prevention
- `summarizeEventContent(content)` — event content truncation

Test cases (minimum):
```
formatTokens: 0 → "0", 999 → "999", 1000 → "1.0k", 1500000 → "1.5M"
formatUptime: 0m, 45m, 1h 0m, 25h 30m
formatTimeAgo: <5s → "now", 30s → "30s ago", boundary at 60s and 60m
meterClass: 59 → "healthy", 60 → "warning", 85 → "critical"
escapeHtml: &, <, >, " all escaped
renderSubscriptionPanel: null/not_configured, null/scope_error, null/network_error, valid usage data
renderSessionRows: empty array, single session, parent-child tree ordering, depth badges
```

**`token-tracker.ts` — token aggregation and project dir derivation**

Functions to test:
- `createTokenTracker` — register, refresh, get, aggregate lifecycle
- `deriveProjectDirName(workdir)` — path-to-directory-name conversion (export for testing)

Test cases (minimum):
```
deriveProjectDirName: Unix path (/home/user/project), Windows path (C:\Users\user\project), trailing slashes
registerSession + getUsage: returns null before register, null cached before refresh
getAggregate: empty → zeroes, single session, multiple sessions, cache hit rate calculation
refreshUsage: with valid JSONL fixture, with missing project dir, with malformed JSONL
```

JSONL fixture: create `packages/bridge/src/__tests__/fixtures/session.jsonl` with realistic Claude Code session events containing usage data.

**`transcript-reader.ts` — JSONL transcript parsing**

Functions to test:
- `createTranscriptReader` — listSessions, getTranscript
- `deriveProjectDirName(workdir)` — same logic as token-tracker (export for testing)

Test cases (minimum):
```
getTranscript: user message, assistant message, tool_use blocks, tool_result blocks
getTranscript: string content vs array content, missing fields, malformed lines skipped
getTranscript: token extraction (input, output, cache_read)
listSessions: empty dir, multiple JSONL files sorted by mtime
```

JSONL fixture: create `packages/bridge/src/__tests__/fixtures/transcript.jsonl` with realistic Claude Code message events.

#### Priority 2: State machine testing (medium effort)

**`usage-poller.ts` — OAuth polling and status transitions**

Functions to test:
- `createUsagePoller` — status state machine, getCached, getStatus
- `parseBucket(body, key)` — bucket extraction (export for testing)
- `parseExtraUsage(body)` — extra usage extraction (export for testing)

Test cases (minimum):
```
getStatus: no token → "not_configured", fresh start → "polling", after success → "ok"
parseBucket: valid bucket, missing fields → defaults, utilization vs percent_used fallback
parseExtraUsage: valid, missing, null
getCached: null before poll, populated after poll
start/stop: no-op when no token, stop clears interval
```

Note: The `poll()` function calls `fetch()`. Tests should mock `globalThis.fetch` or inject a fetch function. Do not make real HTTP calls.

#### Priority 3: Route handler testing (medium-high effort)

**`live-output-route.ts` — SSE stream and live output page**

Testable logic (extract if needed):
- Dead session returns 400 with transcript
- SSE headers are correct
- Template placeholder replacement
- Session not found returns 404

Test approach: Mock `pool` and `tokenTracker` interfaces. For SSE tests, verify the response setup (headers, initial transcript burst) without requiring a real Fastify instance — extract the handler logic into testable functions.

**`transcript-route.ts` — transcript browser**

Testable logic (extract if needed):
- `renderTurn(turn)` — HTML generation for a single transcript turn
- Template placeholder replacement
- Summary bar calculation (turns, tool calls, tokens)
- Session not found returns 404

Test cases (minimum):
```
renderTurn: user turn, assistant turn, turn with tool calls, long content truncation
summary: correct counts for turns, tool calls, total tokens
```

### 2.3 Test infrastructure

#### JSONL fixture files

Create `packages/bridge/src/__tests__/fixtures/` with:
- `session.jsonl` — realistic Claude Code session with usage data (for token-tracker tests)
- `transcript.jsonl` — realistic Claude Code conversation with text, tool_use, tool_result blocks (for transcript-reader tests)

These fixtures follow DR-09's principle: real data formats, not minimal mocks.

#### Mock helpers

Create `packages/bridge/src/__tests__/helpers.ts` with:
- `fakeTokenTracker()` — returns a `TokenTracker` with controllable usage data
- `fakeUsagePoller()` — returns a `UsagePoller` with controllable cached data and status
- `fakePool()` — extends existing `fakePtySession` pattern from pool.test.ts

These are lightweight test doubles, not framework-level mocks. They implement the same interfaces as the production code.

### 2.4 Coverage tooling

Add `c8` (Node.js native coverage via V8) as a dev dependency:

```json
{
  "scripts": {
    "test:coverage": "c8 --reporter=text --reporter=html node --test packages/bridge/src/__tests__/*.test.ts"
  }
}
```

No minimum threshold initially. The goal is to establish a baseline, not enforce a gate. The coverage report in `coverage/` (gitignored) provides visibility into which lines are exercised.

---

## 3. Implementation Order

### Phase 1: Pure function tests (Priority 1) — IMPLEMENTED

**Deliverables:**
- [x] `dashboard-route.test.ts` — tests for all formatting helpers and render functions (50+ test cases)
- [x] `token-tracker.test.ts` — tests for tracker lifecycle, aggregation, project dir derivation
- [x] `transcript-reader.test.ts` — 27 tests for JSONL parsing, session listing (PR #26)
- [x] JSONL fixture files in `__tests__/fixtures/` (`session.jsonl` + `transcript.jsonl`)
- [x] Export internal helpers that need testing

**Why first:** Highest regression risk (dashboard rendering bugs), pure functions with no dependencies, highest test-to-effort ratio. Every formatting helper is a single-input/single-output function — trivial to test, high value.

### Phase 2: State machine + route handler tests (Priority 2-3) — PARTIALLY IMPLEMENTED

**Deliverables:**
- [x] `usage-poller.test.ts` — 49 tests: status state machine, bucket parsing, fetch mocking (cherry-picked to master)
- [ ] `live-output-route.test.ts` — extracted handler logic tests
- [ ] `transcript-route.test.ts` — renderTurn, summary calculation
- [ ] `__tests__/helpers.ts` — shared mock helpers

**Estimated effort:** 2-3 working sessions

**Why second:** These modules have fewer historical bugs but growing complexity. Usage poller has a 5-state machine that's easy to get wrong. Route handlers need extracted logic to be testable without HTTP.

### Phase 3: Coverage tooling + DR-09 update

**Deliverables:**
- `c8` dev dependency added
- `test:coverage` npm script
- DR-09 update in project card
- Coverage baseline documented

**Estimated effort:** 1 working session

**Why last:** Tooling depends on tests existing. DR-09 update is governance — do it after the tests prove the pattern works.

---

## 4. Test Patterns

### Use `node:test` and `node:assert/strict`

All existing bridge tests use Node.js built-in test runner. New tests must follow the same pattern:

```typescript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
```

No Jest, no Vitest, no Mocha. The bridge has zero test framework dependencies and must stay that way.

### Use real JSONL fixtures, not minimal mocks (DR-09)

Token tracker and transcript reader tests must use JSONL files that match Claude Code's actual output format. This catches parsing regressions when Claude Code's format evolves.

### Export pure functions for testing

When a module has testable logic buried in unexported functions, export them. The pattern already exists: `dashboard-route.ts` exports `formatTokens`, `formatUptime`, `formatTimeAgo`, `renderSubscriptionPanel`, `renderSessionRows`. Extend this to internal helpers like `escapeHtml`, `meterClass`, etc.

### Mock interfaces, not implementations

The `fakePtySession` pattern in `pool.test.ts` is the model: implement the `PtySession` interface with controllable state. Don't mock individual methods — build a coherent test double that implements the full interface. Apply the same pattern to `TokenTracker`, `UsagePoller`, and `SessionPool`.

---

## 5. Success Criteria

1. **All 6 untested modules have dedicated test files** with at least the minimum test cases specified in Section 2.2
2. **All formatting helpers are tested** — `formatTokens`, `formatUptime`, `formatTimeAgo`, `escapeHtml`, `meterClass`, `cacheRateClass`
3. **JSONL parsing is tested** with realistic fixtures — token-tracker and transcript-reader handle valid, empty, and malformed input
4. **Usage poller status machine is tested** — all 5 states (`not_configured`, `polling`, `ok`, `scope_error`, `network_error`) verified
5. **`npm test` passes** with all new tests included
6. **`npm run test:coverage`** produces a baseline report
7. **Zero new dependencies** — no test framework additions beyond c8 for coverage
8. **DR-09 updated** in project card to include bridge modules

---

## 6. Out of Scope

- **HTTP integration tests** for `index.ts` routes — requires running Fastify server, separate effort
- **PTY integration tests** for `pty-session.ts` — requires real Claude Code binary, separate effort
- **Coverage enforcement** (minimum thresholds, CI gates) — establish baseline first, enforce later
- **Refactoring untested modules** — this PRD adds tests to existing code, not restructuring
- **Dashboard HTML template tests** — testing the HTML template file itself (CSS, JS); only the server-side rendering logic is in scope
- **Performance benchmarks** — coverage tooling measures correctness, not performance

---

## 7. Relationship to Existing PRDs

| PRD | Relationship |
|-----|-------------|
| **PRD 005** (Bridge + Dashboard) | PRD 013 retroactively tests dashboard-route.ts, which PRD 005 introduced. The 5 rendering bugs from PRD 005 Phase 2 are the primary evidence for this PRD. |
| **PRD 007** (Live Output + Transcript) | PRD 013 tests live-output-route.ts and transcript-route.ts/transcript-reader.ts, which PRD 007 introduced. |
| **PRD 008** (Agent Visibility) | Channel infrastructure is already tested. PRD 013 does not add channel tests. |
| **PRD 010** (PTY Activity Detection) | pty-watcher.ts and pattern-matchers.ts are already tested (in pty-watcher.test.ts). auto-retro.ts has partial coverage there. PRD 013 does not duplicate these tests. |

### Architectural Note

PRD 013 is entirely within the `@method/bridge` package test surface. It does not add tests for `@method/core` or `@method/mcp`. It follows the existing test pattern (node:test, real fixtures, interface-based mocks) and requires no structural changes to the modules under test — only selective `export` additions for internal helpers.

---

## 8. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **JSONL format changes** between Claude Code versions break fixture files | MEDIUM | LOW | Fixtures are versioned with the test. Update when format changes are detected (same risk as token-tracker and transcript-reader themselves). |
| **Exporting internal helpers** increases public API surface | LOW | LOW | Exported helpers are pure functions with no side effects. Consumers are test files only. No semver implications for an internal package. |
| **Mocking `fetch` for usage-poller** is fragile | MEDIUM | LOW | Use `globalThis.fetch` assignment in test setup/teardown. Node 18+ has native fetch. If fragile, extract `poll()` to accept a fetch function parameter. |
| **Coverage numbers create false confidence** | LOW | MEDIUM | Coverage measures lines executed, not correctness. The minimum test cases in Section 2.2 target specific regression risks, not arbitrary line coverage. |
