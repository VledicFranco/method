# exp-interventionist-cost: Cost Overhead of Default-Interventionist vs Always-On Meta-Level Monitoring

**Hypothesis:** The default-interventionist monitoring pattern (Monitor fires only when
salience signals cross thresholds) maintains equivalent error detection rates to always-on
monitoring while consuming significantly fewer tokens (target: <1.5x base cost vs >2x for
always-on), validating RFC 001's cost model prediction.

**Status:** designed
**PRD:** docs/prds/030-pacta-cognitive-composition.md
**RFC:** docs/rfcs/001-cognitive-composition.md
**ov-research:** EXP-026 (interventionist-cost)
**Started:** 2026-03-29
**Budget:** $17 API credits

## Research Question

RFC 001 Section IV specifies a default-interventionist cost model: "most cycles should skip
MONITOR/CONTROL/LEARN, amortizing to a target of <1.5x ReAct cost for routine turns. The
meta-level engages only when monitoring signals cross thresholds -- not every turn."

This experiment measures the actual cost overhead across three monitoring strategies and
determines whether selective monitoring preserves error detection quality.

## Independent Variable

**Monitoring strategy** (3 conditions):

| Condition | Label | Description |
|-----------|-------|-------------|
| A | `no-monitor` | Object-level only. MONITOR/CONTROL phases never fire. Baseline cost reference. |
| B | `always-on` | MONITOR/CONTROL fire every cycle unconditionally. Maximum error detection, maximum cost. |
| C | `interventionist` | MONITOR/CONTROL fire only when `shouldIntervene()` returns true (confidence < 0.3, conflict detected, or unexpected result). The architecture's designed operating mode. |

## Dependent Variables

| Metric | Unit | Source |
|--------|------|--------|
| Total tokens consumed | tokens | Sum of `TraceRecord.tokenUsage.totalTokens` across all phases per task |
| Monitor tokens | tokens | Sum of tokens from MONITOR + CONTROL phases only |
| Token overhead factor | ratio | `totalTokens(condition) / totalTokens(no-monitor)` |
| Latency per cycle | ms | `TraceRecord.durationMs` summed per cycle |
| Task success rate | boolean | Task validation function pass/fail |
| Monitor invocation count | count | Number of cycles where MONITOR phase executed |
| Error detection rate | ratio | (errors caught by monitor) / (total injected errors) |
| Intervention precision | ratio | (useful interventions) / (total interventions) |
| Cost-effectiveness ratio | ratio | `errorDetectionRate / tokenOverheadFactor` |

## Task Suite

Tasks are stratified by difficulty. Easy tasks should not need monitoring; hard tasks have
injected errors or traps that monitoring should catch. This stratification is critical:
the interventionist pattern's value is that it pays monitoring costs only when needed.

### Task Difficulty Tiers

**Tier 1 -- Easy (monitoring unnecessary):**
Tasks solvable in a straight line. No traps, no strategy shifts needed. The interventionist
condition should skip monitoring entirely on these, saving tokens.

1. **simple-rename** -- Rename a function across 3 files. No ambiguity, no traps.
2. **add-field** -- Add a field to a TypeScript interface and update 2 consumers.

**Tier 2 -- Medium (monitoring occasionally helpful):**
Tasks with a non-obvious step that may trigger low confidence or unexpected results.

3. **config-migration** -- Migrate a config format. One field has a non-obvious mapping.
   (Reuses exp-cognitive-baseline task-03 structure.)
4. **type-narrowing** -- Fix a type narrowing bug. The obvious fix (type assertion) passes
   but is wrong; the correct fix requires a type guard.

**Tier 3 -- Hard (monitoring catches errors):**
Tasks with deliberate traps. The agent's first approach will likely fail. Monitor should
detect low confidence or unexpected results and trigger re-planning.

5. **circular-dep** -- Break a circular dependency. Naive single-module refactor fails.
   (Reuses exp-cognitive-baseline task-01 structure.)
6. **dead-code-trap** -- Remove dead code, but one "dead" function is actually called via
   dynamic dispatch (`obj[methodName]()`). Removing it breaks the system.

### Error Injection Protocol

For Tier 3 tasks, we also run variants with **injected errors**: the initial files contain
a subtle bug that the agent may or may not notice. This provides ground truth for error
detection rate measurement.

- **circular-dep-injected**: One module has a silent type coercion bug (returns `string`
  where `number` is expected). Monitor should flag the unexpected result type.
- **dead-code-trap-injected**: One of the "safe to remove" functions has a side effect
  (writes to a shared state). Monitor should flag when removal causes test failure signals.

## Experimental Design

### Per-Condition Wiring

All three conditions use the same 5-module cognitive architecture from
exp-cognitive-baseline (Observer, Monitor, ReasonerActor, Workspace, Memory), same
model (claude-sonnet-4-20250514), same workspace config (capacity=8, evict strategy),
same max cycles (15). The only difference is the monitoring policy:

**Condition A (no-monitor):**
- ThresholdPolicy: `{ type: 'predicate', shouldIntervene: () => false }`
- MONITOR/CONTROL phases never execute
- Establishes baseline token cost and task success rate

**Condition B (always-on):**
- ThresholdPolicy: `{ type: 'predicate', shouldIntervene: () => true }`
- MONITOR/CONTROL phases execute every cycle
- Establishes maximum monitoring cost and detection ceiling

**Condition C (interventionist):**
- ThresholdPolicy uses the production default: confidence < 0.3 OR conflict detected
  OR unexpected result (matches cycle.ts `shouldIntervene` logic)
- MONITOR/CONTROL phases execute only when thresholds are crossed
- The designed operating mode

### Sample Size

N >= 10 per condition per task tier, stratified:
- Tier 1 (easy): 2 tasks x 10 runs x 3 conditions = 60 runs
- Tier 2 (medium): 2 tasks x 10 runs x 3 conditions = 60 runs
- Tier 3 (hard): 2 tasks x 10 runs x 3 conditions = 60 runs
- Tier 3 + injected errors: 2 tasks x 10 runs x 3 conditions = 60 runs
- **Total: 240 runs**

### Budget Estimation

Per run (conservative estimate):
- Object-level (OBSERVE + REMEMBER + REASON + ACT): ~2K tokens/cycle x 8 avg cycles = 16K tokens
- Monitor (always-on): ~500 tokens/cycle x 8 cycles = 4K tokens
- Average per run: ~20K tokens (always-on worst case)

240 runs x 20K tokens avg = 4.8M tokens total.
At Sonnet pricing ($3/1M input, $15/1M output, ~3:1 input:output ratio):
- Input: 3.6M x $3/M = $10.80
- Output: 1.2M x $15/M = $18.00
- **Estimated: ~$14.40** (within $17 budget with margin)

Budget controls:
- Hard cap per run: 50K tokens (abort if exceeded)
- Hard cap per condition: $6.00
- Abort experiment if any condition exceeds 70% of total budget

### Measurement Instrumentation

Token tracking uses the existing `TraceRecord.tokenUsage` field populated by the
ProviderAdapter. The cost-tracker (scripts/cost-tracker.ts) wraps each run to:

1. Accumulate per-phase token counts from trace records
2. Record wall-clock latency per cycle
3. Count monitor invocations (cycles where MONITOR phase appears in `phasesExecuted`)
4. Flag error detections (cycles where monitor output contains anomalies)
5. Write per-run metrics to `results/run-{id}.json`

### Statistical Analysis

Primary analyses:
1. **Token overhead factor** by condition: one-way ANOVA across A/B/C, with pairwise
   Tukey HSD post-hoc tests. Effect size: Cohen's d.
2. **Task success rate** by condition x tier: chi-squared test for independence.
   Fisher's exact test if cell counts < 5.
3. **Error detection rate** (B vs C): paired proportions test (McNemar's test) on
   Tier 3 injected-error tasks.
4. **Cost-effectiveness ratio**: bootstrapped 95% CI for each condition.

Decision criteria (RFC 001 validation):
- **PASS** if: Condition C overhead factor < 1.5x AND detection rate >= 0.8 x Condition B
- **PARTIAL** if: overhead < 1.5x but detection rate < 0.8x, OR detection >= 0.8x but overhead >= 1.5x
- **FAIL** if: overhead >= 1.5x AND detection rate < 0.8x Condition B

## Runs

| Run | Date | Config | Key Result | Verdict |
|-----|------|--------|------------|---------|

## Findings

*Pending experiment execution.*

## Gate Status

| Gate | Criteria | Status |
|------|----------|--------|
| G1 -- Pilot | 3 runs per condition on Task 5 (circular-dep). Verify instrumentation works. | pending |
| G2 -- Tier 3 | N=10 on all Tier 3 tasks. Primary error detection analysis. | pending |
| G3 -- Full | All 240 runs complete. Full statistical analysis. | pending |

## Files

- `README.md` -- This file (experiment design)
- `configs/no-monitor.ts` -- Condition A config (monitoring disabled)
- `configs/always-on.ts` -- Condition B config (monitoring every cycle)
- `configs/interventionist.ts` -- Condition C config (threshold-triggered monitoring)
- `scripts/run.ts` -- Main experiment runner
- `scripts/cost-tracker.ts` -- Token/latency/detection measurement instrumentation
- `scripts/analyze.ts` -- Statistical analysis (post-run)
- `scripts/tasks.ts` -- Task definitions (6 tasks across 3 tiers)
- `results/` -- Run output directory (populated during execution)
