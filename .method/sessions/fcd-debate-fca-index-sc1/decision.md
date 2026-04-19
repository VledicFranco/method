---
type: council-decision
topic: "fca-index SC-1 improvement — top-1 result enrichment"
date: "2026-04-12"
cast: [Oryn, Sable, Vera, Rion, Lena]
surface_advocate: Sable
ports_identified: []
status: decided
---

# Decision: Engine-side top-1 enrichment + regression harness + falsification threshold

## Context

The original SC-1 improvement proposal (`tmp/sc1-improvement-proposal-20260412.md`)
recommended bumping excerpt limits in `formatContextQueryResult` (in `@methodts/mcp`)
from 120→400 chars on the top-1 result only. The council reviewed it and converged
on a structurally cleaner variant that puts the same change in the producer
(`@methodts/fca-index` query engine) instead of the consumer (the MCP formatter).

## What Was Decided

Replace the formatter-only fix with an engine-side change in
`packages/fca-index/src/query/query-engine.ts`:

1. After similarity search, the engine identifies entries[0] (top-1) and
   populates that result's `ComponentPart.excerpt` fields with up to ~500 chars
   per part (using existing `IndexEntry.parts[*].excerpt` data, which DocExtractor
   already populates up to 600 chars). Other entries pass through unchanged.
2. Bound by a `TOP_RESULT_MAX_CHARS = 1800` cap to prevent rich components from
   blowing up the result size.
3. The MCP formatter (`packages/mcp/src/context-tools.ts`) keeps defensive
   character caps but raises the top-1 limit to match.
4. Add the tool description nudge for `context_query` pointing agents at
   `context_detail` as the cheaper alternative to source file reads.

## Why the engine-side variant won (key arguments)

- **Composition theorem (Sable):** fixing the producer is worth more than fixing
  one consumer. Two consumers (MCP and CLI) and any future consumer (TUI,
  methodts integration) all benefit from the same change. The formatter-only
  variant only helps MCP.
- **Asymmetry belongs in the engine (Oryn):** the change is "the top-1 result is
  special and gets more characters." That's a query-shape decision, not a
  rendering decision. Rendering symmetry can be preserved if the data is right.
- **No port change needed (Sable, verified):** `ComponentPart.excerpt` is
  documented as "first ~500 chars of the most relevant section" in the frozen
  port file. Using more of that budget on top-1 is within the contract. No
  /fcd-surface session needed.

## Arguments against (acknowledged, not dismissed)

- **n=5 benchmark is too small (Vera):** five queries is not statistical proof.
  Same five queries the PRD used. No out-of-sample validation.
  *Mitigation:* falsification threshold (revert if 5-query total > 9,000 tokens
  on the same harness); future expansion to ~10 queries from SC-2 golden set.
- **"Agent will read fewer files" is hypothesis (Vera):** the harness measures
  what the tool returns, not what the agent does after.
  *Mitigation:* synthetic agent run as a follow-up commit in the same PR
  (n=3 per arm on Q1, count post-query Read calls).
- **TOP_RESULT_MAX_CHARS = 1800 is arbitrary (Oryn):** it's a guess. May need
  tuning after the synthetic run.
- **Q4 filename queries unsolved (Vera):** SC-1 is dragged up by Q4 (319%).
  Out of scope. PRD revision discloses the query mix (~80% concept / ~20%
  filename) so the headline number is interpretable.
- **Tool description nudge has weak empirical influence (Vera):** included
  anyway because cost is zero.

## Surface Implications (Sable, final)

- **New ports:** none.
- **Modified ports:** none. `ContextQueryPort`, `ContextQueryResult`,
  `ComponentContext`, `ComponentPart` all unchanged.
- **Entity types affected:** none.
- **Wave 0 items:** none.
- **Co-design sessions needed:** **zero**. This is the rare optimization that
  doesn't touch the contract — the data already flows, the engine just stops
  being symmetric about how much it returns per result.
- **Future co-design (out of scope):** when the search-strategy advisor (Strategy
  b from PRD 053) is built, it will need a new MCP tool surface — schedule a
  /fcd-surface session at that time.

## Acceptance criteria (revised, with falsification)

1. **5-query harness total ≤ 7,500 tokens (20% of grep baseline)** — primary target.
2. **Hard revert threshold: > 9,000 tokens (24%)** — if exceeded, revert and
   reconsider. This is the falsification clause Vera insisted on.
3. **SC-3 precision unchanged:** 80% strict / 100% loose on the same 5 queries.
4. **Q4 ratio not materially worsened:** ≤ 350%.
5. **All 6 fca-index architecture gates pass.**
6. **All 2 mcp architecture gates pass.**
7. **Synthetic agent validation:** at least one query (Q1) run end-to-end via
   bridge with old vs new MCP, n=3 per arm. Document `Read` tool call counts in
   PRD revision section.
8. **Harness checked in** to a runnable location (decision: leave in `tmp/` for
   the first PR, file a followup to move to `packages/fca-index/scripts/` or
   add an `npm run bench:sc1` entry).
9. **PRD 053 SC-1 revision section** updated with new measurement, falsification
   threshold, and query-mix disclosure.

## Decision-to-Surface tracing

| Decision | Surface impact | Action |
|---|---|---|
| Engine top-1 enrichment | None — within frozen contract | No co-design |
| Regression harness check-in | None — script only | Check in with PR |
| Falsification threshold | None | Update PRD 053 |
| Synthetic agent validation | None — uses existing bridge tools | Run + document in PRD |
| Future: search-strategy advisor | New MCP tool surface | `/fcd-surface` when scheduled |

## Open questions (unresolved, tracked)

- Exact `TOP_RESULT_MAX_CHARS` value — start at 1800, tune after synthetic run.
- Whether to also raise `DocExtractor.MAX_EXCERPT` from 600 to 800 — separate
  change, follow-up PR if synthetic run shows excerpts hitting the cap.
- Whether the harness should be a checked-in test or a script — leave in `tmp/`
  for now, decide after first PR.

## Cast notes

This is the third fca-index council session. Same cast (Oryn, Sable, Vera, Rion,
Lena) carried over from the 2026-04-08 and 2026-04-09 sessions. Sable's port
inventory stays at the existing 5 frozen ports; this decision adds nothing.
