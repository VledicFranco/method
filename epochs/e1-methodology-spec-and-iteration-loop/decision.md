# E1 Decision

**Status:** closed — stop
**Date:** 2026-03-01
**Session:** sess_36b06b9b2742 (method-iteration, 6 phases, delta 1.0, zero hard blocks)

---

## Decision: Stop

All 5 acceptance criteria from the hypothesis are closed.

| Criterion | Status |
|-----------|--------|
| CLAUDE.md documents the epoch model clearly enough for a cold-start agent | ✅ |
| Methodology Spec template exists in the repo (`docs/methodology-spec.yaml`) | ✅ |
| `method-iteration.yaml` loads cleanly and at least one test session completes end-to-end | ✅ |
| At least one iteration log exists (`iterations/i1.md`) | ✅ |
| `decision.md` written when the epoch closes | ✅ this file |

---

## What Was Built

- **Epoch infrastructure** — `epochs/` directory convention, `CLAUDE.md` primal methodology
- **`docs/methodology-spec.yaml`** — design-stage template for new methodologies
- **`src/methodologies/method-iteration.yaml`** — 6-phase product iteration loop
- **`method_reload` tool** — hot reload of methodology YAMLs without server restart
- **Field name fixes** — all phases of `goal-directed-loop` and 4 missing phases of `research-team` patched with explicit field name blocks
- **GitHub repo** — `VledicFranco/method`, private, initial commit + 3 subsequent commits

---

## What Was Learned

- The "Use these exact field names" block is load-bearing. Without it, agents need one failed attempt per phase to discover field names from error messages. All new methodology YAMLs must include it from the start.
- Hot reload via in-place Map mutation works cleanly — all tool handlers see the update immediately without re-registration.
- `method_start` uses `topic` not `goal` — the epoch hypothesis and CLAUDE.md used `goal`. Small naming friction, carried to E2 as a known issue.
- Soft invariant warning copy says `"required but missing"` — misleading for a soft invariant. Carried to E2.
- The self-referential session (using `method-iteration` to close `method-iteration`'s own epoch) worked without modification. The methodology is coherent enough to dogfood on its first real run.

---

## Open Issues Carried to E2

1. Soft warning copy: `"required but missing"` → should say something like `"not provided"` for soft invariants
2. `method_start` parameter named `topic` — CLAUDE.md and epoch hypothesis used `goal`, causes confusing error on first attempt

---

## Next Epoch Hypothesis (E2)

Semantic validation via `sampling/createMessage` — use an LLM-as-judge to evaluate soft invariants that require content judgment (e.g. "are these acceptance criteria actually checkable?"). This closes the gap between structural enforcement (what the MVP does) and meaningful quality gates.
