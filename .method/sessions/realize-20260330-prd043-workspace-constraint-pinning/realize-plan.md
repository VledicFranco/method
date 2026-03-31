# Realization Plan: PRD 043 Phases 1-3 — Refinements

## Baseline

Phase 0 is on master (`d9d6481`, `56d1dca`, `7d03fc0`):
- `pinned?: boolean` on WorkspaceEntry
- `evictLowest()` skips pinned (no cap — returns undefined if all pinned)
- `isConstraint()` inline in observer.ts (CONSTRAINT_PATTERNS array)
- R-13 GATE PASS: T04 0%→100%, overall 60%→72%

## Commissions

| ID | Phase | Sub-Area | Title | Depends On | Wave | Status |
|----|-------|----------|-------|------------|------|--------|
| C-1 | 1 | cognitive/algebra | Types, eviction cap, diagnostic events | — | 1 | pending |
| C-2 | 2 | cognitive/modules | Extract constraint-classifier, Observer refactor | — | 1 | pending |
| C-3 | 3 | cognitive/engine + experiments | Post-ACT verification, Monitor wiring fix | C-1, C-2 | 2 | pending |

## Execution Order

Wave 1 (PARALLEL): C-1 + C-2 — disjoint directories (algebra/ vs modules/), zero file overlap
  → build verification on master after merge
Wave 2: C-3 — depends on C-1 (types) + C-2 (classifier functions)
  → full npm test verification

## Shared Surface Changes

Pre-wave 2:
- `packages/pacta/src/cognitive/algebra/index.ts` — re-export `EntryContentType` + event types (done by C-1)
- `packages/pacta/src/cognitive/modules/constraint-classifier.ts` — must exist (done by C-2)

Both are within their respective commission scopes — no orchestrator surface edits needed.

## Acceptance Gates

| # | Criterion | Verification | Commissions |
|---|-----------|-------------|-------------|
| AC-1 | Pinned entries survive eviction | workspace.test.ts | C-1 |
| AC-2 | maxPinnedEntries cap | workspace.test.ts | C-1 |
| AC-3 | Observer classifies task input only | observer.test.ts | C-2 |
| AC-4 | Post-ACT violation check | constraint-classifier.test.ts + cycle.test.ts | C-2, C-3 |
| AC-5 | cycle.ts wiring fix | cycle.test.ts | C-3 |
| AC-8 | Existing test suite passes | npm test | all |

## Status Tracker

Total: 3 commissions, 2 waves
Completed: 0 / 3
Current wave: 1
