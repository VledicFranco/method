# method — Development Instructions

## Project

`method` is an MCP server that enforces cognitive methodologies at runtime.
Four tools: `method_list`, `method_start`, `method_advance`, `method_status`, `method_reload`.
Methodologies are YAML files in `src/methodologies/`. See README.md for full architecture.

## MCP Configuration

Copy `.mcp.json.example` to `.mcp.json` and set the absolute path to `src/index.ts`.
After adding or modifying a methodology YAML, call `method_reload` — no server restart needed.

---

## Development Model — Epochs

`method` evolves through **epochs**: bounded batches of related experiments. Work is
organized at three levels:

- **Epoch** — a concern area: a loosely themed batch of experiments. Opens with a
  theme and a list of sub-hypotheses. Closes with a retrospective.
- **Experiment** — a falsifiable hypothesis within the epoch theme. Runs independently.
  Has its own spec, iteration logs, and decision.
- **Iteration** — a `method-iteration` session that advances an experiment one step.

### The Primal Methodology

1. **Open an epoch** — write `epochs/eN-{slug}/hypothesis.md`. State the theme and
   list the experiments (sub-hypotheses) to run. Experiments are independent by default;
   note explicit dependencies in `spec.md` if needed.

2. **Run experiments** — for each experiment, create `experiments/hN-{slug}/spec.md`
   with the hypothesis and "how we'll know" criterion. Use `method-iteration` to
   structure the work. Log each session to `iN.md`.

3. **Close experiments** — write `experiments/hN-{slug}/decision.md` when the
   hypothesis is resolved (confirmed, refuted, or superseded). State what was learned.

4. **Close the epoch** — write `epochs/eN-{slug}/decision.md` when enough experiments
   are resolved to write a coherent retrospective. Not all experiments need to be closed —
   each open one needs a disposition: deferred to E(N+1), promoted to its own epoch,
   or superseded.

5. **Open next epoch** — the epoch `decision.md` ends with a proposed next theme
   or a note that the concern area is complete.

### Rules

- One active epoch at a time.
- Experiment hypotheses must be falsifiable — a vague hypothesis is not a hypothesis.
- **Promotion rule:** an experiment that needs more than ~3 iterations, or that spawns
  sub-questions of its own, promotes to its own epoch. Mark it `→ promoted to E(N+1)`
  in its `decision.md`.
- **Stopping condition:** close the epoch when you can write a coherent retrospective —
  not necessarily when every experiment is closed.
- Epoch `decision.md` is a **retrospective**, not a verdict. It answers: what closed,
  what was learned, what carries forward, what's next.

### Status via File Presence

No explicit status fields — directory structure is truth:

| Files present | Status |
|---|---|
| `spec.md` only | proposed |
| `spec.md` + at least one `iN.md` | active |
| `spec.md` + `decision.md` | closed |

### Epoch Directory Layout

```
epochs/
  eN-{slug}/
    hypothesis.md           — theme + list of experiments + epoch acceptance criteria
    experiments/
      h1-{slug}/
        spec.md             — hypothesis, how we'll know, chosen methodology
        i1.md, i2.md ...    — one log per method-iteration session
        decision.md         — written when experiment closes
      h2-{slug}/
        ...
    decision.md             — retrospective, written when epoch closes
```

---

## Methodology Specs

When an experiment's work includes designing a new methodology, write a **Methodology Spec**
before implementing the YAML. The spec answers: why this methodology, what cognitive model
grounds it, what phases produce what output, and how we validate it in real sessions.

Template: `docs/methodology-spec.yaml`. See `epochs/e1-*/` for the first example.
