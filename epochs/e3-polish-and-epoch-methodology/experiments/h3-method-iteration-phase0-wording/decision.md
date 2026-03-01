# H3 — Decision

**Verdict:** Confirmed and fixed
**Date:** 2026-03-01

## Finding

`method-iteration.yaml` Phase 0 used `epoch_criteria_open` as the field name and directed agents
to "Review the active epoch hypothesis" — pointing at the wrong level of the hierarchy. The
field should point agents at the *experiment* spec, not the epoch hypothesis.

## Changes Made

`server/src/methodologies/method-iteration.yaml` Phase 0:
- Field renamed: `epoch_criteria_open` → `experiment_criteria_open`
- Invariant ID renamed: `epoch_criteria_open_min_one` → `experiment_criteria_open_min_one`
- Guidance updated: "Review the active epoch hypothesis" → "Read this experiment's `spec.md`
  (`epochs/eN-*/experiments/hN-*/spec.md`) to find its acceptance criteria"

## What Was Learned

The distinction between epoch-level and experiment-level acceptance criteria matters in practice.
An agent following the old guidance would inventory the entire epoch hypothesis at the start of
every iteration — too broad. The fix scopes Phase 0 correctly to the experiment's own spec.md,
making the context loading step focused and actionable.

## Validation

Fresh session confirmed live: Phase 0 guidance and output field name both updated correctly.
`method_reload` was sufficient — no Docker rebuild needed for YAML-only changes.
