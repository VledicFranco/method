# AG-030: context-mode Feasibility Assessment

**Date:** 2026-03-15
**Agenda item:** AG-030 — Prototype: context-mode MCP for indexed channel retrieval
**Decision ref:** D-032 (SESSION-021)
**Status:** Research complete — recommendation below

---

## 1. Problem Statement

Parent agents monitoring child sessions via bridge channels (PRD 008) receive raw, unfiltered telemetry. In observed usage, a single child emits 18+ progress messages during a methodology run. The parent must consume all messages sequentially via `bridge_read_progress` — no filtering by type, no keyword search, no aggregation. This wastes parent context window space and forces manual parsing of `Record<string, unknown>` payloads.

**Desired capability:** Indexed, selective retrieval of child channel output — "show me all `step_completed` messages," "what errors occurred," "summarize progress on method M3."

## 2. context-mode Overview

**Repository:** [mksglu/context-mode](https://github.com/mksglu/context-mode)
**npm:** `context-mode`
**License:** ELv2 (Elastic License v2)
**Maintenance:** Active (385+ commits to main, Discord community of 1.4K+)

### What It Does

context-mode is an MCP server + hook system that virtualizes tool outputs. Two primary functions:

1. **Sandbox execution** — Runs commands/scripts in isolated subprocesses, returns only stdout summaries. Raw data never enters context. Achieves 95-98% context reduction (e.g., 315 KB → 5.4 KB).

2. **Session continuity** — Persists all session events (file edits, git ops, errors, decisions) in a local SQLite database. On context compaction, rebuilds a priority-tiered session guide (≤2 KB) and re-indexes content into FTS5 for retrieval.

### MCP Tools

| Tool | Purpose |
|------|---------|
| `ctx_execute` | Execute code in 11 languages, return stdout only |
| `ctx_batch_execute` | Batch multiple commands in one call |
| `ctx_execute_file` | Process files in sandbox |
| `ctx_index` | Chunk markdown into FTS5 with BM25 ranking |
| `ctx_search` | Query indexed content via full-text search |
| `ctx_fetch_and_index` | Fetch URL, detect type, chunk and index |
| `ctx_stats` | Display context savings statistics |
| `ctx_doctor` | Diagnostics |

### Indexing Architecture

- **Storage:** SQLite with FTS5 virtual tables
- **Ranking:** BM25 (term frequency × inverse document frequency × length normalization)
- **Tokenizer:** Porter stemmer with trigram fallback for partial matches
- **Fuzzy search:** Three-layer cascade — FTS5 MATCH → trigram substring → Levenshtein distance
- **Smart snippets:** Extracts windows around matching terms rather than truncating
- **Progressive throttling:** Reduces results after repeated queries to prevent context re-bloat

## 3. Fit Analysis

### 3.1 Architecture Mismatch (Critical)

context-mode solves a **local** problem: keeping an agent's own tool outputs out of its context window and recovering state after compaction. It operates on the agent's local SQLite database.

The bridge channel problem is **inter-agent**: a parent needs to selectively retrieve data from a child's channel, which lives on the bridge HTTP server.

**To use context-mode for channel retrieval, a parent agent would need to:**

```
1. Call bridge_read_progress(child_id, since_sequence=0)  → raw messages
2. Format messages as markdown text
3. Call ctx_index(content)                                 → index locally
4. Call ctx_search("step_completed")                       → retrieve matches
```

This is a **two-hop pattern**: fetch all data first, then index locally. It does not reduce the amount of data transferred from the bridge — it only reduces what stays in the parent's context window after retrieval. The parent still receives all 18+ messages before indexing can filter them.

### 3.2 What context-mode Would Help With

Despite the architecture mismatch, there are valid use cases:

| Use Case | Value | Notes |
|----------|-------|-------|
| Parent compaction survival | High | If parent's context compacts mid-monitoring, ctx_search can recover child state from local index |
| Post-hoc analysis | Medium | After child completes, parent can index all channel data and answer specific queries |
| Multi-child correlation | Medium | Index channels from multiple children, search across all of them |
| Raw telemetry reduction | High | 18 messages → indexed, retrievable via keyword; only relevant snippets enter context |

### 3.3 What context-mode Would NOT Help With

| Gap | Why |
|-----|-----|
| Reducing data transfer from bridge | Parent still fetches full channel dump before indexing |
| Real-time filtered polling | ctx_search queries local index; bridge channels update live on the server |
| Structured type filtering | "Give me all step_completed messages" is better solved by a query parameter on the bridge endpoint |
| Cross-session aggregation | bridge_all_events already does this; context-mode would duplicate it locally |
| Server-side indexing | context-mode is client-side only; doesn't modify the bridge |

### 3.4 License Risk

ELv2 prohibits offering the licensed software as a managed service. Since pv-method's bridge serves MCP tools to other agents:

- **Prototype usage:** Safe. Running context-mode as a local MCP server alongside the bridge is fine.
- **Native integration:** Risky. Embedding context-mode's FTS5 indexing logic into the bridge server could constitute a derivative work offered as a service. Would need legal review before PRD 009 if it follows this path.
- **Pattern adoption:** Safe. Learning from context-mode's indexing patterns (FTS5, BM25, smart snippets) and implementing them natively is fine — algorithms aren't licensable.

### 3.5 Installation Complexity

- **Plugin mode** (full hooks): `/plugin marketplace add mksglu/context-mode` — installs hooks, MCP server, routing file. Modifies `CLAUDE.md` automatically.
- **MCP-only mode** (no hooks): `claude mcp add context-mode -- npx -y context-mode` — adds 6 tools, no hooks.

For prototyping, MCP-only mode is sufficient and non-invasive.

## 4. Prototype Design

If we proceed with a prototype, the most useful test is:

### Test Scenario

> Parent agent spawns a child for a methodology task. Child emits 15+ progress messages. Parent uses context-mode to index child's channel output and answer targeted queries.

### Steps

1. Install context-mode in MCP-only mode on the parent agent
2. Spawn a child via `bridge_spawn` with a real methodology task
3. After child completes, parent calls `bridge_read_progress(child_id)` → gets all messages
4. Parent calls `ctx_index(formatted_messages)` → indexes into FTS5
5. Parent calls `ctx_search("step_completed")` → gets filtered results
6. Measure: context tokens saved, retrieval accuracy, latency

### Success Criteria

| Criterion | Threshold |
|-----------|-----------|
| Context reduction | ≥60% fewer tokens in parent context vs. raw dump |
| Retrieval accuracy | Correct results for type-based queries (step_completed, error) |
| Latency overhead | <500ms for index + search cycle |
| Parent compaction survival | After compaction, ctx_search recovers child state |

### What This Validates

- Whether client-side indexing is a viable pattern for channel data
- Whether the two-hop cost (fetch → index → search) is acceptable
- Whether BM25 ranking is meaningful for structured telemetry (vs. prose)

### What This Does NOT Validate

- Server-side indexed retrieval (the ideal architecture)
- Real-time filtered polling
- Multi-parent concurrent access to indexed channels

## 5. Alternative: Native Bridge Indexing (PRD 009 Preview)

The prototype's real purpose is to determine whether PRD 009 should add **server-side indexed retrieval** natively to the bridge. If the prototype validates the pattern, PRD 009 would:

| Feature | context-mode (client) | PRD 009 (native, projected) |
|---------|----------------------|---------------------------|
| Index location | Parent's local SQLite | Bridge in-memory or SQLite |
| Query interface | ctx_search MCP tool | Query params on bridge_read_progress |
| Data transfer | Full dump then local index | Filtered at source |
| Multi-parent access | Each parent indexes independently | Single index, multiple readers |
| Compaction survival | Yes (local persistence) | N/A (bridge-side) |
| Implementation cost | Zero (install existing tool) | Medium (new bridge feature) |

**Key insight:** context-mode validates the *value* of indexed retrieval, not the *architecture*. If parents find indexed search useful, that's signal to build it natively with server-side filtering — eliminating the two-hop cost entirely.

## 6. Recommendation

**Proceed with prototype, but scope it tightly.**

### Do

1. Install context-mode in MCP-only mode on a parent agent session
2. Run the test scenario above with a real methodology child
3. Measure the four success criteria
4. Document whether BM25 ranking adds value for structured telemetry
5. If validated → draft PRD 009 with native server-side indexing spec

### Do Not

1. Do not install plugin mode (hooks modify CLAUDE.md, add complexity beyond what we're testing)
2. Do not embed context-mode into the bridge codebase (ELv2 risk, architecture mismatch)
3. Do not build native indexing yet — prototype first, then decide
4. Do not test context-mode's sandbox execution features (orthogonal to the channel retrieval problem)

### Decision Framework for PRD 009

After prototype:

- **If context reduction ≥60% AND retrieval is accurate** → PRD 009: native FTS5 indexing on bridge channels with query parameters on read endpoints
- **If context reduction ≥60% BUT retrieval is inaccurate for structured data** → PRD 009: native filtering (by type, by step) without full-text search — simpler, more reliable
- **If context reduction <60%** → Channel data is already compact enough; add type-filter query parameters to existing endpoints instead of full indexing

### Timeline

- Prototype: single session, no code changes required
- PRD 009 draft: contingent on prototype results
- Native implementation: estimated at 2-3 sessions if PRD 009 proceeds

---

## Sources

- [mksglu/context-mode (GitHub)](https://github.com/mksglu/context-mode)
- [context-mode (npm)](https://www.npmjs.com/package/context-mode)
- PRD 008: Bridge Visibility Channels (`docs/prds/prd-008-bridge-visibility-channels.md`)
- SESSION-021 decision D-032 (`.method/council/logs/2026-03-14.yaml`)
- AGENDA AG-030 (`.method/council/AGENDA.yaml`)
