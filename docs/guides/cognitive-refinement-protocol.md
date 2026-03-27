# Cognitive Agent Refinement Protocol

> Self-improving loop: diagnose → analyze → debate → implement → validate → repeat

## Overview

Each iteration runs one or more diagnostic traces against known tasks, analyzes the
reasoning process against expectations, identifies the highest-impact failure mode,
debates the fix (isolated council or focused analysis), implements the change, and
validates with N=3. The loop converges when the agent achieves the convergence criteria
below.

## Convergence Criteria

- **Pass rate:** ≥ 2/3 on each task in the battery
- **Token ceiling:** ≤ 1.3x flat average per task
- **No regression:** changes must not degrade pass rate or token efficiency on previously-passing tasks
- **Stability:** 2 consecutive iterations with no regressions = converged

## Architecture Context

The cognitive agent under refinement uses the 5-module merged architecture from the
council debate (2026-03-27):

```
Observer (rule-based) → Monitor (rule-based, hard enforcement) → Reasoner-Actor (single LLM call) → Workspace (salience eviction)
                                                                  ↑ Reflector (conditional, on forceReplan)
```

Key files:
- `packages/pacta/src/cognitive/modules/reasoner-actor.ts` — merged reasoning + action
- `packages/pacta/src/cognitive/modules/monitor.ts` — behavioral observables + enforcement
- `packages/pacta/src/cognitive/algebra/module.ts` — type definitions
- `experiments/exp-023/run.ts` — experiment harness
- `experiments/exp-023/task-{01..05}-*.ts` — task definitions

## Iteration Structure

### Phase 1 — Diagnose

Run the diagnostic runner to capture full reasoning traces per cycle.

**Single task diagnosis:**
```bash
npx tsx experiments/exp-023/diagnose.ts --task=N 2>&1 | tee experiments/exp-023/traces/iter-{I}-task-{N}.txt
```

**Parallel diagnosis (range testing):**
Run 3-5 traces simultaneously to see variance. Tag each output.

**What to capture per cycle:**
- `<plan>` section (strategy declaration)
- `<reasoning>` section (analysis quality)
- `<action>` chosen vs expected
- Monitor enforcement (restrictions, replans)
- Workspace entry count (context pressure)
- Tokens per cycle (cost trajectory)
- Whether agent remembers previous actions (context coherence)

### Phase 2 — Analyze

Compare trace against expectations. Fill in this template per iteration:

```markdown
## Iteration {N} Analysis

**Task:** {name}
**Result:** PASS/FAIL, {tokens}K tokens, {cycles} cycles, {duration}s
**Previous iteration:** {result}, {tokens}K tokens

### Expected vs Actual Behavior

| Phase | Expected | Actual | Gap |
|-------|----------|--------|-----|
| Exploration (c1-4) | Read files, discover structure | ... | ... |
| Strategy (c5) | Formulate plan from full understanding | ... | ... |
| Execution (c6-9) | Write/Edit to implement fix | ... | ... |
| Verification (c10-11) | Read back, check correctness | ... | ... |
| Completion (c12) | Signal done | ... | ... |

### Failure Modes Identified

1. **{mode}** — {description}. Impact: {high/medium/low}. Root cause: {cause}.

### Highest-Impact Fix

{The single change most likely to improve the next iteration.}
```

### Phase 3 — Debate (optional)

If the fix is obvious (threshold tuning, prompt tweak), skip debate and implement.

If the fix requires architectural judgment, run a focused 3-character isolated council
(`/forge-debate --isolated`):
- Engineer (implementation feasibility)
- Scientist (theoretical grounding)
- Optimizer (cost impact)

Keep it to 1 round — opening positions only. The goal is to sanity-check the fix,
not to redesign the architecture.

### Phase 4 — Implement

Make the code change. Must be:
- A single focused change (one failure mode per iteration)
- Backward-compatible (existing modules untouched unless the change targets them)
- Verifiable in isolation

Common change types:
- **Threshold tuning:** stagnation threshold, workspace capacity, salience weights
- **Prompt engineering:** system prompt instructions, format changes, restricted-action guidance
- **Module logic:** monitor enforcement schedule, action filtering, behavioral observables
- **New module:** workspace summarizer, progress tracker, completion detector
- **Token optimization:** context compression, selective workspace rendering

### Phase 5 — Validate

Quick validation (N=1 per task):
```bash
npx tsx experiments/exp-023/run.ts --cognitive --task=N
```

Full validation (N=3):
```bash
npx tsx experiments/exp-023/run.ts --cognitive --task=N --runs=3
```

Check:
- [ ] Pass rate ≥ previous iteration (no regression)
- [ ] Token cost ≤ previous iteration or within ceiling
- [ ] The specific failure mode from Phase 2 is resolved
- [ ] No new failure modes introduced

### Phase 6 — Record

Append iteration summary to `experiments/exp-023/refinement-log.md`:

```markdown
## Iteration {N} — {date}

**Task:** {name}
**Change:** {one-line description}
**Before:** {pass_rate}, {tokens}K, {cycles} cycles
**After:** {pass_rate}, {tokens}K, {cycles} cycles
**Status:** improved / regressed / neutral
**Failure modes resolved:** {list}
**New failure modes:** {list or none}
```

---

## Known Failure Modes

### FM-01: Monitor Over-Eagerness (RESOLVED — iteration 1)
Stagnation threshold fired too early. Fixed by smart exploration-vs-stagnation detection
(tracking unique action inputs in a sliding window).

### FM-02: Workspace Context Loss
After workspace capacity (8) fills, salience eviction drops earlier reasoning traces.
Agent re-reads files it already analyzed and forgets edits it made.
**Fix:** Write compact summary entries at high salience after write/edit actions.

### FM-03: No Completion Signal
Agent never signals "done" — runs until MAX_CYCLES. Likely related to FM-02 (loses
context of what it accomplished).
**Fix:** Monitor detects plan completion and injects "verify and finish" directive.

### FM-04: Plan-Action Mismatch on Restricted Actions
When monitor blocks an action type, the agent's plan still references the blocked action.
**Fix:** Prompt explicitly states available (non-blocked) actions with suggestions.

### FM-05: Exploration vs Stagnation Ambiguity (RESOLVED — iteration 1)
Reading different files = exploration. Reading same file repeatedly = stagnation. The
monitor now tracks unique inputs to distinguish these.

### FM-06: Dynamic Reference Blindness (NEW — Task 05)
Agent removes code that appears unused in static import graph but is loaded dynamically
via string-based `require()`. The agent needs to search for dynamic references before
deleting.
**Fix:** TBD — requires analysis of Task 05 diagnostic trace.

---

## Quick Reference

```bash
# Run single task, cognitive only
npx tsx experiments/exp-023/run.ts --cognitive --task=1

# Run all tasks, cognitive only, N=3
npx tsx experiments/exp-023/run.ts --cognitive --task=all --runs=3

# Run full A/B comparison, all tasks
npx tsx experiments/exp-023/run.ts --task=all --runs=3

# Diagnostic trace (full reasoning dump)
npx tsx experiments/exp-023/diagnose.ts --task=N
```
