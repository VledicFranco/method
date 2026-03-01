# E2 Decision — Retrospective

**Status:** closed
**Date:** 2026-03-01

---

## What Closed

All 4 experiments confirmed:

| Experiment | Verdict | Key outcome |
|---|---|---|
| H1 — Coherence principle | ✅ Confirmed | Thematic area is the right default; conjunctive dependency is opt-in |
| H2 — Directory structure | ✅ Confirmed | `experiments/hN-{slug}/` layout validated by E2 using it |
| H3 — method-iteration scope | ✅ Confirmed | No structural changes needed; minor Phase 0 wording fix noted |
| H4 — CLAUDE.md update | ✅ Confirmed | Three-level vocabulary, retrospective framing, stopping condition, promotion rule |

---

## What Was Learned

- The conjunctive proposition model (E1's implicit framing) was too restrictive.
  Thematic batching is the common case; conjunctive dependency is a special case
  worth naming only when it actually exists.

- Self-validation (H2 using its own proposed layout) is a useful experiment design
  pattern. If the thing you're proposing can test itself, run it that way.

- The three-level vocabulary (epoch / experiment / iteration) makes the mental model
  explicit in a way that "epoch" alone didn't. The levels have different artifacts,
  different granularity, and different lifecycles.

- Status via file presence is cleaner than status fields. The directory IS the manifest.

---

## Known Issues Carried Forward

- `method-iteration.yaml` Phase 0 guidance says "epoch_criteria_open" but should
  reference the experiment's own acceptance criteria. Minor wording fix, not structural.
- Soft invariant copy: "required but missing" (from E1) still unaddressed.
- `method_start` uses `topic` not `goal` (from E1) still unaddressed.

These three small fixes belong together in a polish epoch.

---

## Next

**E3 — Polish and semantic validation**

Two threads:
- **Polish:** fix the three known issues above (soft warning copy, topic/goal naming,
  Phase 0 guidance wording) — small, independent, perfect for the new multi-experiment format
- **Semantic validation:** design and prototype `sampling/createMessage` as LLM-as-judge
  for content-level invariants — the E1 E2 hypothesis that's been waiting
