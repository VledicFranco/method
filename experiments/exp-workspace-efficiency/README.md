# exp-workspace-efficiency: Token Savings from Salience-Based Eviction

**Hypothesis:** Salience-based workspace eviction reduces total token consumption by
30%+ compared to unlimited context, without degrading task success rate below 90% of
the unlimited-context baseline.
**Status:** designed
**PRD:** docs/prds/035-cognitive-monitoring-control-v2.md (PriorityAttend mechanism)
**RFC:** docs/rfcs/001-cognitive-composition.md (Part III: The Workspace, Validation Criterion 3)
**ov-research:** EXP-025 (workspace-efficiency) — not yet distilled
**Started:** 2026-03-29

## Motivation

RFC 001 Validation Criterion 3 states: "The workspace capacity mechanism reduces token
waste vs. unlimited context (measured: tokens consumed per successful task completion)."

The current workspace engine (`packages/pacta/src/cognitive/algebra/workspace.ts`) implements
salience-based eviction with configurable capacity, but no experiment has measured whether
the mechanism actually saves tokens without hurting task performance. PRD 035 extends the
workspace with PriorityAttend (three-factor biased competition: stimulus salience + goal
relevance + selection history) and adaptive thresholds, but neither the v1 nor the proposed
v2 salience system has empirical validation.

This experiment measures the token-efficiency frontier: how aggressively can workspace
capacity be constrained before task success degrades?

## Methodology

### Independent Variable

**Workspace capacity strategy** — how many entries the workspace retains and what happens
to evicted entries. Five conditions:

| Condition | Label | Capacity | Eviction | Salience Function |
|-----------|-------|----------|----------|-------------------|
| A | unlimited | 100 | None (effectively unbounded) | Default (0.4r + 0.3s + 0.3g) |
| B | standard-8 | 8 | Lowest-salience, silent discard | Default (0.4r + 0.3s + 0.3g) |
| C | evict-summary-8 | 8 | Lowest-salience, 1-line summary re-injected | Default |
| D | tight-4 | 4 | Lowest-salience, summary re-injected | Default |
| E | priority-attend-8 | 8 | Lowest-salience, silent discard | PriorityAttend (3-factor: recency + goal + selection history) |

**Condition A** is the control: workspace capacity set high enough that no eviction occurs
during any task. This simulates "unlimited context" — every workspace entry persists for
the entire task.

**Conditions B-D** test capacity thresholds with the v1 default salience function.
**Condition E** tests the PriorityAttend salience function from PRD 035 at standard capacity.

### Dependent Variables

| Metric | Unit | How Measured |
|--------|------|--------------|
| Total tokens | integer | Sum of `usage.totalTokens` from all provider calls per run |
| Task success | boolean | `task.validate(vfs.files).success` — same validator as exp-cognitive-baseline |
| Quality score | 0.0-1.0 | Weighted composite: success (0.6) + structural correctness (0.2) + no regressions (0.2) |
| Provider calls | integer | Count of LLM invocations per run |
| Wall-clock duration | ms | `Date.now()` delta start-to-finish |
| Eviction count | integer | `workspace.getEvictions().length` at task end |
| Eviction salience mean | float | Mean salience of evicted entries (measures information loss quality) |
| Monitor interventions | integer | Count of anomaly-triggered meta-level interventions |

### Tasks

Reuse the 5 strategy-shift tasks from exp-cognitive-baseline:

1. **Circular dependency refactor** (task-01) — extract shared interface
2. **Test-first bug fixing** (task-02) — write test before fixing
3. **Config migration** (task-03) — schema migration with validation
4. **API versioning** (task-04) — backward-compatible version bump
5. **Dead code removal** (task-05) — safe identification and removal

These are imported directly from `../exp-cognitive-baseline/task-*.ts`. Same validators,
same initial files.

### Agent Configuration

All conditions use the same agent architecture:
- **Condition:** Cognitive (8-module cycle from PRD 030)
- **Provider:** `anthropicProvider` with `claude-sonnet-4-20250514`
- **Max output tokens:** 2048 per LLM call
- **Max cycles:** 15 per task
- **Monitor:** `constrain-force` strategy (from exp-cognitive-baseline baseline config)
- **Prompt:** `baseline` strategy

The ONLY variable is the workspace configuration (capacity, eviction handler, salience function).

### Statistical Design

- **N = 10 runs** per condition per task
- 5 conditions x 5 tasks x 10 runs = **250 total runs**
- **Primary analysis:** Paired comparison of token usage (condition vs A) with
  Wilcoxon signed-rank test (non-parametric — token distributions are typically skewed)
- **Secondary analysis:** Task success rate comparison with Fisher's exact test
- **Effect size:** Cohen's d for token savings, relative risk for success degradation
- **Significance threshold:** p < 0.05 with Bonferroni correction for 4 pairwise comparisons
  (adjusted alpha = 0.0125)

### Budget Estimate

Based on exp-cognitive-baseline pilot data (Task 01, Condition C):
- ~3,000-8,000 tokens per run (cognitive condition)
- Estimated: ~5,000 tokens/run average x 250 runs = ~1.25M tokens
- At Sonnet pricing (~$3/MTok input + $15/MTok output, ~60/40 split):
  ~750K input tokens @ $3/MTok = $2.25
  ~500K output tokens @ $15/MTok = $7.50
  **Total estimate: ~$10** (well within $17 budget)
- Safety margin: 70% of budget — abort if cumulative spend exceeds $12

### Phased Execution

**Phase 1: Pilot (N=2, Tasks 1-2 only, Conditions A+B+D)**
- 3 conditions x 2 tasks x 2 runs = 12 runs
- Purpose: validate instrumentation, confirm token tracking works, check for bugs
- Budget: ~$0.50

**Phase 2: Core comparison (N=10, All tasks, Conditions A+B+D)**
- 3 conditions x 5 tasks x 10 runs = 150 runs
- Purpose: primary result — does eviction save tokens without hurting success?
- Budget: ~$6

**Phase 3: Extended conditions (N=10, All tasks, Conditions C+E)**
- 2 conditions x 5 tasks x 10 runs = 100 runs
- Purpose: test summary re-injection and PriorityAttend salience
- Budget: ~$4

## Runs

| Run | Date | Phase | Conditions | Key Result | Verdict |
|-----|------|-------|------------|------------|---------|

## Findings

*No runs completed yet.*

## Gate Status

| Gate | Criterion | Status |
|------|-----------|--------|
| G0: Pilot | Instrumentation works, token counts recorded, validators pass | pending |
| G1: Core | Conditions B/D save 20%+ tokens vs A with success rate >= 90% of A | pending |
| G2: Extended | Condition E (PriorityAttend) saves >= 10% more than B at same success | pending |

## Analysis Plan

After runs complete, produce:

1. **Token efficiency table** — mean and median tokens per successful completion, per condition per task
2. **Success rate table** — success count / total, per condition per task, with 95% CI
3. **Token-success frontier plot** — X: token savings (% vs A), Y: success rate — each condition is a point
4. **Eviction analysis** — mean eviction count, mean evicted salience, correlation with success
5. **Per-task breakdown** — which tasks are most sensitive to workspace capacity?

## Cross-References

- RFC 001 Part III (The Workspace) — theoretical grounding for salience-based eviction
- RFC 001 Validation Criterion 3 — "workspace capacity mechanism reduces token waste"
- PRD 035 (PriorityAttend) — three-factor salience function tested in Condition E
- PRD 030 Phase 1-7 — cognitive cycle implementation used by all conditions
- exp-cognitive-baseline — task definitions, baseline comparison data
- `packages/pacta/src/cognitive/algebra/workspace.ts` — workspace engine under test
- `packages/pacta/src/cognitive/algebra/workspace-types.ts` — SalienceContext with PRD 035 extensions
