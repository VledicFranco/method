---
type: realize-plan
prd: .method/sessions/fcd-design-sc1-top1-enrichment/prd.md
date: "2026-04-12"
status: draft
total_commissions: 2
total_waves: 3   # Wave 0 (empty), Wave 1 (parallel C-1+C-2), Wave 2 (orchestrator post-work)
---

# Realization Plan — fca-index SC-1 Top-1 Result Enrichment

## PRD Summary

**Objective:** Move PRD 053 SC-1 (token reduction) from the reported ~39% of grep
baseline toward the aspirational ≤20% target by enriching top-1 result excerpts
in the producer side of the fca-index query domain. The change is internal: no
new ports, no port modifications, no entity types affected. Council session
2026-04-12 (`.method/sessions/fcd-debate-fca-index-sc1/decision.md`) verified
zero shared-surface impact.

**Success criteria (PRD AC list):**
- AC-1: 5-query harness total ≤ 7,500 tokens (20% of 37,500 grep baseline)
- AC-2: hard revert threshold > 9,000 tokens (24%)
- AC-3: Q4 (filename query) ratio ≤ 350% — must not be materially worsened
- AC-4: SC-3 precision unchanged (80% strict / 100% loose)
- AC-5: synthetic agent validation on Q1, n=3 per arm, post-query Read counts
- AC-6: all 8 architecture gates pass (6 fca-index + 2 mcp)
- AC-7: PRD 053 SC-1 revision section updated

---

## FCA Partition

| Commission | Domain | Wave | Title | Depends On | Consumed Ports | Produced Ports |
|---|---|---|---|---|---|---|
| C-1 | `fca-index/query` | 1 | Per-rank excerpt budget in result-formatter | — | none | none |
| C-2 | `mcp/context-tools` | 1 | Top-1 multi-line render + tool description nudge | — | `ContextQueryPort` (frozen, unchanged) | none |

C-1 and C-2 are **independent** — they touch different packages with no shared
imports, no shared types, no shared constants. They can run in parallel as a
single wave.

**Orchestrator post-work** (between Wave 1 and Wave 2, then Wave 2 itself) is
NOT a commission — it spans `tmp/`, `docs/`, `.method/council/`, and
`.method/retros/`, none of which are FCA domains. It's listed in Wave 2 as
orchestrator tasks.

---

## Wave 0 — Shared Surfaces (Mandatory)

**EMPTY.**

This is the unusual case: the council explicitly verified that this PRD requires
zero new ports, zero modified ports, zero entity types, and zero `/fcd-surface`
sessions. The change is an internal optimization within the existing frozen
`ComponentPart.excerpt` "~500 chars" contract — using more of the budget on
top-1 results, less on others. Both producer and consumer changes stay within
the existing contract.

### Port interfaces — none
### Entity types — none
### Gate assertions — none
### Verification — none required

**Wave 0 gate status:** ⚠ FAIL (per the structural check "Wave 0 non-empty").

**Why this is acceptable for this specific PRD:**

The /fcd-plan skill's anti-capitulation rule #1 ("Never skip Wave 0") exists to
prevent implementation against unfrozen surfaces. The upstream /fcd-design
session already discharged that obligation by running a /fcd-debate council with
a Surface Advocate (Sable) who verified zero surface impact. Implementation does
not start against unfrozen surfaces because **there are no surfaces involved**.

This is not a workflow bypass — it is a true zero-surface PRD. The /fcd-plan
gate is failing on a check that was designed for the common case (most PRDs
have at least one shared surface). The user (PO) is informed and can choose to:

(a) Proceed with the empty Wave 0 as-is (recommended by the council).
(b) Reject the plan and ask for an alternative path (e.g., run the two
    commissions via two separate `/fcd-commission` solo invocations, skipping
    /fcd-plan entirely).

**Recommendation: proceed.** The plan is small (2 commissions in 1 wave plus
orchestrator post-work). The gate failure is honest signal, not a defect.

---

## Wave 1 — Implementation (parallel)

| Commission | Domain | Estimated tasks |
|---|---|---|
| C-1 | fca-index/query | 5 |
| C-2 | mcp/context-tools | 5 |

Both commissions can be commissioned simultaneously to two sub-agents. They have
no shared files, no shared constants, no import-time dependencies. The MCP
formatter's defensive caps (C-2) work correctly even if C-1 is not yet merged —
they just truncate excerpts to 120 chars as before.

---

## Wave 2 — Verification & Documentation (orchestrator post-work)

This wave is **not** commissioned to sub-agents. The orchestrator runs it
directly because each step touches multiple non-FCA paths (`tmp/`, `docs/`,
`.method/`) and the work is cross-cutting verification and documentation.

| Step | Owner | Action |
|---|---|---|
| 2.1 | orchestrator | Force-add `tmp/sc1-bench-harness.mjs` and `tmp/sc1-bench-output-20260412.txt` (baseline) |
| 2.2 | orchestrator | Re-run harness against patched code → `tmp/sc1-bench-output-after-20260413.txt` |
| 2.3 | orchestrator | Verify AC-1 (≤ 7,500 tokens), AC-2 (revert if > 9,000), AC-3 (Q4 ≤ 350%) |
| 2.4 | orchestrator | Synthetic agent run via bridge: 3 sessions on Q1 with old MCP, 3 with new MCP, count post-`context_query` `Read` calls (AC-5) |
| 2.5 | orchestrator | Verify AC-4 (SC-3 precision unchanged) by manual relevance check on the 5 queries |
| 2.6 | orchestrator | Update `docs/prds/053-fca-index-library.md` SC-1 revision section (AC-7) |
| 2.7 | orchestrator | Update `.method/council/memory/fca-index.yaml` — add 4th session entry, mark as implemented |
| 2.8 | orchestrator | Add retro to `.method/retros/retro-2026-04-13-NNN.yaml` |
| 2.9 | orchestrator | Open PR via `mcp__github-personal__create_pull_request` (personal repo — NOT `gh` CLI) |

---

## Commission Cards

### C-1 — Per-rank excerpt budget in result-formatter

```yaml
id: C-1
phase: "PRD Wave 1 (producer)"
title: "Per-rank excerpt budget in fca-index query result-formatter"
domain: "fca-index/query"
wave: 1
scope:
  allowed_paths:
    - "packages/fca-index/src/query/result-formatter.ts"
    - "packages/fca-index/src/query/result-formatter.test.ts"
  forbidden_paths:
    - "packages/fca-index/src/ports/**"          # frozen ports
    - "packages/fca-index/src/index.ts"          # barrel — orchestrator-owned
    - "packages/fca-index/src/index-store/**"    # other domain
    - "packages/fca-index/src/scanner/**"        # other domain
    - "packages/fca-index/src/coverage/**"       # other domain
    - "packages/fca-index/src/compliance/**"     # other domain
    - "packages/fca-index/src/cli/**"            # other domain
    - "packages/fca-index/src/testkit/**"        # not in scope
    - "packages/fca-index/src/factory.ts"        # composition root — orchestrator-owned
    - "packages/fca-index/src/architecture.test.ts"  # gate definitions — orchestrator-owned
    - "packages/fca-index/src/query/query-engine.ts"     # engine stays free of presentation
    - "packages/fca-index/src/query/component-detail-engine.ts"  # different concern
    - "packages/fca-index/package.json"          # orchestrator-owned
    - "packages/mcp/**"                           # other package, other commission
depends_on: []
parallel_with: [C-2]
consumed_ports: []  # uses internal IndexEntry only — no frozen port consumption
produced_ports: []  # internal change, no port surface
deliverables:
  - "packages/fca-index/src/query/result-formatter.ts: per-rank excerpt budget logic with TOP_RESULT_EXCERPT_PER_PART=500, TOP_RESULT_TOTAL_BUDGET=1800, REST_RESULT_EXCERPT_PER_PART=120 constants and trimParts helper"
  - "packages/fca-index/src/query/result-formatter.test.ts: 7 unit tests covering top-1 budget, total cap, non-top regression, pathological 8-part component, no-excerpt passthrough, single-result query, parts ordering"
documentation_deliverables: []  # no API surface change → no README update needed
acceptance_criteria:
  - "result-formatter unit tests pass (7 new cases) → PRD AC-6 (gates)"
  - "existing query-engine.test.ts still passes without modification → PRD AC-6 (no engine change)"
  - "existing query-engine.golden.test.ts still passes → PRD AC-4 (precision)"
  - "G-PORT-QUERY, G-BOUNDARY-DETAIL, G-LAYER all still pass → PRD AC-6"
  - "Top-1 excerpts in returned ComponentContext are ≤ 500 chars per part and ≤ 1800 chars total"
  - "Non-top results still cap at 120 chars per part (regression guard)"
estimated_tasks: 5
branch: "feat/053-sc1-top1-enrichment-c1-producer"
status: pending
```

**Tasks (estimate):**
1. Add constants `TOP_RESULT_EXCERPT_PER_PART`, `TOP_RESULT_TOTAL_BUDGET`, `REST_RESULT_EXCERPT_PER_PART` to `result-formatter.ts`.
2. Implement `trimParts(parts, isTop)` helper following PRD §Per-Domain Architecture / Domain 1 sketch.
3. Modify `ResultFormatter.format()` to call `trimParts(entry.parts, i === 0)` and assign result.
4. Create `result-formatter.test.ts` with 7 unit cases. Use `IndexEntry` fixture builder pattern from `query-engine.test.ts` if one exists; otherwise inline minimal builder.
5. Run `npm test --workspace=@methodts/fca-index`. Verify all fca-index tests and all 6 fca-index gates pass.

**FCA / DR compliance notes:**
- DR-04 satisfied: presentation-shaping logic (per-rank trim) lives in the domain
  package (`fca-index/query`), NOT in the MCP wrapper. This is exactly what
  DR-04 mandates ("conditional logic that changes behavior based on input
  content must be in the domain package").
- DR-09 satisfied: tests use real fixtures (IndexEntry shape from existing tests).
- G-PORT-QUERY satisfied: result-formatter does not import any HTTP client.
- G-BOUNDARY-DETAIL satisfied: result-formatter does not import from cli/ or @methodts/mcp.
- G-LAYER satisfied: result-formatter does not import from @methodts/mcp or @methodts/bridge.

---

### C-2 — Top-1 multi-line render + tool description nudge

```yaml
id: C-2
phase: "PRD Wave 1 (consumer)"
title: "MCP top-1 multi-line render and context_query tool description nudge"
domain: "mcp/context-tools"
wave: 1
scope:
  allowed_paths:
    - "packages/mcp/src/context-tools.ts"
    - "packages/mcp/src/context-tools.test.ts"
  forbidden_paths:
    - "packages/mcp/src/index.ts"                # barrel — orchestrator-owned
    - "packages/mcp/src/bridge-tools.ts"         # other tool family
    - "packages/mcp/src/experiment-tools.ts"     # other tool family
    - "packages/mcp/src/theory.ts"               # different concern
    - "packages/mcp/src/schemas.ts"              # different concern
    - "packages/mcp/src/validate-project-access.ts"  # different concern
    - "packages/mcp/src/architecture.test.ts"    # gate definitions — orchestrator-owned
    - "packages/mcp/package.json"                # orchestrator-owned
    - "packages/fca-index/**"                    # other package, other commission
    - "packages/bridge/**"                       # forbidden by layer
    - "packages/methodts/**"                     # different concern
depends_on: []
parallel_with: [C-1]
consumed_ports:
  - name: "ContextQueryPort"
    status: frozen
    frozen_date: "2026-04-08"
    record: ".method/sessions/fcd-surface-fca-index-mcp/record.md"
    note: "consumed unchanged — MCP reads ContextQueryResult and renders it"
  - name: "ComponentDetailPort"
    status: frozen
    frozen_date: "2026-04-09"
    record: ".method/sessions/fcd-surface-component-detail/record.md"
    note: "consumed unchanged — referenced in tool description nudge but not modified"
produced_ports: []
deliverables:
  - "packages/mcp/src/context-tools.ts: formatContextQueryResult uses TOP_EXCERPT_RENDER_LIMIT=500 / TOP_TOTAL_RENDER_LIMIT=1800 / REST_EXCERPT_RENDER_LIMIT=120 with isTop-aware multi-line rendering for top-1"
  - "packages/mcp/src/context-tools.ts: context_query tool description updated with one-sentence nudge pointing agents at context_detail"
  - "packages/mcp/src/context-tools.test.ts: 5 new test cases (top-1 multi-line | prefix, top-1 total ≤ 1800, non-top single-line > prefix ≤ 120, fixture token count ≤ 1500, empty/missing excerpt clean)"
documentation_deliverables: []
acceptance_criteria:
  - "context-tools.test.ts new cases pass → PRD AC-6"
  - "Both mcp architecture gates pass → PRD AC-6"
  - "Existing context-tools tests still pass (regression guard for non-top behavior) → PRD AC-6"
  - "End-to-end fixture rendering ≤ 1500 tokens → PRD AC-1 contributor"
  - "Top-1 excerpt rendering preserves newlines via | prefix; non-top stays on single-line > prefix"
estimated_tasks: 5
branch: "feat/053-sc1-top1-enrichment-c2-consumer"
status: pending
```

**Tasks (estimate):**
1. Replace hardcoded `120` in `formatContextQueryResult` with named constants `TOP_EXCERPT_RENDER_LIMIT`, `TOP_TOTAL_RENDER_LIMIT`, `REST_EXCERPT_RENDER_LIMIT`.
2. Add `isTop` branch in the part-rendering loop with multi-line `|`-prefix handling and total-budget tracking.
3. Update `CONTEXT_TOOLS[0].description` (the `context_query` entry) with the nudge sentence.
4. Add 5 new test cases to `context-tools.test.ts` covering the cases listed in the deliverables.
5. Run `npm test --workspace=@methodts/mcp`. Verify all mcp tests and both mcp gates pass.

**FCA / DR compliance notes:**
- DR-04 boundary: this commission ONLY changes presentation/format. The
  conditional logic (`isTop` branch) is technically a content-based decision,
  but it is presentation shaping — equivalent to "render the top result with
  more emphasis." The domain logic for *which* result is top lives in C-1
  (and ultimately in the embedding similarity ranker). C-2 only renders the
  top differently.
  *Council justification:* the "engine variant" the council picked is
  implemented inside `fca-index/query` (C-1). C-2's render-time differentiation
  is a defensive cap, not business logic.
- The mcp domain has its own architecture.test.ts gates; this commission must
  not import from `@methodts/fca-index/dist/...` directly (must use the public
  exports only).

---

## Acceptance Gates (PRD criteria → commission mapping)

| PRD AC | Description | Verified by |
|---|---|---|
| AC-1 | 5-query harness total ≤ 7,500 tokens | Wave 2 step 2.3 (after both commissions merged) |
| AC-2 | Hard revert threshold > 9,000 tokens | Wave 2 step 2.3 |
| AC-3 | Q4 ratio ≤ 350% | Wave 2 step 2.3 |
| AC-4 | SC-3 precision unchanged | C-1 (golden test) + Wave 2 step 2.5 |
| AC-5 | Synthetic agent validation | Wave 2 step 2.4 |
| AC-6 | All 8 architecture gates pass | C-1 + C-2 + Wave 2 step 2.3 |
| AC-7 | PRD 053 SC-1 revision section updated | Wave 2 step 2.6 |

Every PRD AC has at least one verifying commission or wave step. **PRD coverage: complete.**

---

## Verification Report

| Gate | Status | Notes |
|---|---|---|
| Single-domain commissions | PASS | C-1 in `fca-index/query`, C-2 in `mcp/context-tools` — exactly one domain each |
| No wave domain conflicts | PASS | Wave 1's two commissions are in different packages and different domains |
| DAG acyclic | PASS | C-1 and C-2 have no dependencies; orchestrator wave 2 depends on both |
| Surfaces enumerated | PASS | 0 cross-commission surfaces; both commissions are independent. No port modifications. ContextQueryPort consumed unchanged |
| Scope complete | PASS | Both commissions have non-empty allowed + forbidden paths |
| Criteria traceable | PASS | Every commission AC traces to PRD AC-1 through AC-7 |
| PRD coverage | PASS | All 7 PRD ACs mapped to at least one commission or orchestrator wave step |
| Task count bounds | PASS | C-1: 5 tasks, C-2: 5 tasks (both in 3-8 range) |
| **Wave 0 non-empty** | **FAIL** | Wave 0 is empty — see §Wave 0 explanation. This is a true zero-surface PRD verified by the council. PO informed |
| All consumed ports frozen | PASS | C-2 consumes `ContextQueryPort` (frozen 2026-04-08) and `ComponentDetailPort` (frozen 2026-04-09), both unchanged. C-1 consumes no frozen ports (uses internal IndexEntry shape only) |

**Overall: 9/10 gates pass.**

The single failing gate (Wave 0 non-empty) is explained in §Wave 0. The
upstream /fcd-design + /fcd-debate cycle discharged the surface obligation
correctly. Recommend PO override of this gate for this specific PRD.

---

## Risk Assessment (carried from PRD)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Top-1 component with many parts blows past 1800-char cap | Medium | Low | Hard cap enforced in both C-1 and C-2; pathological-case test in C-1 |
| Multi-line `\|`-prefix rendering breaks downstream parsers | Low | Medium | C-2 regression guard test verifies non-top stays on `>` prefix |
| Agents continue to read source files (habit unchanged) | Medium | Low | Math alone hits target; AC-5 synthetic run is informational, not blocking |
| Q4 ratio worsens past 350% | Low | Low | AC-3 in Wave 2 step 2.3; revert if exceeded |
| 5-query benchmark non-representative | Medium | Medium | AC-7 mandates query-mix disclosure in PRD update |
| Voyage rate limits flake the harness | Low | Low | Already on paid tier, 5 embeds total |
| "Agent files reads were the gap" hypothesis is wrong | Medium | Medium | AC-5 tests this; even if wrong, math number stands |

**Critical path:** C-1 → Wave 2 → PR. C-2 runs in parallel with C-1. Estimated
total wall time (single orchestrator): C-1 ~30 min, C-2 ~25 min (parallel), Wave 2
~45 min (sequential), ~75 min total.

---

## Status Tracker

```
Total commissions: 2 (C-1, C-2)
Total waves: 3 (Wave 0 empty, Wave 1 implementation, Wave 2 orchestrator)
Completed: 0 / 2

Wave 0: ∅ (empty by design)
Wave 1: pending (C-1, C-2 — parallelizable)
Wave 2: pending (orchestrator post-work, depends on Wave 1)
```

---

## Next Action

**Recommended:** Execute Wave 1 with `/fcd-commission --orchestrate <this-plan-path>`
to spawn C-1 and C-2 as two parallel sub-agents.

**Alternative (smaller blast radius):** Run C-1 and C-2 as two separate solo
`/fcd-commission` invocations from the main orchestrator agent. This keeps
context cleaner if you want to review each commission's diff before the next
one starts.

**Recommendation:** alternative (sequential solo). The two commissions are so
small (~5 tasks each) that the orchestration overhead of parallel sub-agents
exceeds the savings. Run C-1 first, verify gates green, then C-2, then Wave 2.

---

## Council provenance

- PRD: `.method/sessions/fcd-design-sc1-top1-enrichment/prd.md`
- Council decision: `.method/sessions/fcd-debate-fca-index-sc1/decision.md`
- Surface inventory: empty (verified by Sable on 2026-04-12)
- Cast: Oryn, Sable, Vera, Rion, Lena
