# H4 — Epoch-Methodology: Two Ceremonies as MCP Methodologies

**Hypothesis:** Encoding the epoch lifecycle as two YAML methodologies (`epoch-open`
and `epoch-close`) produces better epoch artifacts than the current prose-guided
process. An agent running `epoch-open` cannot advance without a well-formed theme,
experiment specs with measurable criteria, and a stopping condition. An agent running
`epoch-close` cannot advance without documenting each experiment's outcome and
producing a coherent retrospective.

**`epoch-open` (3 phases):**
- Phase 0: Theme — concern area, why it warrants an epoch, what success looks like
- Phase 1: Experiments — spec each sub-hypothesis: what it tests, how we'll know,
  which methodology runs it, explicit dependencies if any
- Phase 2: Commit — epoch acceptance criteria, stopping condition, `hypothesis.md` content

**`epoch-close` (3 phases):**
- Phase 0: Experiment Outcomes — status and learning per experiment
- Phase 1: Retrospective — what the epoch taught, what was surprising, known issues
- Phase 2: Forward — carry-forward dispositions, next epoch proposal

**Validation:** E3 itself closes using `epoch-close`. If `epoch-close` produces a
coherent retrospective without requiring extra prose outside the session output, the
hypothesis holds. E4 opens using `epoch-open`.

**How we'll know:** Both YAMLs load (`method_list` returns them), at least one full
session through each completes without guidance ambiguity, and E3's `decision.md` is
produced directly from an `epoch-close` session output.

**Methodology:** `method-iteration`
**Change type:** methodology
**Affected files:** `server/src/methodologies/epoch-open.yaml`,
`server/src/methodologies/epoch-close.yaml`
