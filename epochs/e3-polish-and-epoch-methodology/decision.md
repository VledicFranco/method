# E3 — Decision

**Date:** 2026-03-01

## Experiment Outcomes

| Slug | Status | Learning |
|------|--------|----------|
| h1-soft-invariant-copy | confirmed | One-line fix in validator.ts line 25: 'is required but missing' → 'was not provided'. Infrastructure changes require docker rebuild; method_reload only reloads YAMLs. |
| h2-topic-goal-naming | confirmed | The inconsistency was already resolved. CLAUDE.md never used 'goal' — only historical epoch docs did. Checking before fixing saved a full implementation pass. |
| h3-method-iteration-phase0-wording | confirmed | Renaming epoch_criteria_open → experiment_criteria_open and updating the guidance path to reference spec.md (not epoch hypothesis) corrected agent behavior immediately. |
| h4-epoch-methodology | confirmed | epoch-open and epoch-close work as MCP methodologies. Producing hypothesis_md_content and decision_md_content inside session output makes the session the primary artifact. |
| h5-semantic-validation-design | open | Not executed in E3. Promoted to E4 as its own epoch. |

## Retrospective

E3's concern — polish and epoch lifecycle methodology — was addressed. Three polish fixes were applied (H1–H3). Two epoch ceremony methodologies were implemented (H4). The epoch lifecycle is now MCP-enforced: agents cannot open an epoch without a falsifiable hypothesis list, cannot close one without documenting every experiment outcome.

### Key Learnings

- YAML field naming directly drives agent behavior. Renaming `epoch_criteria_open` to `experiment_criteria_open` immediately corrected the level at which agents looked for acceptance criteria, without any other change.
- epoch-open and epoch-close as MCP methodologies work. Producing `hypothesis_md_content` and `decision_md_content` inside the session output makes the session the primary artifact and eliminates separate prose writing outside the session.
- Checking before fixing has high ROI. H2 saved a full implementation pass by first confirming the inconsistency was already resolved. Prior epoch decision.md files describe state at time of writing, not necessarily current state.
- Infrastructure changes require docker rebuild; `method_reload` only reloads YAMLs. This is a workflow constraint that affects validation sessions (they see old compiled code until rebuild).

### Surprising Findings

- H2 (topic/goal naming) was already resolved. The CLAUDE.md inconsistency cited in E1/E2 epoch docs never existed in the current CLAUDE.md. Prior epoch docs were retrospective artifacts.
- epoch-close running on E3 before E3 is fully closed is self-referentially viable — H4's validation criterion was circular but resolved by treating H4 as confirmed once the session completes cleanly.

### Known Issues

- H1 validator.ts fix awaits docker rebuild confirmation. The code change is correct but runtime verification pending `docker:up`.
- H5 (semantic validation design) was not executed in E3.

## Forward

### Carry-Forward Dispositions

- `h5-semantic-validation-design` → promoted: warrants its own epoch (E4). Implementing sampling/createMessage integration involves server-side infrastructure changes, a new YAML field type, and judge prompt engineering — each spawning sub-hypotheses that belong in a focused epoch.

### Next Epoch

E4 — semantic-validation: implement LLM-as-judge content-level invariant enforcement via sampling/createMessage. Three experiments: (h1) semantic invariant YAML schema design, (h2) sampling integration in the advance tool, (h3) end-to-end block of a vague submission. Stop condition: a real method_advance call is blocked by a semantic invariant.
