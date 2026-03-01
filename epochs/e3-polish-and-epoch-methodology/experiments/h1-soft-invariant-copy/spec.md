# H1 — Soft Invariant Copy Fix

**Hypothesis:** Changing the missing-field message in `validator.ts` from
`"${fieldName}" is required but missing` to `"${fieldName}" was not provided`
removes the misleading "required" language for fields that are governed by soft
(non-blocking) invariants.

**How we'll know:** After the fix, a `test-gates` session through Phase 3
(soft invariant gate) where `optional_note` is omitted produces a `soft_warnings`
entry that does not contain the word "required".

**Methodology:** `method-iteration`
**Change type:** infrastructure
**Affected file:** `server/src/runtime/validator.ts` line 25
