# H4 — Decision

**Verdict:** Confirmed
**Date:** 2026-03-01

## Finding

Encoding the epoch lifecycle as two YAML methodologies (`epoch-open` and `epoch-close`) is viable.
Both methodologies load, run through full sessions at delta=1.0, and produce their primary artifacts
(`hypothesis_md_content`, `decision_md_content`) directly as session output fields.

## Changes Made

- `server/src/methodologies/epoch-open.yaml` — 3 phases: Theme, Experiments, Commit
- `server/src/methodologies/epoch-close.yaml` — 3 phases: Experiment Outcomes, Retrospective, Forward

## What Was Learned

Producing `hypothesis_md_content` and `decision_md_content` as session output fields is the right
design — it makes the session the primary artifact and eliminates the need for separate prose
authoring outside the session.

The `measurable_criteria` array as a separate required field (not embedded in the `experiments` strings)
effectively enforces that every experiment has a falsifiable criterion. An agent cannot advance Phase 1
without enumerating them explicitly.

## Validation

E3 itself was closed using `epoch-close` (sess_9985deb2cfba). The session produced the E3 `decision.md`
content without requiring any prose outside the session output. The hypothesis holds.
