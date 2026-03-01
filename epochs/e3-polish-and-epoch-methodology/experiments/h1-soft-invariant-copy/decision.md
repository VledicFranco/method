# H1 — Decision

**Verdict:** Confirmed (pending docker rebuild)
**Date:** 2026-03-01

## Finding

`validator.ts` line 25 used "is required but missing" for missing field violations. Because
`mapToInvariant()` matches invariants by field name prefix, a soft/optional field that was
not provided would show "is required but missing" in `soft_warnings` — misleading copy that
implies the field is hard-required.

## Change Made

`server/src/runtime/validator.ts` line 25:
```
Before: `"${fieldName}" is required but missing`
After:  `"${fieldName}" was not provided`
```

## Blocker

Infrastructure changes require `docker:up` to take effect. `method_reload` only reloads
YAMLs — the server binary is not recompiled. Runtime confirmation of the fix requires a
full docker rebuild.

## What Was Learned

The bug surfaced live during the Phase 2 session itself: `methodology_name` (a soft/optional
field) showed "is required but missing" in soft_warnings — exactly the misleading language
being fixed. The fix is correct; the validation constraint is the docker rebuild workflow.

## Decision

Stop. Code change is complete and type-checks clean. Pending `docker:up` for runtime confirmation.
