---
type: prd
title: "fca-index SC-1 — Top-1 Result Enrichment"
date: "2026-04-12"
status: draft
implements: "PRD 053 SC-1 (token reduction)"
domains: [fca-index/query, mcp/context-tools]
surfaces: []  # zero — no port changes
council: .method/sessions/fcd-debate-fca-index-sc1/decision.md
proposed_prd_number: "056"
---

# PRD — fca-index SC-1: Top-1 Result Enrichment

## Problem

PRD 053's SC-1 (token reduction) is reported at **39% of grep baseline**, against an
aspirational target of ≤20%. The dogfood retrospective and the 2026-04-12 council
session produced two findings that change the picture:

1. The MCP tool result alone is already ~13% of baseline (4,862 / 37,500 tokens
   measured by the harness). The remainder of the gap is **agent file reads after
   the query**, not the tool's output.
2. Those file reads are caused by `formatContextQueryResult` truncating excerpts to
   120 characters — typically mid-sentence — which forces the agent to open the
   source file to disambiguate the top result.

The data is already in the index. `DocExtractor` populates each `IndexEntry.parts[*].excerpt`
with up to 600 chars. The frozen `ComponentPart.excerpt` field is documented as
"first ~500 chars of the most relevant section." We are using ~24% of the
available excerpt budget on the top-1 result and forcing the agent to spend
~2,000 tokens per query reading source files to make up the difference.

## Constraints

- **`ContextQueryPort` is frozen** (2026-04-08). No additions, no removals, no
  semantic changes. `ComponentContext` and `ComponentPart` shapes are stable.
- `IndexStorePort.getByPath` is WARN-LEGACY (added 2026-04-09). Do not extend
  further before the formal extension session.
- `FileSystemPort.getModifiedTime` is WARN-LEGACY. Same constraint.
- DR-04: MCP handlers are thin wrappers — no business logic in the MCP layer.
  Result shaping must live in the query domain.
- DR-09: tests use real fixtures, not mocks.
- All 6 fca-index architecture gates and 2 mcp architecture gates must continue
  to pass.
- SC-3 (precision) — currently 80% strict / 100% loose — must not regress.

## Success Criteria

| ID | Criterion | Measurement |
|----|-----------|-------------|
| **AC-1** | **5-query harness total ≤ 7,500 tokens** (20% of 37,500 grep baseline) | `tmp/sc1-bench-harness.mjs` re-run after change |
| **AC-2** | **Hard revert threshold: > 9,000 tokens (24%)** triggers immediate revert | Same harness, regression guard |
| **AC-3** | **Q4 (filename query) ratio ≤ 350%** — must not be materially worsened | Same harness, per-query breakdown |
| **AC-4** | **SC-3 precision unchanged**: 80% strict / 100% loose on the 5 queries | Manual relevance check vs PRD 053 baseline |
| **AC-5** | **Synthetic agent validation**: at least one query (Q1) run end-to-end via bridge with old vs new MCP, n=3 per arm. Post-query `Read` tool call count documented. | Bridge session traces |
| **AC-6** | **All 8 architecture gates pass** (6 fca-index + 2 mcp) | `npm test` |
| **AC-7** | **PRD 053 SC-1 revision section updated** with new measurement, falsification threshold, and query-mix disclosure | PR diff |

## Scope

**In scope:**
- `packages/fca-index/src/query/result-formatter.ts` — per-rank excerpt budget logic
- `packages/mcp/src/context-tools.ts` — defensive cap raised; tool description nudge
- `tmp/sc1-bench-harness.mjs` — checked in as a re-runnable benchmark script
- `docs/prds/053-fca-index-library.md` — SC-1 revision section update with new numbers
- Synthetic agent validation run via the bridge — documented in PR

**Out of scope:**
- Any change to `ContextQueryPort`, `ComponentContext`, `ComponentPart` (frozen)
- Changes to `QueryEngine.query()` control flow (no new steps, no new ports)
- Filename-shaped query routing (Q4 problem) — separate future work, requires
  new MCP `suggest_search_strategy` tool surface
- Pre-computed query bundles (Strategy c from PRD 053) — speculative
- Expansion of the benchmark to >5 queries (this PR keeps the same 5 for
  apples-to-apples comparison; expansion is a follow-up)
- `DocExtractor.MAX_EXCERPT` increase from 600→800 (separate change if synthetic
  run shows excerpts hitting the cap)
- WARN-LEGACY port formalization sessions

**Explicitly NOT included:** This PRD does not propose a query-engine refactor,
new ports, new entity types, or any behavior change visible to consumers other
than richer top-1 excerpts in already-existing fields.

## Domain Map

```
@methodts/fca-index                              @methodts/mcp
┌──────────────────────┐                    ┌──────────────────┐
│  query/              │                    │  context-tools   │
│  ┌────────────────┐  │                    │  ┌────────────┐  │
│  │ query-engine   │  │  ContextQueryPort  │  │ MCP wrapper│  │
│  │   (unchanged)  │──┼─── (frozen) ──────▶│  │  (formatter│  │
│  │                │  │                    │  │   caps     │  │
│  │ result-formatter│ │                    │  │   raised)  │  │
│  │  (CHANGED:     │  │                    │  └────────────┘  │
│  │   per-rank     │  │                    └──────────────────┘
│  │   excerpt      │  │
│  │   budgets)     │  │                    tmp/  (NEW: checked-in)
│  └────────────────┘  │                    └─ sc1-bench-harness.mjs
└──────────────────────┘
```

**Cross-domain interactions:**
- `fca-index/query` → `mcp/context-tools`: existing `ContextQueryPort`. **Unchanged.**
- `mcp/context-tools` → `fca-index/query`: same port, same direction. **Unchanged.**

**Surface count for this PRD: 0.** This is the rare optimization that doesn't
require any port co-design.

## Surfaces (Primary Deliverable)

**Empty.** This is intentional and was verified by Sable in the
2026-04-12 council session
(`.method/sessions/fcd-debate-fca-index-sc1/decision.md`):

- New ports needed: **0**
- Modified ports: **0**
- Modified entity types: **0**
- Wave 0 items: **0**
- `/fcd-surface` sessions needed: **0**

The change is internal to the query domain. The data already flows through
existing fields (`ComponentPart.excerpt` is documented as "first ~500 chars" in
the frozen port; we are now using up to ~500 chars on top-1 and ~120 on others —
both within contract). MCP-side caps remain as defensive guards but are raised
to permit the new shape.

**Future (out of scope for this PRD):** when the search-strategy advisor
(Strategy b from PRD 053) is built, it will need a new MCP tool surface and a
`/fcd-surface` session. Tracked as a follow-up.

---

## Per-Domain Architecture

### Domain 1 — `@methodts/fca-index/query` (changed)

**Layer placement:** L2 domain, no level change.

**Internal structure (changed file):**

```
packages/fca-index/src/query/
  query-engine.ts          (unchanged — calls formatter as before)
  result-formatter.ts      (CHANGED — per-rank excerpt budget)
  result-formatter.test.ts (NEW — explicit budget tests)
  component-detail-engine.ts (unchanged)
```

**Change semantics in `result-formatter.ts`:**

`ResultFormatter.format()` currently passes `entry.parts` through unchanged.
The change introduces a per-rank excerpt budget:

```typescript
// New constants (private to result-formatter.ts)
const TOP_RESULT_EXCERPT_PER_PART = 500;   // top-1 only
const TOP_RESULT_TOTAL_BUDGET     = 1800;  // hard cap on top-1 across all parts
const REST_RESULT_EXCERPT_PER_PART = 120;  // current behavior, unchanged

// Inside format():
return entries.map((entry, i) => {
  const isTop = i === 0;
  const trimmedParts = trimParts(entry.parts, isTop);
  // ...rest unchanged
  return { path: entry.path, level, parts: trimmedParts, ... };
});

function trimParts(parts: ComponentPart[], isTop: boolean): ComponentPart[] {
  if (!isTop) {
    return parts.map(p => ({
      ...p,
      excerpt: p.excerpt?.slice(0, REST_RESULT_EXCERPT_PER_PART),
    }));
  }
  let used = 0;
  return parts.map(p => {
    if (!p.excerpt) return p;
    const remaining = TOP_RESULT_TOTAL_BUDGET - used;
    if (remaining <= 60) return { ...p, excerpt: undefined };
    const limit = Math.min(TOP_RESULT_EXCERPT_PER_PART, remaining);
    const trimmed = p.excerpt.slice(0, limit);
    used += trimmed.length;
    return { ...p, excerpt: trimmed };
  });
}
```

**Why result-formatter.ts and not query-engine.ts:**
- `result-formatter.ts` already owns IndexEntry → ComponentContext shaping.
- `query-engine.ts` contains the orchestration (embed → search → mode →
  freshness → format). It should stay free of presentation concerns.
- The council ("engine-side variant") meant *inside the query domain*, not
  *inside the QueryEngine class specifically*. Result-formatter is the right
  module within the query domain.

**Ports consumed:** none new. Still uses `IndexStorePort`, `EmbeddingClientPort`,
`FileSystemPort` indirectly via QueryEngine.

**Verification strategy:**
- Unit: `result-formatter.test.ts` covering:
  1. Top-1 excerpts are budgeted to ≤ 500 chars per part.
  2. Top-1 total excerpt characters ≤ 1,800.
  3. Non-top results retain ≤ 120 char excerpts (regression guard).
  4. A pathologically rich top-1 (8 parts × 600 chars) caps cleanly at 1,800.
  5. A top-1 with no excerpts passes through unchanged.
  6. A single-result query (entries.length === 1) treats that result as top-1.
  7. `ComponentContext.parts` ordering preserved.
- Integration: existing `query-engine.test.ts` and `query-engine.golden.test.ts`
  must still pass without modification (the engine's contract doesn't change).
- Architecture: G-PORT-QUERY, G-BOUNDARY-DETAIL, G-LAYER all still pass
  (no new imports added).

**Migration path:** none — this is internal optimization, not a contract change.
No consumer needs to migrate. CLI continues to render JSON unchanged. MCP
formatter inherits the richer top-1 automatically.

---

### Domain 2 — `@methodts/mcp/context-tools` (changed)

**Layer placement:** L3 protocol adapter, unchanged.

**Internal structure (changed file):**

```
packages/mcp/src/
  context-tools.ts        (CHANGED — defensive caps raised, tool description nudge)
  context-tools.test.ts   (CHANGED — assertions for the new top-1 rendering shape)
```

**Change semantics in `context-tools.ts`:**

`formatContextQueryResult` (lines 200–224) currently truncates **all**
excerpts to 120 chars at render time, including top-1. After the
result-formatter change, top-1 excerpts arrive at the MCP boundary already up
to ~500 chars per part. The MCP formatter must:

1. **Stop double-truncating top-1.** Raise the top-1 excerpt cap to match the
   producer-side budget (500 per part, 1800 total).
2. **Preserve newlines on top-1 only.** Top-1 excerpt rendering switches from
   single-line (`> ...`) to multi-line indented (`     | ...`) so structural
   code stays readable. Other ranks remain single-line.
3. **Keep non-top behavior identical** to the current 120-char single-line `>`
   prefix (regression guard).
4. **Update `context_query` tool description** to nudge the agent toward
   `context_detail` for full implementation context (cheaper than reading
   source files). One sentence added.

**Sketch:**

```typescript
const TOP_EXCERPT_RENDER_LIMIT = 500;
const TOP_TOTAL_RENDER_LIMIT = 1800;
const REST_EXCERPT_RENDER_LIMIT = 120;

function formatContextQueryResult(result, query) {
  const lines = [
    `[mode: ${result.mode}]`,
    `[${result.results.length} results for "${query}"]`,
    '',
  ];
  for (let i = 0; i < result.results.length; i++) {
    const c = result.results[i];
    const isTop = i === 0;
    lines.push(
      `${i + 1}. ${c.path} (${c.level}) — relevance: ${c.relevanceScore.toFixed(2)}, coverage: ${c.coverageScore.toFixed(2)}`,
    );

    let topUsed = 0;
    for (const p of c.parts) {
      lines.push(`   ${p.part}: ${p.filePath}`);
      if (!p.excerpt) continue;

      if (isTop) {
        const remaining = TOP_TOTAL_RENDER_LIMIT - topUsed;
        if (remaining <= 60) continue;
        const excerpt = p.excerpt.slice(0, Math.min(TOP_EXCERPT_RENDER_LIMIT, remaining));
        const indented = excerpt.split('\n').map(l => `     | ${l}`).join('\n');
        lines.push(indented);
        topUsed += excerpt.length;
      } else {
        const excerpt = p.excerpt.slice(0, REST_EXCERPT_RENDER_LIMIT).replace(/\n/g, ' ');
        lines.push(`     > ${excerpt}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
```

**Tool description nudge** (in `CONTEXT_TOOLS` array):

```typescript
{
  name: 'context_query',
  description:
    'Query the FCA index for components relevant to a task or concept. ' +
    'Returns ranked component descriptors. The top result is rendered with ' +
    'expanded excerpts so you can usually act on it without reading source files. ' +
    'For full implementation details on any component, call context_detail — ' +
    'it is cheaper than opening files and gives you the indexed FCA parts.',
  ...
}
```

**Ports consumed:** still `ContextQueryPort`, `CoverageReportPort`,
`ComponentDetailPort`. **Unchanged.**

**Verification strategy:**
- Unit: `context-tools.test.ts` covering:
  1. Top-1 result shows multi-line `|`-prefixed excerpts.
  2. Top-1 total characters ≤ 1,800 in rendered output.
  3. Non-top results show single-line `>`-prefixed excerpts ≤ 120 chars
     (regression guard).
  4. End-to-end token count for a known fixture stays ≤ 1,500 tokens.
  5. Empty/missing excerpt handled cleanly (no malformed output).
- Architecture: both mcp gates still pass.

**Migration path:** none. The MCP tool's external behavior remains a single
text response per call. Consumers that parse the rendered text by line prefix
must accept `|` as a valid excerpt prefix on top-1 results — this is a minor
format change documented in the PR description.

---

### Domain 3 — Benchmark harness check-in (NEW — minimal)

**Layer placement:** N/A — script-only, lives in `tmp/` for first PR.

**Internal structure:**

```
tmp/
  sc1-bench-harness.mjs    (already exists — check in as-is with minor tidy)
  sc1-bench-output-20260412.txt (baseline output, kept as evidence)
  sc1-bench-output-after.txt    (post-change output, generated as part of PR)
```

**Why `tmp/` and not `packages/fca-index/scripts/`:**
- `tmp/` is gitignored by default but the harness file is small and useful.
  Force-add via `git add -f tmp/sc1-bench-harness.mjs`.
- The council noted this is a presentation choice — a follow-up PR can move it
  to `packages/fca-index/scripts/` and add an `npm run bench:sc1` entry.
- Keeping it in `tmp/` for the first PR avoids scope creep into package
  configuration changes.

**Verification strategy:** the harness runs against a real `.fca-index/`
scan and emits per-query token counts. Manual run + diff against baseline.

---

## Phase Plan

### Wave 0 — Surfaces

**Empty.** Per Sable's surface check: 0 new ports, 0 modified ports, 0 entity
type changes. This PRD's Wave 0 has no work items.

**Justification for skipping Wave 0:** the change is internal to the query
domain. The frozen `ComponentPart.excerpt` field's "~500 chars" contract
already permits the new behavior. The composition theorem says fixing the
producer is worth more than fixing the consumer; we are doing exactly that
inside the existing contract.

### Wave 1 — Producer change (`fca-index/query`)

**Branch:** `feat/053-sc1-top1-enrichment` (or `feat/056-sc1-top1-enrichment`
if promoted to a numbered PRD).

**Deliverables:**
1. Edit `packages/fca-index/src/query/result-formatter.ts`:
   - Add `trimParts` helper with per-rank excerpt budget logic.
   - Add `TOP_RESULT_EXCERPT_PER_PART`, `TOP_RESULT_TOTAL_BUDGET`,
     `REST_RESULT_EXCERPT_PER_PART` constants.
2. Add `packages/fca-index/src/query/result-formatter.test.ts` covering all
   7 unit-test cases listed in §Per-Domain Architecture / Domain 1.
3. Verify `query-engine.test.ts` and `query-engine.golden.test.ts` still pass
   without modification.
4. Run `npm test` from the repo root — all gates green.

**Acceptance gate (gamma_1):** Producer-side change merged. All fca-index
tests pass. All 6 fca-index architecture gates pass. Result-formatter unit
tests assert the per-rank budget correctly.

### Wave 2 — Consumer change (`mcp/context-tools`)

**Deliverables:**
1. Edit `packages/mcp/src/context-tools.ts`:
   - Raise top-1 render caps to match the producer (500 per part, 1,800 total).
   - Switch top-1 to multi-line `|`-prefixed rendering.
   - Add tool description nudge for `context_query`.
2. Update `packages/mcp/src/context-tools.test.ts` (or create if missing) with
   the 5 cases from §Per-Domain Architecture / Domain 2.
3. Run `npm test` — both mcp gates and all mcp tests pass.

**Acceptance gate (gamma_2):** Consumer-side change merged. All mcp tests
pass. Both mcp architecture gates pass. End-to-end fixture rendering ≤ 1,500
tokens.

### Wave 3 — Benchmark check-in + reproduction

**Deliverables:**
1. Force-add `tmp/sc1-bench-harness.mjs` to the repo (it is currently
   gitignored).
2. Force-add `tmp/sc1-bench-output-20260412.txt` as the **baseline**.
3. Re-run the harness against the patched code:
   `set -a && source .env && set +a && node tmp/sc1-bench-harness.mjs > tmp/sc1-bench-output-after.txt`
4. Force-add `tmp/sc1-bench-output-after.txt` to the repo.
5. Diff the two files in the PR description.

**Acceptance gate (gamma_3):**
- 5-query total ≤ 7,500 tokens (AC-1) — primary success.
- 5-query total ≤ 9,000 tokens (AC-2) — hard revert if exceeded.
- Q4 ratio ≤ 350% (AC-3).
- Per-query tokens documented in PR description.

### Wave 4 — Synthetic agent validation

**Deliverables:**
1. Spawn 3 sub-agents via the bridge with the **old** MCP build, given Q1
   ("event bus implementation") as the task. Capture the full session traces.
2. Repeat with the **new** MCP build, n=3.
3. Count `Read` tool calls within 60s of each `context_query` call.
4. Document results in PR description and in `tmp/sc1-bench-output-after.txt`
   (or a separate `tmp/sc1-agent-validation-20260413.md`).

**Acceptance gate (gamma_4):**
- AC-5 satisfied: at least one query run end-to-end with old vs new MCP, n=3
  per arm, post-query `Read` counts documented.
- The synthetic run is **not a blocker** if the result is ambiguous — the
  bench harness numbers (Wave 3) are the load-bearing acceptance gate. The
  agent run validates the *theory* of the change; the *number* is already
  good enough on the math alone (council Vera/Rion compromise).

### Wave 5 — Documentation update

**Deliverables:**
1. Update `docs/prds/053-fca-index-library.md` SC-1 revision section:
   - New 5-query table with post-change tokens
   - Falsification threshold disclosed
   - Query-mix disclosure (4 concept / 1 filename)
   - Pointer to `tmp/sc1-bench-harness.mjs` as the reproduction script
2. Update `.method/council/memory/fca-index.yaml`:
   - Mark this design session as `outcome: implemented`
   - Add the SC-1 measurement to `feature_sets`
3. Add a brief retro to `.method/retros/retro-2026-04-13-NNN.yaml`
   (or appropriate date).

**Acceptance gate (gamma_5):**
- AC-7 satisfied: PRD 053 SC-1 revision section reflects the new measurement.
- Council memory updated.
- Retro filed.

### Wave 6 — PR

**Deliverables:**
1. Push branch.
2. Open PR with the format used in this repo (gh CLI for personal repos? No —
   this is a personal repo, use `mcp__github-personal__create_pull_request`).
3. PR description includes: bench diff, agent run summary, gate pass list,
   link to the council decision and this PRD.

**Acceptance gate (gamma_6):**
- PR open, all CI green, all 8 architecture gates passing.
- AC-1 through AC-7 satisfied or explicitly waived in PR body.

### Wave dependency DAG

```
Wave 1 (producer) ──┐
                    ├──→ Wave 3 (bench) ──→ Wave 4 (agent run) ──→ Wave 5 (docs) ──→ Wave 6 (PR)
Wave 2 (consumer) ──┘
```

Wave 1 and Wave 2 can run in parallel — they touch different packages and
have no shared imports. Wave 3 depends on both. Waves 4–6 are sequential.

---

## Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Top-1 component has so many parts that 1,800-char cap truncates an important part | Medium | Low — bounded by cap, agent can call context_detail | Hard cap enforced; test case for pathological 8-part component |
| Multi-line `\|`-prefix rendering breaks a downstream consumer that parses by line prefix | Low | Medium | Format change documented in PR; only top-1 is multi-line; non-top regression guard test |
| Agents continue to read source files anyway (habit) — synthetic validation shows no behavior change | Medium | Low | Math alone meets target; behavior change is upside, not load-bearing. Non-blocking per Wave 4 acceptance gate |
| Q4 (filename query) ratio worsens past 350% | Low | Low | Q4's top-1 is `packages/bridge/src/shared` with ~4 parts; +380 chars is bounded; revert if AC-3 fails |
| `result-formatter.test.ts` is the first test file in `query/` to need fixture builders for IndexEntry | Low | Low | Use existing fixture pattern from `query-engine.test.ts`; if it's painful, inline minimal builders |
| 5-query benchmark is non-representative; SC-1 looks better than reality | Medium | Medium | Documented in PRD; query-mix disclosure required by AC-7; future expansion to 10 queries from SC-2 golden set is a follow-up |
| Voyage rate limits cause harness flakiness during Wave 3 reproduction | Low | Low | Already on paid tier; 5 queries × 1 embed each = trivial load |
| The "PRD's 39% included file reads" hypothesis is wrong — the actual gap is something else | Medium | Medium | Synthetic agent run (Wave 4) tests this. If wrong, the math number is still good and we've at least made top-1 results actionable |

---

## Decision-to-surface tracing (carried from council)

| Decision | Surface impact | Action |
|---|---|---|
| Engine top-1 enrichment | None — within frozen contract | No co-design |
| Regression harness check-in | None — script only | Force-add in Wave 3 |
| Falsification threshold | None | Update PRD 053 in Wave 5 |
| Synthetic agent validation | None — uses existing bridge tools | Run + document in Wave 4 |
| Future: search-strategy advisor | New MCP tool surface | `/fcd-surface` when scheduled (out of scope) |

---

## Open questions (not blocking)

1. **Exact `TOP_RESULT_TOTAL_BUDGET` value** — start at 1,800. Tune after Wave
   4 synthetic run if needed. Current measurement suggests 1,800 chars (~450
   tokens) gives the agent enough to act in 4 of 5 cases.
2. **Should `DocExtractor.MAX_EXCERPT` rise from 600 to 800?** Probably yes
   long-term, but separate change. Defer until Wave 4 shows excerpts hitting
   the 600-char ceiling.
3. **Should the harness move to `packages/fca-index/scripts/`?** Yes
   eventually, with an `npm run bench:sc1` script. Defer to a follow-up PR
   to keep this one focused.
4. **Should this PRD become formal PRD 056** in `docs/prds/`? Optional. The
   work can ship as a sub-task of PRD 053. Recommendation: promote only if
   the synthetic agent validation produces meaningful new findings worth
   their own PRD record.

---

## Council provenance

- Original proposal: `tmp/sc1-improvement-proposal-20260412.md`
- Council decision: `.method/sessions/fcd-debate-fca-index-sc1/decision.md`
- Cast: Oryn (domain), Sable (surface advocate), Vera (empirical skeptic),
  Rion (pragmatic), Lena (mediator)
- Surface inventory after debate: empty (zero co-design needed)
- This PRD is the formalized output of that decision.
