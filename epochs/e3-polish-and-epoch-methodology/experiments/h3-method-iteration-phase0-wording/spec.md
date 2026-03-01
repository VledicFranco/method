# H3 — `method-iteration` Phase 0 Guidance Wording

**Hypothesis:** The `epoch_criteria_open` field in Phase 0 of `method-iteration.yaml`
references "acceptance criteria from the active epoch" but `method-iteration` operates
at the experiment level, not the epoch level. The field should reference the current
experiment's acceptance criteria (from its `spec.md`), not the whole epoch's.

**How we'll know:** After the fix, Phase 0 guidance and the `epoch_criteria_open`
field description no longer imply that the whole epoch's criteria must be tracked.
The field is renamed or reworded to refer to the experiment. A fresh session
through Phase 0 produces contextually correct output.

**Methodology:** `method-iteration`
**Change type:** methodology
**Affected file:** `server/src/methodologies/method-iteration.yaml`
