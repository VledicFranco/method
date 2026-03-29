# exp-metacognitive-error: Can Monitor Detect Reasoning Errors the Reasoner Misses?

**Hypothesis:** The Monitor module, operating as a meta-level observer over aggregated
monitoring signals, detects reasoning errors that the Reasoner produces but cannot
self-correct — at a detection rate significantly above chance (>50%) with false positive
rate below 20%.

**Status:** designed
**PRD:** docs/prds/030-pacta-cognitive-composition.md
**RFC:** docs/rfcs/001-cognitive-composition.md (Validation Criterion 2)
**ov-research:** EXP-024 (metacognitive-error-detection)
**Started:** 2026-03-29

## Motivation

RFC 001 identifies three validation criteria for the cognitive composition calculus.
Criterion 2 states: "The metacognitive tower catches and corrects errors that flat
agents miss (measured: error recovery rate on adversarial tasks)." This experiment
directly tests that criterion by injecting controlled, deterministic reasoning errors
into the monitoring signal stream and measuring whether the Monitor detects them.

The Monitor module (`packages/pacta/src/cognitive/modules/monitor.ts`) currently
detects three anomaly types: `low-confidence`, `unexpected-result`, and `compound`.
This experiment tests whether these detection capabilities translate into catching
actual reasoning errors — not just signal-level anomalies — when the Reasoner
produces them.

## Independent Variable

Presence/absence of Monitor oversight:

| Condition | Description | Monitor Active |
|-----------|-------------|----------------|
| A | Reasoner only — no monitoring | No |
| B | Reasoner + LLM Monitor (Sonnet) | Yes (LLM) |
| C | Reasoner + SLM Monitor (future) | Yes (SLM) |

Condition C is deferred until Gate 4 (R-01) passes, validating the SLM compilation
pipeline for the Monitor module.

## Dependent Variables

| Metric | Description | How Measured |
|--------|-------------|-------------|
| Error Detection Rate (EDR) | Fraction of injected errors the Monitor flags | `detected_errors / injected_errors` |
| False Positive Rate (FPR) | Fraction of clean signals incorrectly flagged | `false_alarms / clean_signals` |
| Detection Latency | Cycles between error injection and detection | Cycle count delta |
| Task Success Rate | Final task outcome correctness | Validation function |
| Token Cost | Total tokens consumed per condition | Provider usage tracking |

## Error Types

Four error categories, each with deterministic injection:

### E1: Logical Contradiction
The Reasoner's monitoring signal asserts a conclusion that contradicts workspace evidence.
- **Injection:** Reasoner signal reports `confidence: 0.92` and a plan to "add dependency X"
  while workspace contains evidence that "X causes circular dependency."
- **Detection mechanism:** Monitor should flag via workspace-signal mismatch (requires
  Monitor to cross-reference signals with workspace contents).
- **Implementation:** Synthetic `ReasonerActorMonitoring` signal with contradictory
  `declaredPlanAction` relative to workspace entries.

### E2: Action-Outcome Mismatch
The Actor reports success, but the workspace/tool evidence shows failure.
- **Injection:** Actor signal reports `success: true, unexpectedResult: false` for a
  Write action, but the virtual filesystem shows the file was NOT written.
- **Detection mechanism:** Monitor should detect that the actor's self-report doesn't
  match the evidence (observer signal should show no file change).
- **Implementation:** Tampered `ActorMonitoring` where `success` is flipped.

### E3: Confidence Miscalibration
The Reasoner reports high confidence on answers that are demonstrably wrong.
- **Injection:** Reasoner signal reports `confidence: 0.95` but the plan action targets
  a nonexistent file or makes a logically impossible step.
- **Detection mechanism:** Monitor should escalate when high confidence combines with
  signals from other modules indicating the plan is wrong (Observer novelty=0, indicating
  nothing changed despite claimed progress).
- **Implementation:** Synthetic signal with inflated `confidence` + contradictory Observer
  signal.

### E4: Planning Error (Skipped Prerequisites)
The plan proposes an action that requires a prerequisite that hasn't been completed.
- **Injection:** Reasoner declares plan step "deploy" but the workspace shows build has
  not succeeded.
- **Detection mechanism:** Monitor detects the out-of-order execution when the action
  produces an unexpected result.
- **Implementation:** Synthetic `ReasonerActorMonitoring` with `declaredPlanAction` that
  references an incomplete dependency chain.

## Methodology

### Signal Stream Architecture

Rather than running full agent loops (expensive, non-deterministic), this experiment
operates at the signal level: we construct synthetic monitoring signal streams with
known error injections and run them through the Monitor module. This isolates the
Monitor's detection capability from confounding factors like LLM stochasticity.

```
[error-injection.ts] → Synthetic signal streams (with known error positions)
       ↓
[Monitor.step()] → MonitorReport (anomalies, escalation, restrictedActions, forceReplan)
       ↓
[Evaluation] → Compare detected anomalies against ground truth error positions
```

### Run Protocol

For each error type (E1-E4) x each condition (A, B):

1. **Generate signal stream:** `error-injection.ts` produces a sequence of 10-20
   `AggregatedSignals` maps representing a realistic cognitive cycle trace. At
   predetermined positions (controlled by seed), errors are injected.

2. **Run Monitor:** Feed each signal map through `Monitor.step()` sequentially,
   carrying state across steps (as in a real cognitive cycle).

3. **Evaluate:** Compare Monitor output against ground truth:
   - True positive: Monitor flags an anomaly on a cycle where an error was injected
   - False positive: Monitor flags an anomaly on a clean cycle
   - False negative: Monitor does NOT flag an anomaly on an error cycle
   - Detection latency: how many cycles after injection the flag appears

4. **Repeat:** N=10 runs per error type per condition (seed varies per run).

### Condition A (Baseline)

No Monitor — errors pass through undetected. This establishes the base rate: what
fraction of errors would be caught by random chance or by the Reasoner's own
confidence reporting? Measured by checking if the Reasoner's own signals contain
any self-correction indicator (confidence drop, conflict detection).

### Condition B (LLM Monitor)

Full Monitor module active. The LLM Monitor processes `AggregatedSignals` and
produces `MonitorReport`. We measure detection accuracy against ground truth.

For Condition B, we optionally test an enhanced Monitor that receives workspace
snapshots in addition to signals — testing whether access to context evidence
improves detection.

### Condition C (SLM Monitor) — DEFERRED

Uses the SLM-compiled Monitor (phase-2-dsl, Gate 4). This condition runs only
after R-01 completes. The SLM Monitor processes the same signal streams via the
Monitor DSL format (`SIGNALS:` → `ANOMALIES:/ESCALATE:/RESTRICT:/REPLAN:`).

## Budget

Target: $17 total API credits.

| Item | Estimated Cost |
|------|---------------|
| Condition B: 4 error types x 10 runs x ~15 cycles x ~500 tokens | ~$2.40 |
| Signal generation (if LLM-assisted) | ~$1.00 |
| Enhanced Monitor (workspace context) variant | ~$3.00 |
| Margin for reruns and debugging | ~$10.60 |
| **Total** | **$17.00** |

Note: Condition A costs $0 (no LLM calls — pure computation). Condition C is deferred.

## Statistical Plan

- N=10 per error type per condition (4 types x 2 conditions x 10 = 80 runs total)
- Primary comparison: EDR(B) > EDR(A) via one-sided paired proportion test
- Secondary: FPR(B) < 0.20 via one-sided proportion test
- Significance level: alpha = 0.05
- If N=10 is insufficient for significance, extend to N=20 (within budget)

## Runs

| Run | Date | Config | Key Result | Verdict |
|-----|------|--------|------------|---------|

## Findings

*Experiment not yet run.*

## Gate Status

| Gate | Criteria | Status |
|------|----------|--------|
| G1: Signal-level detection | EDR > 50% for at least 2/4 error types | pending |
| G2: Low false positives | FPR < 20% across all error types | pending |
| G3: Latency | Mean detection latency <= 2 cycles | pending |
| G4: SLM parity | SLM Monitor EDR within 10% of LLM Monitor | blocked (R-01) |

## Files

```
exp-metacognitive-error/
  README.md                      ← This file
  scripts/
    error-injection.ts           ← Deterministic error injection into signal streams
    run.ts                       ← Main experiment runner
  configs/
    condition-a.yaml             ← Baseline (no monitor) configuration
    condition-b.yaml             ← LLM Monitor configuration
    condition-c.yaml             ← SLM Monitor configuration (deferred)
  results/                       ← Empty, ready for run output
```

## Cross-References

- **RFC 001 §Validation Criteria #2:** "The metacognitive tower catches and corrects errors
  that flat agents miss"
- **PRD 030 Gate B:** PASS — compound anomaly detection demonstrated (prerequisite for this
  experiment)
- **exp-cognitive-baseline (EXP-023):** Tests Criterion 1 (strategy-shift recovery). This
  experiment tests Criterion 2 (error detection).
- **exp-slm Gate 4 (R-01):** Required for Condition C. SLM Monitor must pass temperature
  calibration before we test its error detection capability.
- **ov-research EXP-024:** Cross-reference for distilled findings.
