# H2 — `topic` vs `goal` Naming

**Hypothesis:** The inconsistency between `topic` (the actual `method_start`
parameter name) and `goal` (used informally in docs and epoch notes) is a
documentation problem, not a rename. Updating CLAUDE.md to consistently use
`topic` wherever it refers to the `method_start` parameter is cheaper and correct.
Renaming the parameter itself would be a breaking change to the tool interface.

**How we'll know:** After the fix, CLAUDE.md uses `topic` consistently when
referring to the `method_start` parameter. A cold-start agent reading CLAUDE.md
would not encounter the mismatch.

**Methodology:** `method-iteration`
**Change type:** infrastructure (docs only)
**Affected file:** `CLAUDE.md`
