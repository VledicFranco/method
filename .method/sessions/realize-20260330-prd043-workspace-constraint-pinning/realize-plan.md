# Realization Plan: PRD 043 — Workspace Constraint Pinning & Violation Detection

## FCA Partition Map

```
Package: @method/pacta (L3)
  cognitive/algebra/    → workspace types, engine, events, composition operators
  cognitive/modules/    → observer, monitor, classifier (new), actor, reasoner, etc.
  cognitive/engine/     → cycle orchestrator (8-phase loop)

experiments/exp-cognitive-baseline/ → experiment runner, task definitions (outside package)

Dependency flow: algebra ← modules ← engine (downward only within package)
```

No cross-package changes. No bridge domains affected. No ports to create/modify.

## Commissions

| ID | Phase | Sub-Area | Title | Depends On | Status |
|----|-------|----------|-------|------------|--------|
| C-1 | 1 | cognitive/algebra | Workspace Pinning & Types | — | pending |
| C-2 | 2 | cognitive/modules | Constraint Classifier & Observer | C-1 | pending |
| C-3 | 3 | cognitive/engine + experiments | Post-ACT Verification & Wiring Fix | C-1, C-2 | pending |

## Shared Surface Changes

None required. All changes are within one package (`@method/pacta`). The algebra barrel export (`algebra/index.ts`) is part of C-1's scope. No orchestrator-owned shared surface edits needed between waves.

## Execution Order

Wave 1: C-1 (algebra) — workspace-types.ts, workspace.ts, events.ts, index.ts + tests
  → build verification
Wave 2: C-2 (modules) — constraint-classifier.ts (new), observer.ts + tests
  → build verification
Wave 3: C-3 (engine + experiments) — cycle.ts, run.ts + tests
  → full npm test verification

## Commission Cards

### C-1: Workspace Pinning & Types

- **id:** C-1
- **phase:** 1 (PRD Phase 1)
- **title:** Add pinned + contentType fields to WorkspaceEntry, eviction skip logic, maxPinnedEntries cap, diagnostic events
- **sub-area:** cognitive/algebra
- **scope:**
  - allowed_paths:
    - `packages/pacta/src/cognitive/algebra/workspace-types.ts`
    - `packages/pacta/src/cognitive/algebra/workspace.ts`
    - `packages/pacta/src/cognitive/algebra/events.ts`
    - `packages/pacta/src/cognitive/algebra/index.ts`
    - `packages/pacta/src/cognitive/algebra/__tests__/workspace.test.ts`
  - forbidden_paths:
    - `packages/pacta/src/cognitive/modules/**`
    - `packages/pacta/src/cognitive/engine/**`
    - `experiments/**`
- **deliverables:**
  - `pinned?: boolean` and `contentType?: EntryContentType` on WorkspaceEntry
  - `EntryContentType = 'constraint' | 'goal' | 'operational'` union type
  - `maxPinnedEntries?: number` on WorkspaceConfig (default: 10)
  - `evictLowest()` skips pinned entries; falls back to oldest-pinned when all pinned and count >= maxPinnedEntries
  - Spread operator preserves pinned + contentType on write
  - 3 new event types: CognitiveConstraintPinned, CognitiveConstraintViolation, CognitiveMonitorDirectiveApplied
  - Re-export new types from algebra/index.ts
- **acceptance_criteria:**
  - Pinned entry survives eviction when capacity is full
  - Non-pinned entry is evicted normally
  - Multiple pinned entries all survive — non-pinned evicted first
  - Workspace at capacity with ALL pinned entries and count < maxPinnedEntries — exceeds capacity by 1
  - Workspace at maxPinnedEntries cap — oldest pinned entry evicted
  - Write preserves pinned and contentType fields through spread
  - npm run build passes with no type errors
- **estimated_tasks:** 5
- **branch:** feat/prd043-c1-workspace-pinning
- **status:** pending

### C-2: Constraint Classifier & Observer Integration

- **id:** C-2
- **phase:** 2 (PRD Phase 2)
- **title:** Create constraint-classifier.ts with classifyEntry, extractProhibitions, checkConstraintViolations; integrate into Observer
- **sub-area:** cognitive/modules
- **scope:**
  - allowed_paths:
    - `packages/pacta/src/cognitive/modules/constraint-classifier.ts` (new)
    - `packages/pacta/src/cognitive/modules/observer.ts`
    - `packages/pacta/src/cognitive/modules/__tests__/constraint-classifier.test.ts` (new)
    - `packages/pacta/src/cognitive/modules/__tests__/observer.test.ts`
  - forbidden_paths:
    - `packages/pacta/src/cognitive/algebra/**`
    - `packages/pacta/src/cognitive/engine/**`
    - `experiments/**`
- **depends_on:** [C-1]
- **deliverables:**
  - constraint-classifier.ts: classifyEntry(), extractProhibitions(), checkConstraintViolations(), ConstraintViolation type
  - Observer integration: classify task input only (not tool results), set pinned + contentType before write
  - 15 classifier test scenarios + 4 observer test scenarios
- **acceptance_criteria:**
  - "must NOT import notifications" → constraint, pinned
  - "Your task: implement v2" → goal, not pinned
  - Tool-result content → operational (never classified)
  - extractProhibitions("must NOT import notifications") → [/import.*notifications/i]
  - checkConstraintViolations detects violation in matching output
  - checkConstraintViolations returns empty for non-matching output
  - Observer sets pinned + contentType correctly for each input type
  - npm run build passes
- **estimated_tasks:** 5
- **branch:** feat/prd043-c2-constraint-classifier
- **status:** pending

### C-3: Post-ACT Verification & Wiring Fix

- **id:** C-3
- **phase:** 3 (PRD Phase 3)
- **title:** Add always-on post-ACT constraint verification to cycle.ts and run.ts; fix Monitor wiring in cycle.ts
- **sub-area:** cognitive/engine + experiments
- **scope:**
  - allowed_paths:
    - `packages/pacta/src/cognitive/engine/cycle.ts`
    - `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts`
    - `experiments/exp-cognitive-baseline/run.ts`
  - forbidden_paths:
    - `packages/pacta/src/cognitive/algebra/**`
    - `packages/pacta/src/cognitive/modules/**` (except imports)
- **depends_on:** [C-1, C-2]
- **deliverables:**
  - cycle.ts: Post-ACT constraint verification (always-on, after Phase 7 ACT)
  - cycle.ts: Monitor output wiring fix (restrictedActions/forceReplan → Actor control)
  - run.ts: Post-ACT constraint verification + R-13 condition configs (cognitive-pinned, cognitive-pinned-recovery)
  - 4 new cycle test scenarios
- **acceptance_criteria:**
  - Post-ACT verification catches constraint violation and emits event
  - Post-ACT verification is a no-op when no pinned entries exist
  - Monitor restrictedActions reach Actor control directive (wiring fix)
  - When Monitor doesn't intervene, Actor gets default control (regression)
  - run.ts has R-13 conditions configured
  - npm test passes (full suite, no regressions)
- **estimated_tasks:** 5
- **branch:** feat/prd043-c3-post-act-verification
- **status:** pending

## Acceptance Gates

| # | Criterion | Verification | Commissions | Status |
|---|-----------|-------------|-------------|--------|
| AC-1 | Pinned entries survive eviction | workspace.test.ts scenario | C-1 | pending |
| AC-2 | maxPinnedEntries cap prevents unbounded growth | workspace.test.ts scenario | C-1 | pending |
| AC-3 | Observer classifies task input only | observer.test.ts scenarios | C-2 | pending |
| AC-4 | Post-ACT violation check catches constraint breach | constraint-classifier.test.ts | C-2, C-3 | pending |
| AC-5 | cycle.ts wiring fix forwards Monitor output | cycle.test.ts scenario | C-3 | pending |
| AC-7 | No regression on T01, T02, T05 | R-13 experiment (post-realization) | all | pending |
| AC-8 | Existing test suite passes | npm test | all | pending |

Note: AC-6 (T04 ≥ 80%) and AC-7 (regression) require running R-13 experiment AFTER all code is merged. This is a post-realization activity.

## Status Tracker

Total: 3 commissions, 3 waves
Completed: 0 / 3
Current wave: —
Blocked: C-2 (on C-1), C-3 (on C-2)
Failed: —
