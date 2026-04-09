# stdlib/ — Standard Methodology Library

The built-in methodology registry for `@method/methodts`. Contains the canonical P-series methodologies (P1-EXEC through P3-SD, P-GH), methodology metadata, reusable predicates, prompts, and the stdlib strategy source.

## Contents

| Directory | Description |
|-----------|-------------|
| `methods/` | Individual method files (one per P-series ID) |
| `methodologies/` | Full methodology definitions (arms, safety bounds, transitions) |
| `metadata/` | Registry metadata: version, compilation status, capability declarations |
| `meta/` | Meta-methodology utility methods (project card ops, reflection) |
| `catalog.ts` | Registry catalog — maps methodology IDs to their definitions |
| `gates.ts` | Shared gate definitions reused across stdlib methodologies |
| `predicates.ts` | Common predicates used in stdlib preconditions/postconditions |
| `prompts.ts` | Shared prompt fragments used across multiple methods |
| `types.ts` | Stdlib-specific type declarations |

## Canonical Methodologies

| ID | Name | Description |
|----|------|-------------|
| P1-EXEC | Execution | Single-step task execution with gate validation |
| P2-SD | Software Development | Multi-phase development: explore → plan → implement → verify |
| P3-GOV | Governance | Steering council facilitation and decision recording |
| P3-DISP | Dispatch | Task decomposition and parallel sub-agent dispatch |
| P-GH | GitHub | GitHub-specific operations (PRs, issues, reviews) |
