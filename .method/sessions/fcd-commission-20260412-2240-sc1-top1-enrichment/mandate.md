# Mandate — fca-index SC-1 Top-1 Enrichment (consolidated)

**Date:** 2026-04-12
**PRD:** `.method/sessions/fcd-design-sc1-top1-enrichment/prd.md`
**Plan:** `.method/sessions/fcd-plan-20260412-2230-sc1-top1-enrichment/realize-plan.md`
**Council:** `.method/sessions/fcd-debate-fca-index-sc1/decision.md`
**Mode:** consolidated solo — single branch, single PR, two domains
**Branch:** `feat/053-sc1-top1-enrichment`
**Iteration counter:** 0 / 5

## User directive (this commission)

> Fire commissions until the PRD is validated, documented, there is good
> observability and we have a single PR consolidated.

Interpretation:
- **Validated:** all 7 PRD ACs satisfied (or honest gap documented for AC-5)
- **Documented:** PRD 053 SC-1 revision section updated; council memory updated; retro filed
- **Observability:** harness checked in and re-runnable; before/after numbers
  stored as evidence; per-query token attribution preserved in tmp/
- **Single PR consolidated:** one branch, one PR — NOT two separate commission PRs

## Domain scope

This commission spans **two FCA domains** (against the usual "one domain per
commission" rule). The user's "single PR consolidated" requirement supersedes
that convention. Both domains are inside `@methodts/fca-index` and `@methodts/mcp`
respectively. Cross-domain risk is low because:
- C-1 (fca-index/query) and C-2 (mcp/context-tools) have no shared imports.
- The change in each domain is small (~50 LoC + tests).
- Both consume only frozen ports that aren't being modified.

If issues arise, the work will be split into two commits inside the same PR.

## Phase 0 — Port-freeze pre-check

### Consumed ports

| Port | Status | Frozen | Record | Action |
|---|---|---|---|---|
| `ContextQueryPort` (used by C-2) | frozen | 2026-04-08 | `.method/sessions/fcd-surface-fca-index-mcp/record.md` | PASS — consumed unchanged |
| `ComponentDetailPort` (referenced by C-2 nudge text) | frozen | 2026-04-09 | `.method/sessions/fcd-surface-component-detail/record.md` | PASS — consumed unchanged |
| `IndexEntry` shape (used by C-1) | internal type | n/a | `packages/fca-index/src/ports/internal/index-store.ts` | PASS — internal type, not a frozen port |

### Produced ports

None. This commission produces no new ports and modifies no existing ones.

### Phase 0 result

✅ **PASS.** All consumed ports are frozen. No BLOCKED ports. No `/fcd-surface`
session needed. Proceeding to Phase A.

## Out-of-scope (do NOT touch)

- `packages/method-ctl/bin/method-ctl.js` — pre-existing uncommitted change
  from another work session. Not my work. Must stay out of this branch and
  this PR.
- `packages/fca-index/src/ports/**` — frozen ports.
- `packages/fca-index/src/index.ts` — barrel.
- `packages/fca-index/src/architecture.test.ts` — gate definitions.
- `packages/fca-index/src/query/query-engine.ts` — engine stays free of
  presentation concerns per council decision.
- `packages/fca-index/src/index-store/**`, `scanner/**`, `coverage/**`,
  `compliance/**`, `cli/**`, `testkit/**` — other domains.
- `packages/mcp/src/architecture.test.ts` — gate definitions.
- `packages/mcp/src/{bridge-tools,experiment-tools,theory,schemas,validate-project-access}.ts` — different concerns.
- `packages/mcp/src/index.ts` — barrel.
- `packages/methodts/**`, `packages/bridge/**` — other layers.
- `registry/**`, `theory/**` — registry artifacts.
- `.method/project-card.yaml`, `.method/council/` outside of fca-index.yaml — governance.

## In-scope (allowed to modify)

- `packages/fca-index/src/query/result-formatter.ts`
- `packages/fca-index/src/query/result-formatter.test.ts` (NEW)
- `packages/mcp/src/context-tools.ts`
- `packages/mcp/src/context-tools.test.ts`
- `tmp/sc1-bench-harness.mjs` (force-add)
- `tmp/sc1-bench-output-20260412.txt` (baseline, force-add)
- `tmp/sc1-bench-output-after.txt` (NEW)
- `tmp/sc1-agent-validation-20260413.md` (NEW, optional — bridge-dependent)
- `docs/prds/053-fca-index-library.md` (SC-1 revision section)
- `.method/council/memory/fca-index.yaml` (already modified — finalize entry)
- `.method/retros/retro-2026-04-13-NNN.yaml` (NEW)
- `.method/sessions/fcd-commission-20260412-2240-sc1-top1-enrichment/` (this dir)

## Order of operations

1. Create branch `feat/053-sc1-top1-enrichment`
2. C-1: implement result-formatter changes + tests
3. Run fca-index test suite, verify all 6 fca-index gates pass
4. C-2: implement mcp formatter changes + tests
5. Run mcp test suite, verify both mcp gates pass
6. Re-run sc1-bench-harness.mjs against patched code
7. Verify ACs: AC-1 (≤ 7,500), AC-2 (revert if > 9,000), AC-3 (Q4 ≤ 350%), AC-6 (gates)
8. AC-5 synthetic agent run — bridge-dependent. Document either result or skip with reason.
9. AC-4 manual precision check on the 5 queries
10. Update docs/prds/053 SC-1 revision section
11. Update .method/council/memory/fca-index.yaml
12. Add retro
13. Force-add tmp/ artifacts (harness, before, after)
14. Single commit (or 2-3 logical commits)
15. Open consolidated PR

## Acceptance gate (commission-level)

- All 7 PRD ACs satisfied OR explicitly waived in PR body with reason
- All 8 architecture gates pass
- 5-query bench total ≤ 7,500 tokens
- Q4 ≤ 350%
- PR open, CI green, single branch
