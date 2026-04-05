---
type: prd
title: "PRD 048: Cybernetic Verification Loop"
date: "2026-04-05"
status: draft
tier: heavyweight
depends_on: [45, 30, 44]
enables: []
blocked_by: []
complexity: high
domains: [algebra, modules/verifier, modules/planner, engine/cycle, experiments]
surfaces: [VerificationResult, CheckableKPI, CorrectionSignal, VerifierMonitoring]
rfc: "docs/rfcs/006-anticipatory-monitoring.md"
---

# PRD 048: Cybernetic Verification Loop

## Problem

The cognitive architecture plans well, retrieves the right context, and monitors
progress — but doesn't verify that individual actions achieved their intended
outcomes. R-26 series proved this definitively:

- **T04 (api-versioning):** Agent writes `src/handlers/v2.ts` and gets "file written
  successfully." Nobody checks that `handleOrderV2` is actually defined as an exported
  function. The agent proceeds to update the router referencing a function that doesn't
  exist. Result: 33% vs flat 100%.
- **T06 (multi-module-extract):** Agent writes files but to wrong paths or with incomplete
  content. `goal-satisfied` fires (false positive) because the Evaluator sees recent writes
  and concludes the task is done. Result: 0%.
- **False-positive termination:** 4 runs across R-26 series terminated with `goal-satisfied`
  on tasks that weren't actually complete.

The root cause: the VERIFY phase from cybernetic control theory is missing. The cycle
is PLAN → ACT → MONITOR but not PLAN → ACT → VERIFY → CORRECT → MONITOR. In
Carver-Scheier's model, the comparator checks the *outcome* of each action against the
*intended outcome*, not just the overall goal-state. Powers (1973) formalized this as
hierarchical perceptual control: each level verifies its own output before passing
control upward.

### The Full Cybernetic Control Loop (Target State)

| Phase | Function | Module | Status |
|-------|----------|--------|--------|
| PLAN | Design strategy, predict outcomes, define KPIs | Planner | Implemented (R-26c) |
| EXECUTE | Take action | ReasonerActor | Implemented |
| VERIFY | Check action outcome against intent | **Verifier (NEW)** | **GAP** |
| DIAGNOSE | Identify why verification failed | **Verifier (NEW)** | **GAP** |
| CORRECT | Retry with diagnostic feedback | **Verifier → ReasonerActor** | **GAP** |
| MONITOR | Track KPI movement, detect stagnation | Monitor + Evaluator | Implemented (R-22) |
| EVALUATE | Compare overall progress to goal | Evaluator (phase-aware) | Implemented (R-22) |
| REPLAN | Revise strategy on repeated failure | Planner (replan trigger) | **Mechanism exists, unwired** |

## Constraints

- **Backward compatible.** All existing conditions and tests pass unchanged. The
  verification loop is opt-in (activated by configuration).
- **Algebra-compliant.** Verifier is a `CognitiveModule<I, O, S, mu, kappa>` with the
  same step contract. New types live in `algebra/`.
- **FCA-compliant.** Verifier module in `modules/verifier.ts`. Algebra types in
  `algebra/`. Cycle changes in `engine/`. No cross-layer imports.
- **Reuse methodts primitives.** The `Gate<S>`, `Predicate<A>`, `executeWithRetry`,
  `GateResult`, and `EvalTrace` from `@method/methodts` provide the verification
  infrastructure. The Verifier composes these, not reinvents them.
- **Token budget.** Verification adds LLM calls. Budget: ≤ 1 verification call per
  write action (not per cycle). Total overhead ≤ 20% of ReasonerActor tokens.
- **Graceful degradation.** When verification is unavailable (no provider), fall back
  to current behavior (no verification).

## Architecture

### Layer Stack (dependency flows downward)

```
L4  engine/cycle.ts           Orchestrator — adds VERIFY phase after ACT
L3  modules/verifier.ts       Verifier module — CognitiveModule contract
    modules/planner.ts         Planner — produces CheckableKPIs (extended)
L2  algebra/verification.ts   Verification types: CheckableKPI, VerificationResult, CorrectionSignal
    algebra/goal-types.ts      Extended: KPI now has checkable predicate variant
L1  @method/methodts           Gate<S>, Predicate<A>, executeWithRetry, GateResult
```

### New Algebra Surfaces

```typescript
// algebra/verification.ts

/**
 * A KPI with an optional machine-checkable predicate.
 * When check() is present, the Verifier can validate without an LLM call.
 * When absent, falls back to LLM-based assessment.
 */
interface CheckableKPI {
  /** Human-readable description (same as current KPI string). */
  description: string;
  /** Machine-checkable predicate. Runs against the virtual filesystem state. */
  check?: (state: VerificationState) => KPICheckResult;
  /** Whether this KPI was met in the last verification. */
  met: boolean;
  /** Evidence for the current status. */
  evidence: string;
}

interface KPICheckResult {
  met: boolean;
  evidence: string;
}

/** State available to KPI checks — VFS contents + action history. */
interface VerificationState {
  /** Current virtual filesystem. */
  files: ReadonlyMap<string, string>;
  /** Last action taken. */
  lastAction: { tool: string; input: unknown; result: unknown };
  /** All actions taken this run. */
  actionHistory: Array<{ tool: string; cycle: number }>;
}

/**
 * Result of verifying the last action's outcome.
 * Returned by the Verifier module step().
 */
interface VerificationResult {
  /** Did the action achieve its intended outcome? */
  verified: boolean;
  /** Which KPIs moved (positive), which failed (negative). */
  kpiStatus: Array<{ kpi: string; met: boolean; evidence: string }>;
  /** Diagnosis if verification failed. */
  diagnosis?: string;
  /** Suggested correction action if failed. */
  correction?: CorrectionSignal;
}

/**
 * Signal injected into the store when verification fails.
 * Drives the CORRECT phase — the ReasonerActor reads this and
 * adjusts its next action accordingly.
 */
interface CorrectionSignal {
  /** What went wrong (specific, actionable). */
  problem: string;
  /** Suggested fix (specific, actionable). */
  suggestion: string;
  /** Which KPIs remain unmet. */
  unmetKPIs: string[];
  /** How many verification failures for this subgoal. */
  failureCount: number;
}
```

### Verifier Module

```
modules/verifier.ts

CognitiveModule<VerifierInput, VerifierOutput, VerifierState, VerifierMonitoring, VerifierControl>

Input:
  - lastAction: { tool, input, result }
  - workspaceSnapshot: ReadonlyWorkspaceSnapshot
  - kpis: CheckableKPI[]
  - currentSubgoal: string (from Planner)

Output:
  - verification: VerificationResult
  - correctionSignal?: CorrectionSignal (when verification fails)

State:
  - verificationHistory: VerificationResult[]
  - consecutiveFailures: number
  - workingMemory: ModuleWorkingMemory (tracks what's been verified)

Monitoring:
  - type: 'verifier'
  - verified: boolean
  - kpisChecked: number
  - kpisPassing: number
  - failureStreak: number
```

### Two Verification Modes

**Mode 1: Programmatic (Gate-based, zero LLM cost)**

When `CheckableKPI.check()` is defined, the Verifier runs it directly against the
VFS state. This uses methodts `Gate<VerificationState>` + `Predicate<VerificationState>`:

```typescript
const gate = createGate({
  id: 'kpi-v2-handler-exists',
  description: 'v2.ts handler file created with handleOrderV2',
  predicate: check('handleOrderV2 exported', (state) =>
    state.files.has('src/handlers/v2.ts') &&
    state.files.get('src/handlers/v2.ts')!.includes('export function handleOrderV2')
  ),
  maxRetries: 0,
});
```

**Mode 2: LLM-based (when no programmatic check available)**

When `CheckableKPI.check()` is absent, the Verifier asks the LLM evaluator:
"Given this action (Write src/handlers/v2.ts with content X) and this KPI
(v2 handler file created with correct response format), was the KPI satisfied?"

This is the same pattern as the phase-aware evaluator: structured XML response,
parsed into VerificationResult. Falls back to "assumed verified" on parse failure.

### Planner Extension: Generating CheckableKPIs

The Planner already generates string KPIs. This PRD extends it to generate
structured CheckableKPIs with check functions when possible.

**LLM-generated checks:** The Planner's LLM call includes a prompt to generate
checkable assertions:

```
For each KPI, also suggest a machine-checkable test:
<kpi>
<description>v2.ts handler file created</description>
<check>file_exists('src/handlers/v2.ts')</check>
</kpi>
```

The Planner parses these into a small DSL of check primitives:
- `file_exists(path)` — file exists in VFS
- `file_contains(path, pattern)` — regex match in file content
- `file_exports(path, name)` — exports a named symbol
- `file_count_changed(delta)` — N new files created

These compose via methodts `Predicate<S>`: `and(file_exists(...), file_contains(...))`.

### Cycle Integration

The VERIFY phase runs **after ACT, before MONITOR**, only when the last action was
a Write or Edit:

```
Cycle N:
  OBSERVE (cycle 0)
  PLAN (cycle 0, replan on trigger)
  RETRIEVE (unified store)
  REASON+ACT (ReasonerActor)
  → if action was Write/Edit:
      VERIFY (Verifier module)
      → if verified: inject SUCCESS entry into store
      → if failed:
          inject CorrectionSignal into store (high salience)
          increment failureCount
          if failureCount >= 3: trigger Planner replan
  MONITOR
  EVALUATE
```

The CorrectionSignal is a high-salience entry in the unified store tagged
`role: 'correction'`. The ReasonerActor's next retrieval will surface it
via spreading activation (the correction mentions the specific file/function
that failed, matching the working memory cues).

### Retry Behavior (from methodts executeWithRetry)

When verification fails, the correction signal provides:
1. **What went wrong:** "handleOrderV2 is referenced but not exported"
2. **Suggested fix:** "Add 'export' keyword to the function definition in v2.ts"
3. **Unmet KPIs:** ["v2.ts handler file created with handleOrderV2 exported"]

The ReasonerActor reads this in its next cycle and should:
- See the correction signal (high salience, spreading activation match)
- See its working memory ("step 1: create v2.ts [x], step 2: update router [ ]")
- Prioritize fixing the failed write over proceeding to the next subgoal

After 3 consecutive verification failures on the same subgoal, the Monitor
triggers Planner replanning — the strategy is fundamentally wrong, not just
the implementation.

### Planner Replan Wiring

The Planner's `replanTrigger` mechanism (already implemented) is wired:

```
Monitor detects: verifier.failureStreak >= 3
  → control directive to Planner: { replanTrigger: "3 consecutive verification failures on [subgoal]" }
  → Planner re-invokes LLM with:
      - Original goal
      - Current working memory
      - Failure history
      - "Previous approach failed. Try a different strategy."
  → Produces revised TaskAssessment + new subgoals
  → Injected into store, working memory updated
```

## Success Criteria

1. **T04 pass rate ≥ 67%.** Verification catches "handleOrderV2 referenced but not
   defined" and triggers corrective write. Measured: N=5 pass rate.
2. **T06 pass rate ≥ 33%.** Extended budget + verification catches incomplete
   extractions. Measured: N=5 pass rate.
3. **False-positive goal-satisfied ≤ 5%.** Verification confirms KPIs before
   Evaluator can declare satisfied. Measured: satisfied on failed runs.
4. **No regression on T01/T02/T05.** Verification overhead doesn't hurt easy tasks.
   Measured: pass rates ≥ R-26b best (100%, 100%, 100%).
5. **Token overhead ≤ 20%.** Verification calls add ≤ 7K tokens per run on top of
   ~35K baseline. Measured: total tokens with vs without verification.

## Implementation Waves

### Wave 0: Algebra Surfaces + Verifier Module

**Files:** `algebra/verification.ts`, `modules/verifier.ts`, `modules/__tests__/verifier.test.ts`
**Deliverables:** Types, Verifier CognitiveModule with LLM-based verification mode.
**Gate:** Unit tests pass. Build succeeds.

### Wave 1: Planner CheckableKPI Generation

**Files:** `modules/planner.ts` (extended), `algebra/verification.ts` (check primitives DSL)
**Deliverables:** Planner generates CheckableKPIs with `file_exists`, `file_contains` checks.
Verifier runs programmatic checks before LLM fallback.
**Gate:** Planner tests pass. Verifier uses programmatic checks on T04 KPIs.

### Wave 2: Cycle Integration + Correction Loop

**Files:** Experiment runner (`run-slm-cycle.ts` unified-memory condition)
**Deliverables:** VERIFY phase in cycle, CorrectionSignal injection, Planner replan wiring.
**Gate:** R-27 experiment: T04 ≥ 67%, T06 ≥ 33%, false-positive ≤ 5%.

### Wave 3: Validation + Refinement

**Deliverables:** N=5 replication, log entry, AGENDA/RFC update.
**Gate:** Success criteria met. Full documentation pass.

## Scope

**In scope:**
- Verifier module (CognitiveModule contract)
- CheckableKPI types + check primitives DSL
- LLM-based verification mode (fallback)
- CorrectionSignal type + store injection
- Cycle VERIFY phase (after ACT, before MONITOR)
- Planner replan wiring (3 consecutive failures → replan)
- Experiment runner integration (unified-memory condition)

**Out of scope:**
- Production cycle.ts changes (experiment runner only for now)
- SLM compilation of Verifier (future — RFC 002 pipeline)
- Multi-agent verification (single agent only)
- Human-in-the-loop verification (OversightRule from methodts — future)

## Relationship to Existing Work

- **PRD 045 (Goal-State Monitoring):** VERIFY operates at action level, PRD 045 at
  goal level. Complementary — Verifier checks steps, Evaluator checks trajectory.
- **RFC 006 (Anticipatory Monitoring):** VERIFY closes the last gap in the cybernetic
  control loop. Part I (anticipatory), Part II (working memory), Part III (unified
  memory) are prerequisites. Part IV is this PRD.
- **RFC 001 (Cognitive Composition):** The Reflector module (LEARN phase) is related
  but operates post-session. The Verifier operates within the session, per-action.
- **@method/methodts:** Gate, Predicate, executeWithRetry, GateResult provide the
  infrastructure. The Verifier composes them into the cognitive module contract.
