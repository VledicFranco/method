# method — Development Instructions

## Project

`method` is an MCP server that enforces cognitive methodologies at runtime.
Four tools: `method_list`, `method_start`, `method_advance`, `method_status`.
Methodologies are YAML files in `src/methodologies/`. See README.md for full architecture.

## MCP Configuration

Copy `.mcp.json.example` to `.mcp.json` and set the absolute path to `src/index.ts`.

---

## Development Model — Epochs

`method` evolves through **epochs**: bounded, hypothesis-driven product iterations.
All product work happens inside an epoch. Before writing any code or YAML, an epoch must exist.

### The Primal Methodology

1. **Propose** — write `epochs/eN-{slug}/hypothesis.md`. State: what bet are we making, why, and how we'll know if it worked. Acceptance criteria must be checkable — each one is either satisfied or it isn't.
2. **Choose a methodology** — every epoch names a methodology from `src/methodologies/` that will structure its work. If no methodology fits, designing one is the first deliverable of the epoch.
3. **Run iterations** — follow the chosen methodology. Log each iteration to `epochs/eN-{slug}/iterations/iN.md`: what was done, what was learned, delta update against acceptance criteria.
4. **Decide** — write `epochs/eN-{slug}/decision.md` when acceptance criteria are sufficiently closed. Stop (ship, move on) or continue (another iteration). Rationale must reference specific criteria.
5. **Propose next** — new epoch begins with a fresh hypothesis.

### Rules

- One active epoch at a time.
- The hypothesis must be falsifiable. A vague hypothesis is not a hypothesis.
- `decision.md` is written when the epoch closes, not before.
- Epochs are numbered sequentially: `e1-`, `e2-`, `e3-`, ...

### Epoch Directory Layout

```
epochs/
  eN-{slug}/
    hypothesis.md       — bet, deliverables, chosen methodology, acceptance criteria, status
    iterations/
      i1.md             — what was done, what was learned, delta update
      i2.md
      ...
    decision.md         — written at close: stop/continue + rationale referencing criteria
```

---

## Methodology Specs

When an epoch includes designing a new methodology, write a **Methodology Spec** before implementing the YAML. The spec is the design-stage artifact — it adds fields that don't survive into the runtime YAML but are essential during design:

- `motivation` — what cognitive failure mode or product gap this closes
- `cognitive_model` — which framework grounds the phase design (TOTE, Zimmerman, Argyris, Cognitive Team, etc.)
- `acceptance_criteria` — how we know the methodology works in real LLM sessions, not just that it type-checks
- `open_questions` — things to resolve before committing to YAML

The Methodology Spec maps 1:1 to the YAML it becomes. Writing it first surfaces field name decisions, invariant choices, and validation criteria before they're hard to change.

See `epochs/e1-methodology-spec-and-iteration-loop/` for the first example.
