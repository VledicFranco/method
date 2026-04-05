# Realization Plan — PRD 048: Cybernetic Verification Loop

## PRD Summary

**Objective:** Close the VERIFY gap in the cognitive control loop. The architecture plans, retrieves, reasons, and acts — but doesn't check that actions achieved their intent. R-26 series proved T04/T06 fail because incorrect writes go undetected.

**Success Criteria:**
- SC-1: T04 pass rate ≥ 67% (N=5)
- SC-2: T06 pass rate ≥ 33% (N=5)
- SC-3: False-positive goal-satisfied ≤ 5%
- SC-4: No regression on T01/T02/T05 (≥ R-26b best)
- SC-5: Token overhead ≤ 20% above baseline

## FCA Partition

| Commission | Domain | Wave | Title | Depends On | Consumed Ports |
|------------|--------|------|-------|------------|---------------|
| C-1 | algebra | 1 | Verification type implementations | Wave 0 | — |
| C-2 | modules/verifier | 2 | Verifier cognitive module | C-1 | ProviderAdapter (frozen) |
| C-3 | algebra | 1 | Check primitives DSL | Wave 0 | — |
| C-4 | modules/planner | 2 | Planner CheckableKPI generation | C-3 | ProviderAdapter (frozen) |
| C-5 | experiments | 3 | Cycle VERIFY phase + correction loop | C-2, C-4 | — |
| C-6 | experiments | 4 | R-27 validation experiment | C-5 | — |

## Wave 0 — Shared Surfaces (Mandatory, Orchestrator-Applied)

### New File: `algebra/verification.ts`

All verification types defined in PRD 048 §New Algebra Surfaces:
- `VerificationState` — VFS contents + action history available to checks
- `KPICheckResult` — { met: boolean, evidence: string }
- `CheckableKPI` — description + optional check() predicate + met/evidence state
- `VerificationResult` — verified + kpiStatus[] + diagnosis + correction
- `CorrectionSignal` — problem + suggestion + unmetKPIs + failureCount

Check primitive functions (L0 pure functions):
- `fileExists(path)` → `Predicate<VerificationState>`
- `fileContains(path, pattern)` → `Predicate<VerificationState>`
- `fileExports(path, name)` → `Predicate<VerificationState>`
- `fileCountChanged(delta)` → `Predicate<VerificationState>`

### Module Signal Union Extension: `algebra/module.ts`

```typescript
export interface VerifierMonitoring extends MonitoringSignal {
  type: 'verifier';
  verified: boolean;
  kpisChecked: number;
  kpisPassing: number;
  failureStreak: number;
}
// Add to ModuleMonitoringSignal union
```

### Barrel Exports: `algebra/index.ts`

Export all types + check primitives from `verification.ts`.

### PlannerOutput Extension: `modules/planner.ts`

Add `checkableKpis: CheckableKPI[]` to `PlannerOutput` interface.

### Verification

After Wave 0 applied: `npm run build` passes. All existing tests pass.

---

## Wave 1 — Algebra (Parallel)

### C-1: Verification Type Implementations

```yaml
id: C-1
phase: Wave 0 of PRD 048
title: "Verification type implementations"
domain: cognitive/algebra
wave: 1
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/algebra/verification.ts"
    - "packages/pacta/src/cognitive/algebra/__tests__/verification.test.ts"
  forbidden_paths:
    - "packages/pacta/src/cognitive/modules/**"
    - "packages/pacta/src/cognitive/engine/**"
    - "experiments/**"
consumed_ports: []
produced_ports: []
deliverables:
  - "algebra/verification.ts — all type definitions implemented"
  - "algebra/__tests__/verification.test.ts — type construction + check primitive tests"
acceptance_criteria:
  - "All 5 types (VerificationState, KPICheckResult, CheckableKPI, VerificationResult, CorrectionSignal) constructable → SC-1,2"
  - "Check primitives (fileExists, fileContains, fileExports, fileCountChanged) evaluate correctly against mock VFS → SC-1,2"
  - "Build passes, 10+ unit tests"
estimated_tasks: 5
branch: "feat/prd048-c1-verification-types"
status: pending
```

### C-3: Check Primitives DSL

```yaml
id: C-3
phase: Wave 1 of PRD 048
title: "Check primitives DSL"
domain: cognitive/algebra
wave: 1
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/algebra/verification.ts"
    - "packages/pacta/src/cognitive/algebra/__tests__/verification.test.ts"
  forbidden_paths:
    - "packages/pacta/src/cognitive/modules/**"
    - "packages/pacta/src/cognitive/engine/**"
consumed_ports: []
produced_ports: []
deliverables:
  - "Check primitive functions: fileExists, fileContains, fileExports, fileCountChanged"
  - "Composition: and(), or() wrappers using methodts Predicate pattern"
  - "Tests for composition: and(fileExists(x), fileContains(x, y))"
acceptance_criteria:
  - "Primitives compose via and/or → SC-1"
  - "Each primitive has at least 2 test cases (pass + fail)"
estimated_tasks: 4
branch: "feat/prd048-c3-check-dsl"
status: pending
```

**NOTE:** C-1 and C-3 both touch `verification.ts` — they should be **merged into a single commission C-1+C-3** to avoid file conflicts. The types and check primitives live in the same file.

**Revised:** C-1+C-3 merged. Wave 1 has one commission.

---

## Wave 2 — Modules (Parallel)

### C-2: Verifier Cognitive Module

```yaml
id: C-2
phase: Wave 0 of PRD 048
title: "Verifier cognitive module"
domain: cognitive/modules
wave: 2
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/modules/verifier.ts"
    - "packages/pacta/src/cognitive/modules/__tests__/verifier.test.ts"
  forbidden_paths:
    - "packages/pacta/src/cognitive/algebra/**"
    - "packages/pacta/src/cognitive/engine/**"
    - "experiments/**"
consumed_ports:
  - name: "ProviderAdapter"
    status: frozen
  - name: "VerificationResult, CheckableKPI (from C-1+C-3)"
    status: frozen (Wave 0 + Wave 1)
produced_ports:
  - name: "createVerifier() factory"
depends_on: [C-1+C-3]
parallel_with: [C-4]
deliverables:
  - "modules/verifier.ts — CognitiveModule<VerifierInput, VerifierOutput, VerifierState, VerifierMonitoring, VerifierControl>"
  - "Two verification modes: programmatic (check predicates) + LLM fallback"
  - "modules/__tests__/verifier.test.ts — 12+ tests"
acceptance_criteria:
  - "Programmatic mode: fileExists check detects missing file → SC-1"
  - "LLM mode: falls back when no check() predicate → SC-1,2"
  - "CorrectionSignal produced on verification failure with diagnosis → SC-3"
  - "VerifierMonitoring tracks failureStreak → SC-3"
  - "Build passes, tests pass"
estimated_tasks: 6
branch: "feat/prd048-c2-verifier-module"
status: pending
```

### C-4: Planner CheckableKPI Generation

```yaml
id: C-4
phase: Wave 1 of PRD 048
title: "Planner CheckableKPI generation"
domain: cognitive/modules
wave: 2
scope:
  allowed_paths:
    - "packages/pacta/src/cognitive/modules/planner.ts"
    - "packages/pacta/src/cognitive/modules/__tests__/planner.test.ts"
  forbidden_paths:
    - "packages/pacta/src/cognitive/algebra/**"
    - "packages/pacta/src/cognitive/engine/**"
    - "experiments/**"
consumed_ports:
  - name: "CheckableKPI, check primitives (from C-1+C-3)"
    status: frozen (Wave 0 + Wave 1)
  - name: "ProviderAdapter"
    status: frozen
produced_ports: []
depends_on: [C-1+C-3]
parallel_with: [C-2]
deliverables:
  - "Extended Planner prompt to generate checkable assertions per KPI"
  - "Parser for check primitive DSL: file_exists(path), file_contains(path, pattern)"
  - "PlannerOutput.checkableKpis populated with Check predicates where parseable"
  - "Fallback: KPI without check() when DSL parsing fails"
  - "Tests: 6+ covering generation, parsing, fallback"
acceptance_criteria:
  - "T04 task produces CheckableKPIs with file_exists('src/handlers/v2.ts') → SC-1"
  - "Unparseable checks fall back to description-only → SC-5"
  - "Existing planner tests still pass"
estimated_tasks: 5
branch: "feat/prd048-c4-planner-kpi"
status: pending
```

---

## Wave 3 — Experiment Integration

### C-5: Cycle VERIFY Phase + Correction Loop

```yaml
id: C-5
phase: Wave 2 of PRD 048
title: "Cycle VERIFY phase + correction loop"
domain: experiments
wave: 3
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts"
  forbidden_paths:
    - "packages/pacta/src/**"
consumed_ports:
  - name: "createVerifier()"
    status: frozen (C-2)
  - name: "PlannerOutput.checkableKpis"
    status: frozen (C-4)
depends_on: [C-2, C-4]
deliverables:
  - "VERIFY phase after Write/Edit in unified-memory condition"
  - "CorrectionSignal injection into unified store on failure"
  - "Planner replan wiring: 3 consecutive failures → replanTrigger"
  - "Logging: verification pass/fail, correction signals, replan events"
acceptance_criteria:
  - "VERIFY runs after every Write/Edit action"
  - "CorrectionSignal appears in store with high salience on failure"
  - "Planner replans after 3 consecutive verification failures"
  - "Build passes"
estimated_tasks: 7
branch: "feat/prd048-c5-verify-phase"
status: pending
```

---

## Wave 4 — Validation

### C-6: R-27 Experiment + Documentation

```yaml
id: C-6
phase: Wave 3 of PRD 048
title: "R-27 validation experiment"
domain: experiments
wave: 4
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-5-cycle/run-slm-cycle.ts"
    - "experiments/log/**"
    - "experiments/AGENDA.md"
    - "docs/rfcs/006-anticipatory-monitoring.md"
  forbidden_paths:
    - "packages/pacta/src/**"
depends_on: [C-5]
deliverables:
  - "R-27: unified-memory + verification, N=5, T01-T06"
  - "Experiment log entry"
  - "AGENDA.md updated"
  - "RFC 006 updated with verification results"
acceptance_criteria:
  - "SC-1: T04 ≥ 67% (N=5)"
  - "SC-2: T06 ≥ 33% (N=5)"
  - "SC-3: False-positive goal-satisfied ≤ 5%"
  - "SC-4: T01/T02/T05 ≥ R-26b best"
  - "SC-5: Token overhead ≤ 20%"
estimated_tasks: 4
branch: "feat/prd048-c6-r27-validation"
status: pending
```

---

## Acceptance Gates (PRD → Commission Traceability)

| PRD SC | Description | Commissions |
|--------|-------------|-------------|
| SC-1 | T04 ≥ 67% | C-1+C-3 (check primitives), C-2 (verifier), C-5 (cycle), C-6 (validate) |
| SC-2 | T06 ≥ 33% | C-2 (verifier), C-5 (cycle), C-6 (validate) |
| SC-3 | False-positive ≤ 5% | C-2 (CorrectionSignal), C-5 (VERIFY before EVALUATE), C-6 (validate) |
| SC-4 | No regression T01/T02/T05 | C-5 (backward compat), C-6 (validate) |
| SC-5 | Token overhead ≤ 20% | C-2 (programmatic mode), C-4 (check primitives), C-6 (measure) |

## Verification Report

| Gate | Status |
|------|--------|
| Single-domain commissions | **PASS** (5 commissions, each single domain) |
| No wave domain conflicts | **PASS** (Wave 1: algebra only, Wave 2: modules only, Wave 3-4: experiments only) |
| DAG acyclic | **PASS** |
| Surfaces enumerated | **PASS** (4 surfaces, all frozen inline) |
| Scope complete | **PASS** (all commissions have allowed + forbidden paths) |
| Criteria traceable | **PASS** (all 5 SCs mapped to commissions) |
| PRD coverage | **PASS** (all SCs have at least one commission) |
| Task bounds | **PASS** (all 3-7 tasks) |
| Wave 0 non-empty | **PASS** (types + union + barrel + PlannerOutput) |
| All ports frozen | **PASS** (ProviderAdapter pre-existing, all new surfaces frozen) |

**Overall: 10/10 gates pass.**

## Risk Assessment

- **Critical path:** Wave 0 → C-1+C-3 → C-2 → C-5 → C-6 (4 sequential steps)
- **Largest wave:** Wave 2 (C-2 + C-4 in parallel, 11 tasks total)
- **Surface change count:** 4 (all simple, frozen inline)
- **New port count:** 0 (reuses ProviderAdapter)
- **API cost risk:** R-27 at N=5 with verification calls ≈ $5-8 in Anthropic credits

## Status Tracker

Total: 5 commissions, 5 waves (including Wave 0)
Completed: 0 / 5
