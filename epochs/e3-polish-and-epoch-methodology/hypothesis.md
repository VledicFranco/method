# E3 — Polish + Epoch-Methodology as First-Class MCP Artifact

**Status:** active
**Started:** 2026-03-01

---

## Theme

Two concerns in one epoch:

1. **Polish** — three small known issues from E1/E2 that don't merit their own epoch
   but have been accumulating. Clear them.

2. **Epoch-methodology** — the primal methodology (CLAUDE.md prose) becomes a
   first-class MCP artifact: two YAML methodologies (`epoch-open`, `epoch-close`)
   that enforce the quality of epoch boundaries. Once live, the epoch lifecycle is
   enforced by the same mechanism that enforces research and iteration sessions.
   The epoch-methodology can itself be evolved through epochs — self-referential,
   but mechanically identical to evolving any other methodology.

---

## Experiments

### H1 — Soft Invariant Copy Fix
**Hypothesis:** Changing the soft invariant failure description from
`"X is required but missing"` to `"X was not provided"` (or similar) removes
the misleading "required" language for non-blocking invariants.

**Where:** `src/runtime/validator.ts` — the message generated when a soft
invariant fires.

**How we'll know:** After the fix, `soft_warnings` entries no longer say "required"
for fields that are explicitly optional. A test session through `test-gates` Phase 3
confirms the new wording.

---

### H2 — `topic` vs `goal` Naming
**Hypothesis:** The friction is real but the fix is documentation, not a rename.
Renaming `topic` → `goal` in `method_start` is a breaking change to the tool
interface; updating CLAUDE.md and the epoch hypothesis template to say `topic`
is cheaper and correct.

**Alternatively:** If renaming is cleaner, it touches `start.ts`, `.mcp.json.example`,
README, and CLAUDE.md — worth doing if the experiment concludes the rename
is the right call.

**How we'll know:** After the fix (whichever direction), CLAUDE.md and
`method_start`'s parameter are consistent. A cold-start agent wouldn't hit
the mismatch.

---

### H3 — `method-iteration` Phase 0 Guidance Wording
**Hypothesis:** The `epoch_criteria_open` field description in Phase 0 of
`method-iteration.yaml` says "acceptance criteria from the active epoch" but
should reference the **experiment's** own acceptance criteria, since
`method-iteration` operates at the experiment level.

**How we'll know:** After the fix, a fresh `method-iteration` session's Phase 0
guidance and field description no longer reference "epoch" in a way that implies
the whole epoch's criteria, only the current experiment's.

---

### H4 — Epoch-Methodology: Two Ceremonies as MCP Methodologies
**Hypothesis:** Encoding the epoch lifecycle as two enforced YAML methodologies
(`epoch-open` and `epoch-close`) produces better epoch artifacts than the current
prose-guided process. An agent running `epoch-open` at the start of an epoch
cannot advance without a well-formed theme, a list of experiments with specs,
and measurable acceptance criteria. An agent running `epoch-close` cannot advance
without documenting outcomes per experiment, a retrospective, and a next-epoch
proposal.

**Two methodologies, not one**, because epoch opening and closing are separate
ceremonies separated by days or weeks. Sessions are in-memory — a single session
cannot span an epoch. Each ceremony is a short, focused session that produces one
epoch-level document.

**`epoch-open` (3 phases):**
- Phase 0: Theme — state the concern area, why it warrants an epoch, what a
  successful epoch looks like
- Phase 1: Experiments — spec each sub-hypothesis: what it tests, how we'll know,
  which methodology runs it, any explicit dependencies
- Phase 2: Commit — set epoch acceptance criteria, note stopping condition,
  produce the `hypothesis.md` content

**`epoch-close` (3 phases):**
- Phase 0: Experiment Outcomes — for each experiment in the epoch, state its
  status (closed/open) and what was learned or why it's still open
- Phase 1: Retrospective — what the epoch taught overall, what was surprising,
  what the known issues are
- Phase 2: Forward — carry-forward items with dispositions, next epoch proposal

**The self-referential property:** `epoch-open.yaml` and `epoch-close.yaml` are
methodology files like any other. They can be the subject of experiments in a
future epoch — an experiment whose output is a refined `epoch-open.yaml` is
structurally identical to any other methodology-type experiment. The epoch
process can evolve itself through the same mechanism it uses to evolve everything else.

**How we'll know:** E3 itself closes using `epoch-close`. If `epoch-close` produces
a coherent retrospective without requiring extra prose outside the session output,
the hypothesis holds. A second validation: E4 opens using `epoch-open`.

---

### H5 — Semantic Validation: `sampling/createMessage` as LLM-as-Judge
**Hypothesis:** `sampling/createMessage` can be used to evaluate content-level
invariants that structural validation cannot catch — specifically whether acceptance
criteria are actually falsifiable and whether rationales genuinely reference
specific criteria. This closes the gap between structural enforcement (what the
MVP does) and meaningful quality gates.

**Scope for E3:** Design only — define the YAML schema for semantic invariants,
specify the judge prompt template, and assess the sampling API surface. Implementation
promoted to E4 if the design takes more than one iteration.

**How we'll know (design phase):** A complete spec exists for:
  - How semantic invariants are declared in phase YAML
  - What the judge prompt template looks like
  - How pass/fail maps to advancement vs. block
  - What the latency and cost implications are

**Promotion condition:** If the design spawns implementation questions that need
their own experiment, H5 promotes to E4 rather than blocking E3.

---

## Epoch Acceptance Criteria

- [ ] H1, H2, H3 all closed — no known polish issues outstanding from E1/E2
- [ ] `epoch-open.yaml` and `epoch-close.yaml` implemented, loaded, and validated
      (E3 closes using `epoch-close`; E4 opens using `epoch-open`)
- [ ] H5 produces at minimum a complete design spec, even if implementation is E4

---

## Open Questions

1. Should `epoch-open` Phase 2 output be structured enough that the server could
   auto-generate `hypothesis.md` from the session output? Or is the session output
   just guidance for the human to write it?

2. `epoch-close` Phase 0 asks the agent to enumerate experiment outcomes. Where
   does it get this information? From memory (unreliable) or from reading the
   experiment directories first (requires file access)? Should the phase guidance
   explicitly tell the agent to read `experiments/*/decision.md` before submitting?

3. What is the right level of strictness for `epoch-open` Phase 1? Should each
   experiment spec be a required structured field (array of objects with `hypothesis`,
   `methodology`, `how_well_know` keys), or a free-form string list?
