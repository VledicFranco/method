---
title: "PRD 043: Workspace Constraint Pinning & Violation Detection"
status: draft
date: "2026-03-30"
tier: "standard"
depends_on: [30, 35]
enables: []
blocked_by: []
complexity: "medium"
domains_affected: ["cognitive/algebra", "cognitive/modules", "cognitive/engine"]
review:
  findings_total: 15
  critical_resolved: 4
  high_resolved: 7
  deferred: 3
  acknowledged: 1
---

# PRD 043: Workspace Constraint Pinning & Violation Detection

## Problem Statement

The cognitive cycle (RFC 001) scores **0% on constraint-adherence tasks** (T04) while flat ReAct agents score 100%. This is a deterministic, replicated failure — 8/8 cognitive runs across R-14 (N=5) and R-03 (N=3) identically violate the "must NOT import notifications" constraint.

**Root cause (two compounding failures):**

1. **Eviction blindness:** The single-workspace architecture uses one eviction policy for all information types. When tool results fill the workspace, salience-based eviction removes constraint entries (low recency salience) before the Reasoner sees them.

2. **No violation detection:** The Monitor detects action-level stagnation (repeated reads) but has no mechanism to detect semantic violations in produced artifacts. A Write that violates constraints produces no signal — it looks like a successful action.

**Evidence:**
- R-14 (N=25): T04 cognitive 0/5, flat 5/5. Overall flat 80% vs cognitive 60%.
- R-03 (N=12): T04 cognitive 0/3, flat 3/3. Overall flat 92% vs cognitive 58%.
- R-15 (N=7): Threshold ablation at t=2,3,4 — identical T04 failure regardless of threshold.
- T04 run 3: 63K token Write→Read spiral while violating constraint.

This blocks the cognitive architecture from production use on tasks with syntactically explicit constraints (prohibitions, invariants). Note: this PRD addresses explicit prohibition-class constraints ("must NOT X"). Generalization to other constraint types (temporal, structural, semantic) is a Phase 1+ concern dependent on classifier evolution.

**Compounding library bug (cycle.ts only):** The Monitor generates `restrictedActions` and `forceReplan` (monitor.ts:247), but the cycle orchestrator never passes them to downstream modules (cycle.ts:398,503 use `defaultControl()`). The experiment runner (run.ts) has its own loop that correctly wires Monitor output — so this is a library correctness fix, not on the critical path for R-13.

## Objective

Ship the implementation needed to produce a **strong, conclusive R-13 experiment** that decomposes the constraint-blindness hypothesis into independently testable claims. Both outcomes are valuable:

- **Pass (T04 ≥ 80%):** Constraint blindness is a workspace-eviction problem, solvable by pinning. Validates RFC 003 Phase 0. Opens path to Phase 1+ partition architecture.
- **Fail (T04 < 80% despite constraints in context):** Constraint blindness is deeper — the Reasoner ignores constraints even when they're present. R-13 diagnostics tell us exactly where the pipeline broke, redirecting research with precision.

**Experimental rigor:** R-13 uses decomposed conditions (pinning-only vs pinning+recovery) so we can attribute success or failure to specific mechanisms, not the bundle.

## Architecture & Design

### Change Map

All changes within `@method/pacta` (L3), `src/cognitive/` subtree, plus experiment runner:

```
packages/pacta/src/cognitive/
  algebra/
    workspace-types.ts    ← Add pinned + contentType to WorkspaceEntry
    workspace.ts          ← evictLowest() skips pinned; maxPinnedEntries cap
    events.ts             ← 3 new diagnostic event types
    index.ts              ← Re-export new types
  modules/
    constraint-classifier.ts  ← NEW: classification + violation check (pure functions)
    observer.ts               ← Uses classifier on task input only (not tool results)
  engine/
    cycle.ts              ← Post-ACT constraint verification (always-on); Monitor wiring fix

experiments/exp-cognitive-baseline/
    run.ts                ← Post-ACT constraint verification; R-13 conditions
```

### Design Decisions

**D1: Pin flag over separate storage.**
The pin flag (`pinned?: boolean`) is a single-field extension to `WorkspaceEntry` that prevents eviction without restructuring the workspace. It tests the core hypothesis: "if constraints stay in context, does the Reasoner respect them?"

**D2: Rule-based keyword classifier over LLM classification.**
T04 constraints are syntactically explicit ("must NOT", "do not", "never"). A regex-based classifier is deterministic, testable, zero-cost, and sufficient for the experiment. R-13 diagnostics measure false-negative/positive rates to inform Phase 1+ decisions.

**D3: Classify task input only, not tool results.**
The classifier runs only on Observer input content (user/task prompts), NOT on tool-result content. Tool results (file reads, command output) always classify as `operational`. This prevents false-positive pinning of source code containing words like "create", "never", or "constraint" in comments/identifiers. [Finding F-H-5]

**D4: Constraint violation check as always-on pure function, not inside Monitor.**
The constraint-violation check is a deterministic pure function (`checkConstraintViolations()`) in `constraint-classifier.ts` that runs unconditionally after every ACT phase — NOT inside the Monitor module. This solves two problems: (a) the Monitor's `step()` takes `AggregatedSignals` as input and has no workspace access (adding a workspace port would change its interface boundary); (b) in cycle.ts, the Monitor only runs when `shouldIntervene()` triggers (default-interventionist gate), which is based on stagnation signals — constraint violations would never be checked on the normal path. Making it always-on and separate ensures constraint verification happens every cycle regardless of Monitor intervention status. [Findings F-A-1, F-A-2]

**D5: cycle.ts wiring fix is a library correctness fix, separate from R-13.**
The experiment runner (run.ts) has its own loop that already wires Monitor output to Actor control (run.ts:479-481). Fixing cycle.ts is correct for the library but does NOT affect R-13 results. This avoids the R-12 mistake of fixing cycle.ts while the experiment uses its own divergent path. [Findings F-H-1, F-I-1]

**D6: Decomposed experiment conditions.**
R-13 uses two experimental conditions to isolate which mechanism drives the result: (a) `pinning-only` — pin flag + classifier, no violation check; (b) `pinning+recovery` — full stack including post-ACT violation check and recovery. If (a) passes, pinning alone suffices. If (a) fails but (b) passes, the recovery loop is load-bearing. If both fail, the problem is deeper than eviction. [Finding F-S-1]

**D7: `contentType` as string literal union.**
`contentType` uses a closed union type (`'constraint' | 'goal' | 'operational'`), not an open string, to prevent classifier drift and ensure type safety. [Finding F-A-3]

**D8: Diagnostic events for experiment quality.**
Three new `CognitiveEvent` types provide observability. Without them, an R-13 failure is just another 0%. With them, we know: was the constraint detected? Was it pinned? Was the violation caught? Did recovery fire? How many entries were pinned per run (false-positive tracking)?

### Constraint Classifier Specification

Located in `constraint-classifier.ts` — pure functions, zero dependencies:

```typescript
/** Closed union — prevents classifier drift. */
export type EntryContentType = 'constraint' | 'goal' | 'operational';

/** Constraint detection patterns (Phase 0 — rule-based). */
const CONSTRAINT_PATTERNS = [
  /\b(must\s+not|must\s+never|shall\s+not|cannot|can\s+not)\b/i,
  /\b(do\s+not|don'?t|never|prohibited|forbidden)\b/i,
  /\b(constraint|invariant|boundary|requirement):/i,
  /\bCRITICAL:/i,
];

const GOAL_PATTERNS = [
  /\b(your\s+task)\b/i,
  /\b(objective|goal|deliverable)\b/i,
];

/**
 * Classify task input content. Only call on Observer input (user/task prompts),
 * NOT on tool results. Tool results always classify as 'operational'.
 */
export function classifyEntry(content: string): {
  contentType: EntryContentType;
  pinned: boolean;
  matchedPatterns: string[];
} {
  const text = typeof content === 'string' ? content : String(content);
  const matchedPatterns: string[] = [];

  // Constraint patterns first (higher priority)
  for (const pattern of CONSTRAINT_PATTERNS) {
    if (pattern.test(text)) {
      matchedPatterns.push(pattern.source);
      return { contentType: 'constraint', pinned: true, matchedPatterns };
    }
  }

  // Goal patterns
  for (const pattern of GOAL_PATTERNS) {
    if (pattern.test(text)) {
      return { contentType: 'goal', pinned: false, matchedPatterns: [] };
    }
  }

  return { contentType: 'operational', pinned: false, matchedPatterns: [] };
}
```

**Note on GOAL_PATTERNS (F-H-5 fix):** The patterns are intentionally narrow (`your task`, `objective`, `goal`, `deliverable`) — NOT the broad set from RFC 003 (`implement`, `create`, `build`, `add`, `update`, `modify`, `fix`) which would false-positive on every tool result containing source code. The classifier only runs on task input anyway (D3), but narrow patterns provide defense-in-depth.

**Known limitations:**
- False negatives on implicit constraints ("avoid side effects" without "must not")
- Single-label classification — constraint wins over goal (intentional: safety-critical case)
- R-13 measures false-negative/positive rates to inform Phase 1+

### Constraint Violation Check (Always-On)

Also in `constraint-classifier.ts` — separate from Monitor:

```typescript
export interface ConstraintViolation {
  constraint: string;     // The violated constraint text (truncated)
  violation: string;      // What matched in actor output (truncated)
  pattern: string;        // The prohibition regex that triggered
}

/**
 * Extract prohibition predicates from constraint text.
 * Returns actionable regexes for post-Write matching.
 *
 * Phase 0: handles "must NOT import/use/trigger/call X" patterns.
 * R-13 diagnostics track: (a) how many constraints have extractable predicates,
 * (b) how many violations are caught. These are separate metrics.
 */
export function extractProhibitions(constraintContent: string): RegExp[] {
  const prohibitions: RegExp[] = [];
  const text = String(constraintContent);

  // "must NOT import/use/trigger/call X" → /import.*X/i (or /X/i for trigger/call)
  const verbMatch = text.match(
    /must\s+(?:not|never)\s+(import|use|trigger|call)\s+(\w[\w\s]*?)(?:\s+(?:or|and)\b|\.|,|$)/i,
  );
  if (verbMatch) {
    const [, verb, target] = verbMatch;
    const trimmed = target.trim();
    if (verb.toLowerCase() === 'import') {
      prohibitions.push(new RegExp(`import.*${trimmed}`, 'i'));
    } else {
      prohibitions.push(new RegExp(trimmed, 'i'));
    }
  }

  // "must NOT trigger X" (alternate form)
  const triggerMatch = text.match(/must\s+not\s+trigger\s+(.+?)(?:\.|,|$)/i);
  if (triggerMatch && !verbMatch) {
    prohibitions.push(new RegExp(triggerMatch[1].trim(), 'i'));
  }

  return prohibitions;
}

/**
 * Check actor output against pinned workspace constraints.
 * Pure function — no workspace access needed, takes entries as input.
 * Returns violations found (empty array = no violations).
 */
export function checkConstraintViolations(
  pinnedConstraints: Array<{ content: unknown }>,
  actorOutput: string,
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  for (const entry of pinnedConstraints) {
    const constraintText = String(entry.content);
    const prohibitions = extractProhibitions(constraintText);

    for (const pattern of prohibitions) {
      const match = actorOutput.match(pattern);
      if (match) {
        violations.push({
          constraint: constraintText.slice(0, 200),
          violation: match[0].slice(0, 200),
          pattern: pattern.source,
        });
      }
    }
  }

  return violations;
}
```

### Integration: Post-ACT Constraint Verification

**In run.ts (experiment runner):** After the ReasonerActor step, before the next cycle:

```typescript
// After raResult (reasoner-actor step)
const pinnedEntries = workspace.read().filter(e => e.pinned);
const actorContent = typeof raResult.output === 'string'
  ? raResult.output
  : JSON.stringify(raResult.output);
const violations = checkConstraintViolations(pinnedEntries, actorContent);

if (violations.length > 0) {
  // Emit diagnostic events
  for (const v of violations) {
    emitEvent({ type: 'cognitive:constraint_violation', ...v, timestamp: Date.now() });
  }
  // Set recovery directives for next cycle
  raControl.restrictedActions = ['Write'];
  raControl.forceReplan = true;
  raControl.strategy = 'think';
}
```

**In cycle.ts (library):** After Phase 7 (ACT), before Phase 8 (LEARN):

```typescript
// Post-ACT constraint verification (always-on, not gated by shouldIntervene)
const pinnedEntries = workspace.snapshot().filter(e => e.pinned);
if (pinnedEntries.length > 0 && actResult?.output) {
  const actContent = typeof actResult.output === 'string'
    ? actResult.output
    : JSON.stringify(actResult.output);
  const violations = checkConstraintViolations(pinnedEntries, actContent);
  // Log violations as events; set forceReplan for next cycle
}
```

### Monitor Output Wiring (Library Bug Fix)

Separate from the constraint pipeline. In cycle.ts:

**Current (broken):** Line 503 — Actor always gets `defaultControl()`.

**Fixed:** When Monitor has run (Phase 5), extract its output and forward to Actor:

```typescript
const monitorOutput = monitorResult?.output as MonitorReport | undefined;
const actorControl = {
  ...defaultControl(modules.actor),
  restrictedActions: monitorOutput?.restrictedActions ?? [],
  forceReplan: monitorOutput?.forceReplan ?? false,
};
```

**Note:** The experiment runner (run.ts:479-481) already does this correctly. This fix aligns the library with the experiment runner's behavior.

### Workspace Safety: maxPinnedEntries Cap

To prevent unbounded growth from classifier false positives [Finding F-A-4]:

```typescript
// In WorkspaceConfig
maxPinnedEntries?: number;  // Default: 10. Safety cap.

// In evictLowest()
// If all entries are pinned and count >= maxPinnedEntries,
// evict the oldest pinned entry (timestamp-based).
```

### Diagnostic Events

Three new event types added to `CognitiveEvent` union:

```typescript
/** Emitted when Observer classifies and pins a constraint entry. */
export interface CognitiveConstraintPinned {
  type: 'cognitive:constraint_pinned';
  content: string;        // Truncated (first 200 chars)
  matchedPatterns: string[];
  pinnedCount: number;    // Total pinned entries after this one
  timestamp: number;
}

/** Emitted when post-ACT check detects a constraint violation. */
export interface CognitiveConstraintViolation {
  type: 'cognitive:constraint_violation';
  constraint: string;     // Truncated
  violation: string;      // What matched
  pattern: string;        // Prohibition regex
  timestamp: number;
}

/** Emitted when Monitor/violation directives are applied to downstream modules. */
export interface CognitiveMonitorDirectiveApplied {
  type: 'cognitive:monitor_directive_applied';
  restrictedActions: string[];
  forceReplan: boolean;
  source: 'monitor' | 'constraint-violation';  // Which system triggered it
  targetModule: string;
  timestamp: number;
}
```

## Alternatives Considered

### Alternative 1: Full Partition Architecture (RFC 003 Phase 2)
**Approach:** Split workspace into 3 typed partitions with independent eviction policies.
**Pros:** Comprehensive — solves constraint blindness, token waste, and goal drift.
**Cons:** 2-3 weeks. Unvalidated hypothesis. If the Reasoner ignores in-context constraints, partitioning won't help.
**Why rejected:** Violates evidence-gated principle. Pin flag tests the core hypothesis cheaply first.

### Alternative 2: Prompt Engineering
**Approach:** Add "always check constraints" to Reasoner system prompt.
**Pros:** Zero code changes.
**Cons:** The constraint is evicted before the Reasoner's LLM call. Information-loss problem, not instruction-following.
**Why rejected:** Doesn't address root cause.

### Alternative 3: Increase Workspace Capacity
**Approach:** Raise capacity from ~8 to 200+ entries.
**Pros:** Delays eviction.
**Cons:** Delays but doesn't prevent eviction. R-07 showed large context degrades to 22% success (context pollution). Pinning also increases effective context — but pinned entries are few (1-3) vs 200+ capacity, so the effect is bounded. R-13 tracks pinned-entry count to verify this.
**Why rejected:** Palliative, not curative.

### Alternative 4: Constraint Check Inside Monitor Module
**Approach:** Add `checkConstraintViolations()` to Monitor's `step()`.
**Pros:** Keeps all anomaly detection in one module.
**Cons:** Monitor takes `AggregatedSignals`, not workspace — adding a workspace port changes its interface boundary. In cycle.ts, Monitor only runs when `shouldIntervene()` triggers (default-interventionist), so the constraint check would never fire on the normal path. In run.ts, Monitor runs every cycle, so it would work there — but only by accident of the experiment runner's design.
**Why rejected:** Architecturally wrong (Monitor shouldn't need workspace access) and unreliable (gated in library, ungated in experiments). Separate always-on function is cleaner. [Findings F-A-1, F-A-2]

## Scope

### In-Scope
- `pinned` and `contentType` fields on `WorkspaceEntry` (contentType as closed union)
- Eviction skip logic for pinned entries with `maxPinnedEntries` safety cap
- Rule-based constraint keyword classifier in Observer (task input only, not tool results)
- Post-ACT constraint-violation check as always-on pure function in `constraint-classifier.ts`
- Monitor output wiring in cycle.ts (library bug fix)
- Diagnostic events for constraint pipeline observability
- R-13 experiment with decomposed conditions (pinning-only vs pinning+recovery), N≥10 on T04
- Unit tests for all new logic

### Out-of-Scope
- Full partition architecture (RFC 003 Phase 1+)
- Per-module context selectors (RFC 003 Phase 1)
- SLM-compiled classification (RFC 002 synergy)
- Token-based capacity management
- Generalization to non-prohibition constraint types (temporal, structural, semantic)
- Changes to PriorityAttend salience function
- Changes to experiment task definitions (T01-T05)

### Non-Goals
- This PRD does not aim to make cognitive beat flat on all tasks. It fixes the T04 structural failure and measures the result.
- This PRD addresses syntactically explicit prohibitions only. Measuring false-negative rate on other constraint types is a Phase 1+ concern.

## Implementation Phases

### Phase 1: Workspace Pinning & Types (algebra)

**Deliverables:**

Files:
- `packages/pacta/src/cognitive/algebra/workspace-types.ts` — modified — add `pinned?: boolean` and `contentType?: EntryContentType` to `WorkspaceEntry`; add `EntryContentType = 'constraint' | 'goal' | 'operational'` union type; add `maxPinnedEntries?: number` to `WorkspaceConfig`
- `packages/pacta/src/cognitive/algebra/workspace.ts` — modified — `evictLowest()` skips entries where `pinned === true` (falls back to oldest-pinned eviction when all entries are pinned and count >= maxPinnedEntries); spread operator at line ~277 preserves `pinned` and `contentType` fields on write
- `packages/pacta/src/cognitive/algebra/events.ts` — modified — add `CognitiveConstraintPinned`, `CognitiveConstraintViolation`, `CognitiveMonitorDirectiveApplied` to event union
- `packages/pacta/src/cognitive/algebra/index.ts` — modified — re-export new types

Tests:
- `packages/pacta/src/cognitive/algebra/__tests__/workspace.test.ts` — modified — 6 new scenarios:
  1. Pinned entry survives eviction when capacity is full
  2. Non-pinned entry is evicted normally when capacity is full
  3. Multiple pinned entries all survive — non-pinned evicted first
  4. Workspace at capacity with ALL pinned entries and count < maxPinnedEntries — exceeds capacity by 1
  5. Workspace at maxPinnedEntries cap — oldest pinned entry evicted
  6. Write preserves pinned and contentType fields through spread

**Dependencies:** None.

**Checkpoint:** `npm run build` passes. Workspace tests pass. No type errors in downstream consumers.

### Phase 2: Constraint Classifier & Observer Integration (modules)

**Deliverables:**

Files:
- `packages/pacta/src/cognitive/modules/constraint-classifier.ts` — new — `EntryContentType`, `classifyEntry()`, `extractProhibitions()`, `checkConstraintViolations()`, `ConstraintViolation`. Pure functions, zero dependencies, independently testable.
- `packages/pacta/src/cognitive/modules/observer.ts` — modified — import classifier; in `step()`, classify input.content (task input only) and set `pinned` + `contentType` on workspace entry BEFORE calling `writePort.write(entry)`. Classification is skipped when `input.source` indicates a tool result (e.g., `source !== 'user' && source !== 'task'`).

Tests:
- `packages/pacta/src/cognitive/modules/__tests__/constraint-classifier.test.ts` — new — 15 scenarios:
  1. "must NOT import notifications" → constraint, pinned
  2. "CRITICAL: do not use the audit service" → constraint, pinned
  3. "never call sendNotification" → constraint, pinned
  4. "shall not modify the database" → constraint, pinned
  5. "Your task: implement a v2 handler" → goal, not pinned
  6. "Build a REST endpoint" → operational (narrow GOAL_PATTERNS)
  7. "File content: const x = 42" → operational, not pinned
  8. Tool result (object content, not string) → operational, not pinned
  9. Mixed content: "implement X but must NOT import Y" → constraint, pinned
  10. `extractProhibitions("must NOT import notifications")` → `[/import.*notifications/i]`
  11. `extractProhibitions("must NOT trigger audit logging")` → `[/audit logging/i]`
  12. `extractProhibitions("Your task: implement v2")` → `[]` (no extractable predicate)
  13. Empty string → operational, not pinned
  14. `checkConstraintViolations([{content: "must NOT import notifications"}], "import { x } from 'notifications'")` → 1 violation
  15. `checkConstraintViolations([{content: "must NOT import notifications"}], "const x = 42")` → 0 violations

- `packages/pacta/src/cognitive/modules/__tests__/observer.test.ts` — modified — 4 new scenarios:
  1. Observer sets `pinned: true` and `contentType: 'constraint'` for constraint task input
  2. Observer sets `contentType: 'goal'` for goal task input
  3. Observer sets `contentType: 'operational'` for generic input
  4. Observer does NOT classify tool-result content (always operational)

**Dependencies:** Phase 1 (WorkspaceEntry fields).

**Checkpoint:** `npm run build` passes. Classifier + Observer tests pass.

### Phase 3: Post-ACT Verification & Wiring Fix (engine + experiments)

**Deliverables:**

Files:
- `packages/pacta/src/cognitive/engine/cycle.ts` — modified — (a) after Phase 7 (ACT), add always-on constraint verification: read pinned entries, call `checkConstraintViolations()`, emit events; (b) when Monitor has run in Phase 5, extract `restrictedActions`/`forceReplan` from Monitor output and pass to Actor control in Phase 7 (library wiring fix)
- `experiments/exp-cognitive-baseline/run.ts` — modified — add post-ACT constraint verification: read pinned entries, call `checkConstraintViolations()`, emit events, set recovery directives (`restrictedActions: ['Write']`, `forceReplan: true`)

Tests:
- `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts` — modified — 4 new scenarios:
  1. Post-ACT constraint verification catches violation and emits event
  2. Post-ACT verification with no pinned entries is a no-op
  3. Monitor restrictedActions reach Actor control directive (wiring fix)
  4. When Monitor doesn't intervene, Actor gets default control (regression)

**Dependencies:** Phase 1 (events, workspace pinning), Phase 2 (classifier functions).

**Checkpoint:** `npm run build` passes. Full `npm test` passes (no regressions).

### Phase 4: R-13 Experiment (~2-3 days)

**Deliverables:**

Files:
- `experiments/exp-cognitive-baseline/run.ts` — modified — add R-13 configurations for two experimental conditions
- `experiments/log/2026-MM-DD-exp-cognitive-baseline-r13.yaml` — new — experiment results

Experiment Design:

**Conditions (3):**
- `flat` — control (unchanged from R-14)
- `cognitive-pinned` — pin flag + classifier, NO post-ACT violation check. Tests: "does keeping constraints in context suffice?"
- `cognitive-pinned-recovery` — pin flag + classifier + post-ACT violation check + recovery directives. Tests: "does violation detection + recovery add value?"

**Module set:** V1 modules (matching R-14 for comparability). V2 integration is a follow-up. [Finding F-H-4]

**Task allocation:**
- T04 (primary): N=10 per condition (30 runs)
- T01, T02, T03, T05 (regression): N=5 per condition (60 runs)
- **Total: 90 runs** (~3-4 hours with 10-way parallelism)

**Primary Gate:**
```
T04 cognitive-pinned ≥ 80% (8/10)
OR
T04 cognitive-pinned-recovery ≥ 80% (8/10)
```

**Regression Gates (per-task):**
```
T01 cognitive-pinned ≥ 80% (4/5)    [R-14 baseline: 100%]
T02 cognitive-pinned ≥ 80% (4/5)    [R-14 baseline: 100%]
T05 cognitive-pinned ≥ 80% (4/5)    [R-14 baseline: 100%]
T03: no regression gate (R-14 baseline: 0% — already broken, different root cause)
Overall cognitive-pinned ≥ 55%       [R-14 baseline: 60%]
```

**Diagnostics collected per run (regardless of pass/fail):**
- Success/failure, token count, duration (existing)
- Classifier metrics: entries classified, pinned count, contentType distribution
- Pinned-entry count at each cycle (false-positive tracking) [Finding F-H-3]
- Predicate extraction: how many constraints → extractable prohibitions (separate from classification recall) [Finding F-I-2]
- Violation detection: violations caught, which constraint, which pattern
- Recovery path: did violation → RESTRICT + REPLAN → successful retry?
- If T04 fails despite pinning: log the exact workspace snapshot at the Reasoner's LLM call — was the constraint present? (Distinguishes "eviction problem" from "LLM compliance problem")

**Interpretive framework:**

| Outcome | pinned | pinned+recovery | Interpretation | Next Step |
|---------|--------|-----------------|----------------|-----------|
| PASS | ≥80% | ≥80% | Pinning alone suffices | RFC 003 Phase 1 validated |
| PARTIAL | <80% | ≥80% | Recovery loop is load-bearing | Partition architecture gains priority |
| FAIL-CONTEXT | <80% (constraint WAS in context) | <80% | Reasoner ignores in-context constraints | Research: prompt engineering, constraint-aware modules |
| FAIL-CLASSIFY | <80% (constraint NOT classified) | <80% | Classifier missed the constraint | Improve classifier patterns, re-run |
| FAIL-EXTRACT | <80% (classified but no predicate) | <80% (no violation caught) | extractProhibitions() too narrow | Broaden patterns, re-run |

**Dependencies:** Phases 1-3 complete. `npm test` passes.

**Checkpoint:** Experiment runs complete. Results logged. AGENDA.md updated.

## Success Criteria

### Functional

| Metric | Target | Measurement | Baseline |
|--------|--------|-------------|----------|
| T04 cognitive success (either condition) | ≥ 80% (8/10) | R-13 experiment | 0% (0/8 across R-14 + R-03) |
| T01 cognitive-pinned | ≥ 80% (4/5) | R-13 experiment | 100% (R-14) |
| T02 cognitive-pinned | ≥ 80% (4/5) | R-13 experiment | 100% (R-14) |
| T05 cognitive-pinned | ≥ 80% (4/5) | R-13 experiment | 100% (R-14) |
| Overall cognitive-pinned | ≥ 55% | R-13 experiment | 60% (R-14) |
| Constraint classifier recall on T04 | ≥ 90% | R-13 diagnostics | N/A (new) |
| Predicate extraction rate on T04 | ≥ 80% | R-13 diagnostics | N/A (new) |

### Non-Functional

| Metric | Target | Measurement | Baseline |
|--------|--------|-------------|----------|
| Token overhead per cycle | ≤ 5% increase | R-13 comparison | R-14 avg 24,977 tokens |
| Pinned entries per run (non-T04 tasks) | ≤ 3 avg | R-13 diagnostics | N/A (new) |
| Existing test suite | 100% pass | `npm test` | Passing |

### Architecture

| Metric | Target | Measurement | Baseline |
|--------|--------|-------------|----------|
| FCA gate violations | 0 | Review | 0 |
| New external dependencies | 0 | Package.json diff | 0 |
| Backward-breaking API changes | 0 | Type check | 0 |

## Acceptance Criteria

### AC-1: Pinned entries survive eviction

**Given** a workspace at capacity with 1 pinned entry and (capacity-1) non-pinned entries
**When** a new entry is written that triggers eviction
**Then** the pinned entry remains in the workspace
**And** a non-pinned entry is evicted instead

**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/workspace.test.ts`
**Automatable:** Yes

### AC-2: maxPinnedEntries cap prevents unbounded growth

**Given** a workspace with maxPinnedEntries=5 and 5 pinned entries already present
**When** a 6th pinned entry is written
**Then** the oldest pinned entry is evicted
**And** the new pinned entry is stored

**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/workspace.test.ts`
**Automatable:** Yes

### AC-3: Observer classifies task input only

**Given** a task input containing "must NOT import notifications"
**When** the Observer processes this input
**Then** the workspace entry has `pinned: true` and `contentType: 'constraint'`
**And** a `CognitiveConstraintPinned` event is emitted

**Given** a tool-result input containing "// must not remove this line"
**When** the Observer processes this input
**Then** the workspace entry has `pinned: undefined` and `contentType: 'operational'`

**Test location:** `packages/pacta/src/cognitive/modules/__tests__/observer.test.ts`
**Automatable:** Yes

### AC-4: Post-ACT violation check catches constraint breach

**Given** pinned constraint entries containing "must NOT import notifications" in the workspace
**When** the Actor produces output containing `import { sendNotification } from '../services/notifications'`
**Then** `checkConstraintViolations()` returns a violation
**And** a `CognitiveConstraintViolation` event is emitted
**And** recovery directives are set: `restrictedActions: ['Write']`, `forceReplan: true`

**Test location:** `packages/pacta/src/cognitive/modules/__tests__/constraint-classifier.test.ts`
**Automatable:** Yes

### AC-5: cycle.ts wiring fix forwards Monitor output

**Given** the Monitor has produced `restrictedActions: ['Grep']` and `forceReplan: true`
**When** the cycle orchestrator runs Phase 7 (ACT)
**Then** the Actor receives control with `restrictedActions: ['Grep']`

**Test location:** `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts`
**Automatable:** Yes

### AC-6: Full pipeline (R-13) — T04 constraint adherence

**Given** a cognitive agent with constraint pinning (either condition)
**When** running T04 (API versioning with side-effect trap) at N=10
**Then** success rate ≥ 80% (8/10)

**Test location:** R-13 experiment
**Automatable:** Yes

### AC-7: No regression on T01, T02, T05

**Given** a cognitive agent with constraint pinning
**When** running T01, T02, T05 at N=5 each
**Then** T01 ≥ 80%, T02 ≥ 80%, T05 ≥ 80%

**Test location:** R-13 experiment
**Automatable:** Yes

### AC-8: Existing test suite passes

**Given** all implementation phases complete
**When** running `npm test`
**Then** all existing tests pass

**Test location:** Full test suite
**Automatable:** Yes

## Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| R1a: Constraint evicted before Reasoner sees it | High | High (known) | T04 fails | Pin flag directly addresses this. Primary hypothesis under test. |
| R1b: Constraint present but lost in workspace formatting noise | High | Medium | T04 fails despite constraint being in workspace snapshot | R-13 diagnostic: log exact Reasoner prompt, verify constraint appears in semantically salient position. If this fails, investigate context presentation format. |
| R2: Classifier false negatives on T04's specific phrasing | Medium | Low | Constraint not pinned, still evicted | T04 uses "must NOT" which matches CONSTRAINT_PATTERNS[0]. Risk is low for this specific task. Classifier recall is a measured R-13 metric. |
| R3: Classifier false positives pin tool results | Medium | Medium | Effective workspace capacity shrinks (R-07 lesson) | D3 guards against this: classify only task input, not tool results. R-13 tracks pinned-entry count per run on non-constraint tasks. |
| R4: extractProhibitions() too narrow — catches only "must NOT X" | Medium | Medium | Violation check has low recall even when classifier has high recall | R-13 measures predicate extraction rate separately from classification recall. Decomposed conditions (pinning-only vs +recovery) isolate whether this matters. |
| R5: Post-ACT check false positives | Low | Low | Unnecessary RESTRICT/REPLAN on valid writes | extractProhibitions() only activates on explicit "must NOT X" patterns. No predicate = no check. |
| R6: maxPinnedEntries cap too low/high | Low | Low | Too low: constraints evicted. Too high: workspace bloat. | Default 10 is generous (typical task has 1-3 constraints). Cap is configurable. |

## Dependencies & Cross-Domain Impact

### Depends On
- PRD 030 (Cognitive Composition) — module algebra, workspace types, cycle engine
- PRD 035 (Cognitive Monitoring & Control V2) — PriorityAttend, Monitor, enriched signals

### Enables
- RFC 003 Phase 1 (Typed Context Selection) — if R-13 passes, hypothesis validated
- RFC 003 Phase 2 (Full Partition Architecture) — pin flag generalizes to NoEviction policy

### Cross-Domain Impact

| Sub-Area | Change Type | Files Affected | Port Changes | Test Impact |
|----------|------------|----------------|--------------|-------------|
| algebra | Modified | workspace-types.ts, workspace.ts, events.ts, index.ts | None | 6 new scenarios |
| modules | Modified + New | observer.ts, constraint-classifier.ts (new) | None | 19 new scenarios |
| engine | Modified | cycle.ts | None | 4 new scenarios |
| experiments | Modified | run.ts, new log entry | None | R-13 (90 runs) |

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `experiments/AGENDA.md` | Update | R-13 status: designed → in-progress → completed |
| `docs/rfcs/003-cortical-workspace-composition.md` | Update | Add R-13 results in Part 0 |
| `docs/arch/cognitive-composition.md` | Update | Add constraint pinning + post-ACT verification |

## Open Questions

| # | Question | Owner | Resolution |
|---|----------|-------|------------|
| OQ-1 | Should `extractProhibitions()` handle more patterns? | R-13 diagnostics | Measure predicate extraction rate; expand only if < 80% |
| OQ-2 | Should pinned entries have TTL? | Future PRD | Not for Phase 0 — workspace clears on task completion |
| OQ-3 | How should Observer distinguish task input from tool results? | Phase 2 impl | `input.source` field or convention. Simplest: Observer only classifies the first input per task (the task prompt), not subsequent tool results. |
| OQ-4 | Should cycle.ts post-ACT check set recovery for the CURRENT cycle or NEXT? | Phase 3 impl | Next cycle (current cycle's ACT has already run). In run.ts loop, this naturally applies to the next iteration. |

## Review Findings Summary

15 findings from 4 advisors (Skeptic, Architect, Implementor, Historian). Key changes applied:

- **F-S-1 (CRITICAL):** Decomposed R-13 into `pinning-only` vs `pinning+recovery` conditions
- **F-A-1, F-A-2 (CRITICAL):** Moved constraint violation check out of Monitor into always-on pure function
- **F-H-1, F-I-1 (CRITICAL):** Added run.ts to change list; acknowledged it already wires Monitor output
- **F-S-3 (HIGH):** Added per-task regression gates (T01/T02/T05 ≥ 80%)
- **F-H-5 (HIGH):** Classify only task input, not tool results; narrowed GOAL_PATTERNS
- **F-A-3 (MEDIUM):** Made contentType a closed string literal union
- **F-A-4 (MEDIUM):** Added maxPinnedEntries safety cap
- **F-I-2 (HIGH):** Separated classifier recall vs predicate extraction recall in metrics
- **F-H-3 (HIGH):** Added pinned-entry count per run as diagnostic metric

Deferred: F-S-4 (split R1 into R1a/R1b — applied), F-H-2/F-I-4 (time estimates — added to Phase 4).
Acknowledged: F-S-2 (qualified "most real-world tasks" claim in Problem Statement).

## Implementation Status

*(Empty — filled during realization)*
