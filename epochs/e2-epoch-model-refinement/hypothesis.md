# E2 — Epoch Model Refinement

**Status:** active
**Started:** 2026-03-01

---

## Theme

The E1 epoch model is too narrow. It defined an epoch as a conjunctive proposition
("A AND B AND C must all be true") which works for tightly coupled hypotheses but
rules out the more common case: a batch of independent, parallel experiments that
go together because they share a concern area, not because their outcomes are logically
entangled.

The goal of E2 is to refine the epoch model into something that supports both patterns —
and to update CLAUDE.md and the epoch convention to reflect the refined model.

---

## Experiments

### H1 — Coherence Principle
**Hypothesis:** An epoch needs *some* grouping principle to be coherent, but that
principle does not have to be a logical proposition. A thematic area ("all of these
touch the methodology layer") is sufficient and more broadly useful than a conjunctive
proposition. The right model: an epoch is a **concern area** with a set of experiments
inside it. Experiments are independent by default; conjunctive dependencies are opt-in
and explicit.

**How we'll know:** We can write a CLAUDE.md epoch model that clearly distinguishes
a concern area from a proposition, and that covers all the grouping cases we've
encountered (E1 was effectively a thematic batch, not a conjunctive proposition).

---

### H2 — Directory and File Structure
**Hypothesis:** The current layout (`iterations/iN.md`) doesn't scale to multiple
parallel experiments. Moving to `experiments/hN-{slug}/` as the unit of work —
each with its own spec and iteration logs — gives the right granularity. The epoch
level holds the theme and the retrospective; the experiment level holds the
hypothesis and the methodology sessions.

**Proposed layout:**
```
epochs/eN-{slug}/
  hypothesis.md          — theme, list of experiments, acceptance criteria
  experiments/
    h1-{slug}/
      spec.md            — sub-hypothesis, chosen methodology, acceptance criteria
      i1.md, i2.md ...   — iteration logs for this experiment
    h2-{slug}/
      spec.md
      i1.md
  decision.md            — retrospective: what closed, what was learned, what carries forward
```

**How we'll know:** The E2 directory itself uses this layout. If it feels natural to
work in, the hypothesis holds.

---

### H3 — method-iteration.yaml scope
**Hypothesis:** `method-iteration.yaml` correctly sits at the **experiment** level —
one session per experiment, not one session per epoch. No changes needed to the
methodology itself. The epoch level is just a directory convention and a CLAUDE.md
rule, not a methodology session.

**How we'll know:** We can run E2's experiments using `method-iteration` without
modification and the phases map cleanly to experiment-level work.

---

### H4 — CLAUDE.md update
**Hypothesis:** The primal methodology in CLAUDE.md needs two changes:
1. Replace "hypothesis" (single proposition) with "theme + experiments" (concern area + parallel bets)
2. Clarify that `decision.md` is a retrospective (what closed, what carries forward)
   rather than a binary PASS/FAIL on a proposition

The five-step primal methodology stays intact; only the framing of what an epoch
*contains* changes.

**How we'll know:** After the update, CLAUDE.md reads coherently to a cold-start
agent who has never seen an epoch before.

---

## Acceptance Criteria

- [ ] CLAUDE.md updated with the refined epoch model — a cold-start agent can
      understand the difference between epoch (theme), experiment (hypothesis),
      and iteration (session) without additional explanation
- [ ] E2 itself uses the new `experiments/hN-{slug}/` layout, demonstrating
      the model in practice
- [ ] `method-iteration.yaml` assessed and verdict documented (H3) — either
      "no changes needed" or a specific change identified
- [ ] `decision.md` format updated to retrospective style

---

## Chosen Methodology

`method-iteration` — one session per experiment as hypotheses are resolved.

---

## Open Questions

1. Should experiments have a status field (proposed / active / closed) so it's
   clear at a glance which are still open?
2. What is the right stopping condition for an epoch? Options:
   - All experiments closed (strict)
   - Enough experiments closed to make the theme-level decision (flexible)
   - Time/effort bound (pragmatic)
3. Can an experiment be promoted to its own epoch if it grows larger than expected?
