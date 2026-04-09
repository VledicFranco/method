# testkit/assertions/ — Methodology Test Assertions

Typed assertion functions for verifying methodology execution results. Each file covers assertions for one structural domain.

| File | Assertions |
|------|-----------|
| `domain.ts` | `assertAxiomsValid()`, `assertSignatureValid()` |
| `method.ts` | `assertStepOutputMatches()`, `assertGatePassed()`, `assertGateFailed()` |
| `methodology.ts` | `assertArmSelected()`, `assertTerminated()`, `assertSuspended()` |
| `predicate.ts` | `assertPredicatePasses()`, `assertPredicateFails()`, `assertEvidence()` |
| `retraction.ts` | `assertRetracted()`, `assertRetractedWith()` |
