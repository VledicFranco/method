# Realization Plan — PRD 035: Cognitive Monitoring & Control v2

## PRD Summary

**Objective:** Deliver v2 implementations of Monitor, ATTEND, ReasonerActor, and ProviderAdapter as plug-and-play replacements implementing the same `CognitiveModule<I,O,S,Mu,Kappa>` contract from PRD 030. Existing v1 modules remain available. Users choose which version to compose.

**Phases:**
1. EnrichedMonitoringSignal + MonitorV2 (prediction error, metacognitive taxonomy, adaptive thresholds)
2. PriorityAttend + PrecisionAdapter (three-factor attention, continuous effort allocation)
3. ReasonerActorV2 + EVC Control (impasse detection, cost-benefit control gating)
4. Presets + Integration (enrichedPreset composing all v2 modules)

**Acceptance Criteria:** AC-01 through AC-12 (all automatable — Given/When/Then with test locations)

**Domains Affected:** `@methodts/pacta` (cognitive/), `@methodts/pacta-testkit`

## FCA Partition

The PRD operates entirely within `@methodts/pacta` (L3 library) and `@methodts/pacta-testkit` (L2 testing). Within pacta's cognitive domain, the sub-layers are:

```
Commissionable sub-domains (independent — parallel when in different sub-domains):
  algebra/    → types, composition operators, workspace, provider adapter
  modules/    → 8+ cognitive module implementations (each file is an independent FCA component)
  engine/     → cycle orchestrator, createCognitiveAgent, asFlatAgent
  presets/    → (new) composition presets for ready-to-use configurations

Separate package (independent):
  pacta-testkit/ → assertion helpers, builders, recording utilities

Shared surfaces (orchestrator-owned):
  algebra/index.ts          — algebra barrel export
  engine/index.ts           — engine barrel export
  cognitive/index.ts        — cognitive domain barrel
  pacta/src/index.ts        — package-level API surface
  algebra/workspace-types.ts — SalienceContext extension (cross-commission dependency)
```

**Layer stack:** L2 (methodts, testkit) → L3 (pacta, mcp) → L4 (bridge). All work is in L3 + L2 testkit. No L4 changes.

**Same-domain sequencing:** `modules/` commissions create disjoint new files with no mutual imports, but are sequenced across waves to respect FCA domain exclusivity. Each module file is an independent FCA component — no shared state, no shared test fixtures. The sequencing is a structural safety guarantee, not a data dependency.

## Commission Summary

| Commission | Domain | Phase | Title | Depends On | Wave |
|------------|--------|-------|-------|------------|------|
| C-1 | pacta/cognitive/algebra | P1-P2 | Enriched signal types + PrecisionAdapter | — | 1 |
| C-2 | pacta/cognitive/modules | P1 | MonitorV2 — prediction error + metacognitive taxonomy | C-1 | 2 |
| C-3 | pacta/cognitive/engine | P3 | EVC threshold policy | C-1 | 2 |
| C-4 | pacta-testkit | P1-P3 | Testkit v2 assertions + builders | C-1 | 2 |
| C-5 | pacta/cognitive/modules | P2 | PriorityAttend — three-factor biased competition | C-1 | 3 |
| C-6 | pacta/cognitive/modules | P3 | ReasonerActorV2 — impasse detection + auto-subgoaling | C-1 | 4 |
| C-7 | pacta/cognitive/presets | P4 | enrichedPreset + barrel integration | C-2, C-3, C-5, C-6 | 5 |

## Waves

### Wave 0 — Shared Surface Preparation

Orchestrator applies before any commission starts:

1. **Extend `SalienceContext`** in `packages/pacta/src/cognitive/algebra/workspace-types.ts`:
   - Add `SelectionOutcome` interface (4 fields: entryHash, outcome, timestamp)
   - Add optional `selectionOutcomes?: SelectionOutcome[]` to `SalienceContext`
   - Add optional `activeSubgoals?: string[]` to `SalienceContext`
   - ~15 lines, backward-compatible (all new fields optional)

2. **Verify:** `npm run build` passes. Existing tests unaffected.

### Wave 1 — Algebra Foundation

- **C-1:** Enriched signal types + PrecisionAdapter (`algebra/`)

### Between Wave 1 → 2 — Shared Surface Update

Orchestrator applies:

1. **Update `algebra/index.ts`** — add exports for `enriched-signals.ts` types and `precision-adapter.ts` factory + types
2. **Verify:** `npm run build` passes

### Wave 2 — Core Implementation (3 parallel commissions, 3 different sub-domains)

- **C-2:** MonitorV2 (`modules/`) — prediction error, metacognitive taxonomy, adaptive thresholds
- **C-3:** EVC threshold policy (`engine/`) — cost-benefit control gating
- **C-4:** Testkit v2 extensions (`pacta-testkit/`) — assertions + builders for v2 signals

### Between Wave 2 → 3 — Shared Surface Update

Orchestrator applies:

1. **Update `engine/index.ts`** — add exports for `evcThresholdPolicy`, `EVCConfig`
2. **Verify:** `npm run build` passes

### Wave 3 — PriorityAttend

- **C-5:** PriorityAttend (`modules/`) — three-factor salience function with selection history

### Wave 4 — ReasonerActorV2

- **C-6:** ReasonerActorV2 (`modules/`) — four-type impasse detection + auto-subgoal generation

### Between Wave 4 → 5 — Shared Surface Update

Orchestrator applies:

1. **Update `cognitive/index.ts`** — add presets re-export if following barrel pattern (or keep direct import pattern per existing convention)
2. **Update `pacta/src/index.ts`** — add all v2 module exports per PRD Module Catalog Exports section
3. **Verify:** `npm run build` passes

### Wave 5 — Enriched Preset + Integration

- **C-7:** enrichedPreset composing all v2 modules + integration tests

### Post-Wave — Documentation (Orchestrator)

1. Create `docs/arch/cognitive-monitoring-v2.md` — prediction error model, Gratton effect, EVC control
2. Create `docs/guides/cognitive-module-catalog.md` — v1/v2 module catalog with decision matrix
3. Update `docs/guides/cognitive-composition.md` — v2 usage, enrichedPreset, PrecisionAdapter
4. Update `docs/arch/pacta.md` — v2 module layer in cognitive architecture diagram

## Commission Cards

### C-1: Enriched Signal Types + PrecisionAdapter

- **Domain:** `pacta/cognitive/algebra`
- **Wave:** 1
- **Scope:**
  - **Allowed paths:**
    - `packages/pacta/src/cognitive/algebra/enriched-signals.ts`
    - `packages/pacta/src/cognitive/algebra/precision-adapter.ts`
    - `packages/pacta/src/cognitive/algebra/__tests__/precision-adapter.test.ts`
  - **Forbidden paths:**
    - `packages/pacta/src/cognitive/algebra/index.ts`
    - `packages/pacta/src/cognitive/algebra/workspace-types.ts`
    - `packages/pacta/src/cognitive/algebra/module.ts`
    - `packages/pacta/src/cognitive/modules/**`
    - `packages/pacta/src/cognitive/engine/**`
    - `packages/pacta/src/index.ts`
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
- **Depends on:** —
- **Parallel with:** — (only commission in Wave 1)
- **Deliverables:**
  - `enriched-signals.ts` — EnrichedMonitoringSignal extending MonitoringSignal, MetacognitiveJudgment types, ModuleExpectation, MonitorV2State, MonitorV2Config interfaces
  - `precision-adapter.ts` — precisionToConfig() function, createPrecisionAdapter() factory, PrecisionConfig, PrecisionAdapterConfig types
  - `__tests__/precision-adapter.test.ts` — 6 test scenarios
- **Documentation deliverables:** none (types-only, no behavioral change to existing domain)
- **Acceptance criteria:**
  - AC-09: precisionToConfig(0.0) → minimal config, precisionToConfig(1.0) → thorough config → PRD AC-09
  - EnrichedMonitoringSignal extends MonitoringSignal (structural subtype) → PRD AC-11
  - PrecisionAdapter wraps ProviderAdapter without modifying its interface → PRD AC-09
- **Estimated tasks:** 6
- **Branch:** `feat/prd035-c1-algebra-foundation`
- **Status:** pending

### C-2: MonitorV2 — Prediction Error + Metacognitive Taxonomy

- **Domain:** `pacta/cognitive/modules`
- **Wave:** 2
- **Scope:**
  - **Allowed paths:**
    - `packages/pacta/src/cognitive/modules/monitor-v2.ts`
    - `packages/pacta/src/cognitive/modules/__tests__/monitor-v2.test.ts`
  - **Forbidden paths:**
    - `packages/pacta/src/cognitive/modules/monitor.ts`
    - `packages/pacta/src/cognitive/modules/reasoner-actor.ts`
    - `packages/pacta/src/cognitive/algebra/**`
    - `packages/pacta/src/cognitive/engine/**`
    - `packages/pacta/src/index.ts`
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
- **Depends on:** C-1 (imports EnrichedMonitoringSignal, ModuleExpectation, MonitorV2State from algebra)
- **Parallel with:** C-3 (engine/), C-4 (pacta-testkit/)
- **Deliverables:**
  - `monitor-v2.ts` — createMonitorV2() factory implementing CognitiveModule interface
  - `__tests__/monitor-v2.test.ts` — 15 test scenarios
- **Documentation deliverables:** none (module-level; catalog documentation is post-wave orchestrator work)
- **Acceptance criteria:**
  - AC-01: MonitorV2 emits prediction errors when behavior deviates → PRD AC-01
  - AC-02: Distinct metacognitive signals (EOL, JOL, FOK, RC) → PRD AC-02
  - AC-03: Precision weighting amplifies reliable, damps noisy → PRD AC-03
  - AC-04: Adaptive thresholds lower after intervention, raise after clean → PRD AC-04
  - MonitorV2 produces v1-compatible MonitorReport → PRD AC-11
  - MonitorV2 implements CognitiveModule interface → PRD AC-11
- **Estimated tasks:** 5
- **Branch:** `feat/prd035-c2-monitor-v2`
- **Status:** pending

### C-3: EVC Threshold Policy

- **Domain:** `pacta/cognitive/engine`
- **Wave:** 2
- **Scope:**
  - **Allowed paths:**
    - `packages/pacta/src/cognitive/engine/evc-policy.ts`
    - `packages/pacta/src/cognitive/engine/__tests__/evc-policy.test.ts`
  - **Forbidden paths:**
    - `packages/pacta/src/cognitive/engine/cycle.ts`
    - `packages/pacta/src/cognitive/engine/index.ts`
    - `packages/pacta/src/cognitive/engine/create-cognitive-agent.ts`
    - `packages/pacta/src/cognitive/modules/**`
    - `packages/pacta/src/cognitive/algebra/**`
    - `packages/pacta/src/index.ts`
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
- **Depends on:** C-1 (imports EnrichedMonitoringSignal for prediction error field access)
- **Parallel with:** C-2 (modules/), C-4 (pacta-testkit/)
- **Deliverables:**
  - `evc-policy.ts` — evcThresholdPolicy() factory returning ThresholdPolicy, EVCConfig type
  - `__tests__/evc-policy.test.ts` — 6 test scenarios
- **Documentation deliverables:** none
- **Acceptance criteria:**
  - AC-10: EVC skips intervention when cost exceeds payoff → PRD AC-10
  - EVC falls back to v1 signal proxy when enriched signals absent → PRD compatibility matrix
  - EVC returns valid ThresholdPolicy compatible with CycleConfig.thresholds → PRD AC-11
- **Estimated tasks:** 3
- **Branch:** `feat/prd035-c3-evc-policy`
- **Status:** pending

### C-4: Testkit v2 Extensions

- **Domain:** `pacta-testkit`
- **Wave:** 2
- **Scope:**
  - **Allowed paths:**
    - `packages/pacta-testkit/src/cognitive-assertions.ts`
    - `packages/pacta-testkit/src/cognitive-builders.ts`
    - `packages/pacta-testkit/src/index.ts`
  - **Forbidden paths:**
    - `packages/pacta/**`
    - `packages/bridge/**`
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
- **Depends on:** C-1 (imports enriched signal types for assertion type checking)
- **Parallel with:** C-2 (modules/), C-3 (engine/)
- **Deliverables:**
  - Updated `cognitive-assertions.ts` — assertion helpers for prediction error magnitude, impasse type, precision level, metacognitive judgment presence
  - Updated `cognitive-builders.ts` — builders for MonitorV2Config, ReasonerActorV2Config, PriorityAttendConfig, EVCConfig
  - Updated `index.ts` — re-export new assertions and builders
- **Documentation deliverables:** none
- **Acceptance criteria:**
  - Testkit assertions correctly validate EnrichedMonitoringSignal fields
  - Testkit builders produce valid v2 config objects
- **Estimated tasks:** 3
- **Branch:** `feat/prd035-c4-testkit-v2`
- **Status:** pending

### C-5: PriorityAttend — Three-Factor Biased Competition

- **Domain:** `pacta/cognitive/modules`
- **Wave:** 3
- **Scope:**
  - **Allowed paths:**
    - `packages/pacta/src/cognitive/modules/priority-attend.ts`
    - `packages/pacta/src/cognitive/modules/__tests__/priority-attend.test.ts`
  - **Forbidden paths:**
    - `packages/pacta/src/cognitive/modules/monitor*.ts`
    - `packages/pacta/src/cognitive/modules/reasoner*.ts`
    - `packages/pacta/src/cognitive/algebra/**`
    - `packages/pacta/src/cognitive/engine/**`
    - `packages/pacta/src/index.ts`
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
- **Depends on:** C-1 (imports PriorityScore types), Wave 0 surface (SalienceContext extension)
- **Parallel with:** — (only modules/ commission in Wave 3)
- **Deliverables:**
  - `priority-attend.ts` — prioritySalienceFunction matching SalienceFunction signature, PriorityAttendConfig, PriorityScore, winner suppression logic
  - `__tests__/priority-attend.test.ts` — 10 test scenarios
- **Documentation deliverables:** none
- **Acceptance criteria:**
  - AC-05: Ranks entries by stimulus + goal + history composite → PRD AC-05
  - AC-06: Selection history boosts successful entries → PRD AC-06
  - prioritySalienceFunction matches SalienceFunction signature → PRD AC-11
- **Estimated tasks:** 4
- **Branch:** `feat/prd035-c5-priority-attend`
- **Status:** pending

### C-6: ReasonerActorV2 — Impasse Detection + Auto-Subgoaling

- **Domain:** `pacta/cognitive/modules`
- **Wave:** 4
- **Scope:**
  - **Allowed paths:**
    - `packages/pacta/src/cognitive/modules/reasoner-actor-v2.ts`
    - `packages/pacta/src/cognitive/modules/__tests__/reasoner-actor-v2.test.ts`
  - **Forbidden paths:**
    - `packages/pacta/src/cognitive/modules/reasoner-actor.ts`
    - `packages/pacta/src/cognitive/modules/monitor*.ts`
    - `packages/pacta/src/cognitive/modules/priority*.ts`
    - `packages/pacta/src/cognitive/algebra/**`
    - `packages/pacta/src/cognitive/engine/**`
    - `packages/pacta/src/index.ts`
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
- **Depends on:** C-1 (imports ImpasseSignal types from enriched-signals)
- **Parallel with:** — (only modules/ commission in Wave 4)
- **Deliverables:**
  - `reasoner-actor-v2.ts` — createReasonerActorV2() factory, four-type impasse detection (tie, no-change, rejection, stall), auto-subgoal generation, workspace injection
  - `__tests__/reasoner-actor-v2.test.ts` — 12 test scenarios
- **Documentation deliverables:** none
- **Acceptance criteria:**
  - AC-07: Tie impasse detected + comparison subgoal generated → PRD AC-07
  - AC-08: No-change impasse detected + alternative-listing subgoal → PRD AC-08
  - Rejection impasse detected on tool failure → PRD implied by scope
  - Stall impasse detected on low action entropy → PRD implied by scope
  - ReasonerActorV2 implements CognitiveModule interface → PRD AC-11
- **Estimated tasks:** 5
- **Branch:** `feat/prd035-c6-reasoner-actor-v2`
- **Status:** pending

### C-7: enrichedPreset + Integration

- **Domain:** `pacta/cognitive/presets` (new directory)
- **Wave:** 5
- **Scope:**
  - **Allowed paths:**
    - `packages/pacta/src/cognitive/presets/enriched.ts`
    - `packages/pacta/src/cognitive/presets/index.ts`
    - `packages/pacta/src/cognitive/presets/__tests__/enriched.test.ts`
  - **Forbidden paths:**
    - `packages/pacta/src/cognitive/modules/**`
    - `packages/pacta/src/cognitive/algebra/**`
    - `packages/pacta/src/cognitive/engine/**`
    - `packages/pacta/src/cognitive/index.ts`
    - `packages/pacta/src/index.ts`
    - `packages/*/package.json`
    - `packages/*/tsconfig.json`
- **Depends on:** C-2 (MonitorV2), C-3 (EVC), C-5 (PriorityAttend), C-6 (ReasonerActorV2)
- **Parallel with:** — (only commission in Wave 5)
- **Deliverables:**
  - `presets/enriched.ts` — enrichedPreset factory composing MonitorV2 + PriorityAttend + ReasonerActorV2 + PrecisionAdapter + EVC policy with sensible defaults
  - `presets/index.ts` — preset barrel
  - `presets/__tests__/enriched.test.ts` — 6 integration test scenarios
- **Documentation deliverables:**
  - `presets/README.md` — preset catalog and usage (new directory documentation)
- **Acceptance criteria:**
  - AC-11: v2 modules drop-in replace v1 — createCognitiveAgent accepts config without errors → PRD AC-11
  - AC-12: enrichedPreset composes all v2 modules into working agent → PRD AC-12
  - A/B: v1 preset and enrichedPreset produce compatible outputs → PRD AC-12
  - Mix-and-match: v1 monitor + v2 reasoner-actor works → PRD AC-11
- **Estimated tasks:** 5
- **Branch:** `feat/prd035-c7-enriched-preset`
- **Status:** pending

## Shared Surface Changes

| Wave Slot | File | Change | Lines | Reason |
|-----------|------|--------|-------|--------|
| 0→1 | `algebra/workspace-types.ts` | Add `SelectionOutcome` interface + extend `SalienceContext` with optional `selectionOutcomes`, `activeSubgoals` | ~15 | PriorityAttend (C-5) needs selection history data in salience context |
| 1→2 | `algebra/index.ts` | Export `EnrichedMonitoringSignal`, `MetacognitiveJudgment`, `ModuleExpectation`, `MonitorV2State`, `MonitorV2Config` from enriched-signals; export `createPrecisionAdapter`, `PrecisionConfig`, `PrecisionAdapterConfig`, `precisionToConfig` from precision-adapter | ~8 | Wave 2 commissions import enriched types through algebra barrel |
| 2→3 | `engine/index.ts` | Export `evcThresholdPolicy`, `EVCConfig` from evc-policy | ~3 | Downstream preset needs engine barrel access to EVC |
| 4→5 | `cognitive/index.ts` | Conditionally re-export presets (or note: follow existing pattern where modules import directly, not through barrel) | ~2 | Package API consistency |
| 4→5 | `pacta/src/index.ts` | Add v2 module exports per PRD "Module Catalog Exports" section | ~8 | Package-level API surface for consumers |

All changes are **simple** (<20 lines). Orchestrator applies directly. No `forge-surface` co-design needed.

**Verification per surface change:** `npm run build` passes after each application. Existing tests unaffected (all extensions are backward-compatible — optional fields, new exports, additive types).

## Acceptance Gates

| PRD AC | Description | Commission | Test Location |
|--------|-------------|------------|---------------|
| AC-01 | MonitorV2 emits prediction errors on deviation | C-2 | `modules/__tests__/monitor-v2.test.ts` #2 |
| AC-02 | Distinct metacognitive signals (EOL, JOL, FOK, RC) | C-2 | `modules/__tests__/monitor-v2.test.ts` #9-12 |
| AC-03 | Precision weighting amplifies reliable, damps noisy | C-2 | `modules/__tests__/monitor-v2.test.ts` #4-5 |
| AC-04 | Adaptive thresholds via Gratton effect | C-2 | `modules/__tests__/monitor-v2.test.ts` #6-8 |
| AC-05 | PriorityAttend three-factor ranking | C-5 | `modules/__tests__/priority-attend.test.ts` #1 |
| AC-06 | Selection history boosts successful entries | C-5 | `modules/__tests__/priority-attend.test.ts` #4 |
| AC-07 | Tie impasse + comparison subgoal | C-6 | `modules/__tests__/reasoner-actor-v2.test.ts` #1-2 |
| AC-08 | No-change impasse + alternative subgoal | C-6 | `modules/__tests__/reasoner-actor-v2.test.ts` #3-4 |
| AC-09 | PrecisionAdapter 0.0 → minimal, 1.0 → thorough | C-1 | `algebra/__tests__/precision-adapter.test.ts` #1-2 |
| AC-10 | EVC skips when cost > payoff | C-3 | `engine/__tests__/evc-policy.test.ts` #2 |
| AC-11 | v2 modules are drop-in replacements | C-7 | `presets/__tests__/enriched.test.ts` #5 |
| AC-12 | enrichedPreset composes working agent | C-7 | `presets/__tests__/enriched.test.ts` #2 |

All 12 PRD acceptance criteria covered. All automatable.

## Dependency DAG

```
        C-1 (algebra)
       / | \  \  \
      /  |  \  \  \
    C-2  C-3 C-4 C-5 C-6
     |    |       |    |
     +----+-------+----+
           |
          C-7 (preset)

Data dependencies (edges):
  C-1 → C-2, C-3, C-4, C-5, C-6
  C-2, C-3, C-5, C-6 → C-7

Domain exclusivity constraint (not data dependency):
  C-2, C-5, C-6 all in modules/ — must be in different waves
```

**Topological levels:**
- Level 0: C-1
- Level 1: C-2, C-3, C-4, C-5, C-6 (all depend only on C-1)
- Level 2: C-7 (depends on C-2, C-3, C-5, C-6)

C-5 and C-6 are at topological Level 1 but placed in Waves 3 and 4 due to the modules/ domain exclusivity constraint. This is structural safety, not a phantom dependency. The orchestrator may start C-5 as soon as C-1 completes AND no other modules/ commission is running.

## Risk Assessment

| Factor | Value | Assessment |
|--------|-------|------------|
| Critical path length | 6 waves (0-5) | **Medium** — modules/ sequencing adds 2 waves beyond the topological minimum of 3 |
| Largest wave | Wave 2 (3 commissions) | **Good** — maximum parallelism at the widest point |
| Shared surface changes | 5 changes, all <15 lines | **Low** — simple barrel updates and one backward-compatible type extension |
| New port count | 0 | **Low** — no new ports. All v2 modules use existing interfaces |
| Total commissions | 7 | **Medium** — manageable coordination overhead |
| New directory | 1 (`presets/`) | **Low** — single new directory in Wave 5 |
| Cross-package dependency | 1 (pacta-testkit → pacta types) | **Low** — existing dependency, just new types |

**Primary risk:** MonitorV2 (C-2) is the largest commission (15 test scenarios, most complex logic). If it runs long, it blocks nothing in Wave 3-4 (C-5/C-6 don't depend on C-2) but does block C-7 (preset integration).

**Mitigation:** C-2 is parallelized with C-3 and C-4 in Wave 2. The orchestrator can start C-5 as soon as Wave 1 completes + C-2 finishes, regardless of C-3/C-4 status.

## Status Tracker

```
Total: 7 commissions, 6 waves (0-5)
Estimated tasks: 31
Completed: 0 / 7

Wave 0: __ surface prep
Wave 1: __ C-1
Wave 2: __ C-2  __ C-3  __ C-4
Wave 3: __ C-5
Wave 4: __ C-6
Wave 5: __ C-7
Post:   __ documentation
```
