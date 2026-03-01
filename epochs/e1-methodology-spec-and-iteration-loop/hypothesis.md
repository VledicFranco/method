# E1 — Methodology Spec Format + Iteration Loop

**Status:** active
**Started:** 2026-03-01

---

## Hypothesis

> Without a formal iteration structure, `method`'s development is ad-hoc: changes happen
> without clear hypotheses, acceptance criteria, or documented outcomes. The combination of
> (a) an epoch model, (b) a Methodology Spec format for designing methodologies before
> implementing them, and (c) a `method-iteration` methodology will make development
> intentional, measurable, and self-improving.
>
> Specific bet: having a spec format will reduce the gap between "idea for a new methodology"
> and "validated YAML in production" by surfacing field name decisions, invariant choices,
> and acceptance criteria before they're hard to change.

---

## Deliverables

1. **Epoch infrastructure** — `epochs/` directory, `CLAUDE.md` primal methodology
2. **Methodology Spec template** — a YAML template with design-stage fields (`motivation`,
   `cognitive_model`, `acceptance_criteria`, `open_questions`) that precede a runtime YAML
3. **`method-iteration.yaml`** — a methodology that structures product iteration sessions:
   context loading → objective setting → design → implementation → validation → decide

---

## Chosen Methodology

**`goal-directed-loop`** — since `method-iteration.yaml` doesn't exist yet (it's the output
of this epoch), we bootstrap with the base loop. Once `method-iteration.yaml` is validated,
future epochs will use it instead.

---

## Acceptance Criteria

- [ ] `CLAUDE.md` documents the epoch model clearly enough that a cold-start agent can
      propose and run an epoch without additional explanation
- [ ] A Methodology Spec template file exists in the repo
- [ ] `src/methodologies/method-iteration.yaml` exists, loads cleanly in the server (`method_list`
      returns it), and at least one test session completes successfully end-to-end
- [ ] e1 has at least one iteration log documenting real work done
- [ ] `decision.md` is written when the epoch closes

---

## Open Questions

1. Where should the Methodology Spec template live? Options: `docs/`, root-level
   `METHODOLOGY-SPEC.md`, or inline in CLAUDE.md.

2. Should `method-iteration.yaml` handle both methodology work and infrastructure work
   in the same phases (conditional via soft invariants on a `change_type` field), or
   should it be two separate methodologies?

3. How many phases is right for `method-iteration`? Current sketch: context loading →
   objective setting → design → implementation → validation → decide (6 phases). Is that
   too much overhead for small iterations?

4. Should the Methodology Spec be YAML or Markdown? YAML maps more cleanly to the
   implementation artifact; Markdown is more writable during early design.
