# testkit/builders/ — Methodology Test Fixture Builders

Factory functions for constructing test fixtures. Each builder returns a fully valid structure with sensible defaults — override only the fields relevant to the test.

| File | Builders |
|------|---------|
| `domain.ts` | `buildDomainTheory()`, `buildSort()`, `buildFunction()` |
| `method.ts` | `buildMethod()`, `buildStep()`, `buildGateSuite()` |
| `methodology.ts` | `buildMethodology()`, `buildArm()`, `buildSafetyBounds()` |
| `state.ts` | `buildWorldState()` — generic world state with configurable fields |
| `step.ts` | `buildStepResult()`, `buildGateResult()` (pass/fail variants) |
