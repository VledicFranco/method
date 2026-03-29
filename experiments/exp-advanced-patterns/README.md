# exp-advanced-patterns: Advanced Cognitive Patterns Impact on Task Success

**Hypothesis:** Adding PRD 032 advanced cognitive patterns (reflector-v2, affect module,
conflict-resolver, meta-composer, thought patterns, dynamic personas) to the base 8-module
cognitive cycle measurably improves task success rate, reasoning quality, and stagnation
recovery on complex multi-step tasks compared to the base cycle alone.

**Status:** designed
**PRD:** docs/prds/032-advanced-cognitive-patterns.md
**RFC:** docs/rfcs/001-cognitive-composition.md
**ov-research:** EXP-027 (advanced-cognitive-patterns)
**Started:** 2026-03-29
**Budget:** $17 API credits (Anthropic)

## Background

PRD 030 implemented the Calculus of Cognitive Composition with 8 base modules:
Observer, Memory, Reasoner, Actor, Monitor, Evaluator, Planner, Reflector.
EXP-023 (exp-cognitive-baseline) validated this base architecture on 5 strategy-shift
tasks. PRD 032 defines 8 advanced patterns (P1-P8) that compose within the existing
algebra. This experiment tests whether those patterns produce measurable improvement.

The base cycle achieves 4/5 tasks with the best config, but Task 04 (API versioning)
consistently fails, and stagnation loops remain a problem. PRD 032 patterns address
specific failure modes: conflict-resolver for contradictory signals, affect for
stagnation detection, reflector-v2 for cross-task learning, and meta-composer for
adaptive cognitive load.

## Research Questions

1. **RQ-1:** Do individual advanced patterns improve task success on pattern-appropriate tasks?
2. **RQ-2:** Does the combined pattern set achieve higher overall pass rate than the base cycle?
3. **RQ-3:** Do advanced patterns reduce stagnation loops (measured by cycles-to-completion)?
4. **RQ-4:** What is the token cost overhead of each pattern relative to the base cycle?
5. **RQ-5:** Do cross-task patterns (reflector-v2, thought patterns) transfer learning across tasks?

## Independent Variables

**Pattern composition** -- which advanced modules are active during execution.

### Conditions

| Condition | Description | Active Patterns | Config Base |
|-----------|-------------|-----------------|-------------|
| A (control) | Base 8-module cycle only | None | `baseline` |
| B (reflector) | Base + reflector-v2 + thought patterns | P5, P6 | `baseline` + reflect + patterns |
| C (affect) | Base + affect module | P3 | `baseline` + affect |
| D (conflict) | Base + conflict-resolver (via meta-composer) | P1, P2 | `v2-full` + adaptive |
| E (combined) | All Tier 1-2 patterns | P1-P6 | `v2-full` + all patterns |

**Rationale for conditions:**
- **A** is the control. Matches exp-cognitive-baseline Condition C with `baseline` config.
- **B** tests cross-task learning (P5+P6). These are the highest-impact, lowest-cost
  patterns per PRD 032 Phase 1. Reflector-v2 uses a cheap Haiku call ($0.001/reflection).
  Thought patterns are zero-cost (memory retrieval).
- **C** tests affect signals in isolation. Affect is rule-based (zero LLM cost). Tests
  whether behavioral-pattern-derived emotional signals improve stagnation recovery.
- **D** tests adversarial reasoning. Conflict-resolver requires parallel LLM calls
  (~2x cost per conflicted cycle). Meta-composer classifies tasks to gate when parallel
  reasoning fires. Tests whether the dual-process gating keeps cost reasonable.
- **E** tests the full combined system. All Tier 1-2 patterns active. Tests whether
  composition produces synergy or interference.

**Why Tier 3 patterns (P7: mind wandering, P8: multi-sense attention) are excluded:**
P7 requires background scheduling infrastructure. P8 requires EventBus port integration.
Both are infrastructure-dependent (PRD 032 Phases 7-8), not yet implemented, and would
confound the pattern-level measurement. They can be added in a follow-up experiment.

## Dependent Variables

| Variable | Measurement | Source |
|----------|-------------|--------|
| Task success rate | Binary pass/fail per validation function | `task.validate(vfs.files)` |
| Cycles to completion | Number of cognitive cycles before `done` or max | Cycle counter |
| Token usage | Total tokens consumed across all modules | Provider adapter usage tracking |
| Provider calls | Number of LLM invocations per task | Provider call counter |
| Monitor interventions | Number of stagnation detections | Monitor monitoring signal count |
| Affect signals | Distribution of affect labels across cycles | Affect module output |
| Conflict resolutions | Count and type (accept-a/accept-b/synthesize) | Conflict resolver monitoring |
| Reflection quality | Number of lessons produced, retrieval in subsequent tasks | Reflector-v2 output + memory retrieval count |
| Reasoning quality score | Manual 1-5 Likert rating of reasoning traces (subset) | Human evaluation on 20% sample |

## Task Battery

### Existing tasks (from exp-cognitive-baseline)

These 5 tasks are reused to enable direct comparison with EXP-023 results.

| ID | Name | Strategy Shift Required | Pattern Exercise |
|----|------|------------------------|------------------|
| T01 | Circular dependency refactor | Extract shared interface before refactoring | Conflict (contradictory approaches), Persona (architect) |
| T02 | Test-first bug fixing | Trace backward from test failure | Persona (debugger), Affect (confidence tracking) |
| T03 | Config migration | Preserve runtime interpolation | Persona (migrator), Thought pattern (refactoring) |
| T04 | API versioning | Coexist v1+v2 without side effects | Conflict (copy vs extract), Persona (reviewer) |
| T05 | Dead code removal | Check all reference types before deleting | Thought pattern (safe-deletion), Affect (frustration) |

### New tasks (pattern-specific)

Three additional tasks designed to specifically exercise the advanced patterns.

| ID | Name | Description | Primary Pattern |
|----|------|-------------|-----------------|
| T06 | Contradictory requirements | Two conflicting specs; agent must detect contradiction and propose synthesis | Conflict-resolver (P1) |
| T07 | Escalating urgency | Task starts simple, mid-task event changes priorities; agent must re-prioritize | Affect (P3) |
| T08 | Cross-task transfer | Second attempt at a task type after reflection from a prior failed attempt | Reflector-v2 (P6), Thought patterns (P5) |

## Task Definitions

### T06: Contradictory Requirements

**Setup:** A module must satisfy two specs: Spec A says "return values should be sorted
ascending" while Spec B says "return values should be in insertion order." Both specs
reference the same function. The agent must detect the contradiction, propose a resolution
(e.g., configurable sort option), and implement it.

**Validation:** Output module has a configurable sort parameter. Default behavior matches
one spec. Optional parameter enables the other. Both specs pass when their mode is active.

**Why this exercises P1:** The contradictory specs should trigger the meta-composer's
`conflicted` classification, activating parallel adversarial reasoning. Reasoner A proposes
"sort ascending" (Spec A), Reasoner B proposes "insertion order" (Spec B), and the
conflict-resolver synthesizes "configurable."

### T07: Escalating Urgency

**Setup:** Agent is refactoring a module. After 3 cycles, a simulated "test failure" event
is injected into the workspace (high-priority). The test failure is in an unrelated file
but blocks the build. Agent must interrupt current work, fix the test, then resume.

**Validation:** Both the original refactoring is complete AND the injected test failure is
fixed. Neither alone is sufficient.

**Why this exercises P3:** The affect module should detect the urgency shift (arousal spike
from the injected event). The `anxious` or `frustrated` signal should guide the agent to
address the high-priority interruption before continuing with lower-priority refactoring.

### T08: Cross-Task Transfer

**Setup:** This task runs in TWO phases:
1. Phase 1: Agent attempts a novel task (variant of T01) and fails (budget limited to 5 cycles).
   Reflector-v2 fires and stores HEURISTIC lessons.
2. Phase 2: Agent attempts the SAME task type with fresh files but the SAME memory.
   Thought patterns and reflection lessons from Phase 1 should be retrieved.

**Validation:** Phase 2 succeeds. The agent uses retrieved lessons (verified by memory
retrieval count > 0 in Phase 2).

**Why this exercises P5+P6:** Phase 1 failure + reflection produces lessons. Phase 2
retrieval of those lessons demonstrates cross-task transfer. Memory retrieval count
in Phase 2 measures whether the system actually uses prior learning.

## Statistical Design

### Sample Size

**N = 10 per condition per task type.** This gives 80% power to detect a 30 percentage
point difference in success rate (e.g., 40% -> 70%) at alpha = 0.05 using Fisher's exact
test. For continuous measures (tokens, cycles), N=10 provides reasonable estimates of
effect size for planning a larger follow-up.

### Total Runs

| | T01 | T02 | T03 | T04 | T05 | T06 | T07 | T08 | Total |
|---|---|---|---|---|---|---|---|---|---|
| A (control) | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 80 |
| B (reflector) | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 80 |
| C (affect) | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 80 |
| D (conflict) | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 80 |
| E (combined) | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 80 |
| **Total** | | | | | | | | | **400** |

### Budget Estimation

- **Condition A (control):** ~5K tokens/run, 80 runs = 400K tokens
- **Condition B (reflector):** ~6K tokens/run (+1K for reflection), 80 runs = 480K tokens
- **Condition C (affect):** ~5K tokens/run (+0 for rule-based affect), 80 runs = 400K tokens
- **Condition D (conflict):** ~8K tokens/run (+3K for parallel reasoning on ~20% of cycles), 80 runs = 640K tokens
- **Condition E (combined):** ~9K tokens/run (all overheads), 80 runs = 720K tokens
- **Total estimate:** ~2.64M tokens input + ~660K tokens output

Using Claude Sonnet pricing ($3/1M input, $15/1M output):
- Input cost: 2.64M * $3/1M = $7.92
- Output cost: 0.66M * $15/1M = $9.90
- **Total estimated cost: $17.82**

**Budget management strategy:**
- Run a pilot batch (N=2 per condition, T01 only) to calibrate actual token usage.
  Estimated pilot cost: $0.89.
- If pilot exceeds estimates by >50%, reduce N to 8 or drop one condition.
- Use Haiku for reflector-v2 and conflict-resolver where possible to reduce output cost.
- Kill runs that exceed 15 cycles (max budget per run: ~$0.15).

### Analysis Plan

1. **Primary:** Fisher's exact test comparing task success rates between each pattern
   condition (B-E) and control (A), per task. Bonferroni correction for 4 comparisons
   per task (adjusted alpha = 0.0125).

2. **Secondary:** Mann-Whitney U test for continuous measures (tokens, cycles, duration)
   between each condition and control. Effect sizes reported as rank-biserial correlation.

3. **Exploratory:** Within-condition analysis of affect signal distributions, conflict
   resolution types, and reflection lesson quality. No correction for multiple comparisons
   (clearly labeled as exploratory).

4. **Cross-task transfer (T08 only):** Paired comparison of Phase 1 vs Phase 2 success
   within condition B. McNemar's test for paired binary outcomes.

## Procedure

### Pre-Experiment

1. Verify all module imports compile: `npx tsc --noEmit` on experiment scripts.
2. Run one instance of each task under condition A to confirm task infrastructure works.
3. Seed thought patterns into a fresh InMemoryMemory and verify retrieval.
4. Calibrate pilot batch (N=2, condition A+E, T01 only) to validate budget estimates.

### Execution Order

Runs are **randomized within task** to prevent order effects. Between-task order is
sequential (T01 through T08) to enable cross-task memory accumulation for conditions
B and E.

For each task T in [T01..T08]:
  1. Randomize the order of conditions [A, B, C, D, E] x N runs
  2. Execute each run, recording all dependent variables
  3. Save results to `results/{task}/{condition}-run{N}.json`
  4. Save cross-task memory state for conditions B and E

### Post-Experiment

1. Aggregate results per condition per task.
2. Run statistical tests per the analysis plan.
3. Generate summary report with tables and comparisons.
4. Log entry to `experiments/log/`.
5. Update this README with findings.

## Assumptions and Limitations

### Assumptions

- **A1:** The existing 5 tasks from exp-cognitive-baseline are representative of
  "complex multi-step tasks requiring strategy shifts." They were designed for this purpose
  but are a small, curated set. External validity is limited.

- **A2:** 15 cycles is sufficient budget for all tasks. EXP-023 showed 4/5 tasks complete
  within 15 cycles. Task T04 may need more, but extending the budget would change the
  comparison with EXP-023 results.

- **A3:** VirtualToolProvider simulates real tool use faithfully enough. The in-memory
  filesystem lacks timing effects, file system events, and OS-level side effects. Results
  may differ on real filesystems (see exp-cognitive-baseline Condition B for real-FS data).

- **A4:** Rule-based affect computation captures the behavioral signals that matter.
  The affect module uses simple heuristics (3+ failures = frustrated, declining confidence =
  anxious). These may not capture all relevant states.

### Limitations

- **L1:** Single model (Claude Sonnet). Results may not generalize to other LLMs.
- **L2:** No Tier 3 patterns (P7 mind wandering, P8 multi-sense). The full PRD 032 vision
  is not tested.
- **L3:** Reasoning quality scoring is subjective. Inter-rater reliability should be
  established but is impractical for a single-researcher setup.
- **L4:** The tasks are synthetic (in-memory filesystem, predefined validation). Real-world
  tasks have more ambiguity, larger codebases, and non-deterministic environments.
- **L5:** Cross-task memory (conditions B, E) introduces order dependence. Results on
  later tasks may be confounded by lessons from earlier tasks. Randomization within-task
  partially mitigates but does not eliminate this.

## Implementation Notes

### Module Wiring per Condition

**Condition A (control):**
```
Observer -> Workspace -> Memory -> ReasonerActor -> Monitor -> [conditional] -> done
Config: baseline (evict + constrain-force + baseline prompt)
Flags: none
```

**Condition B (reflector):**
```
Same as A, plus:
- P5: seedPatterns() before first task; memory module retrieves PROCEDURE cards
- P6: createReflectorV2() fires after task completion (pass or fail)
- Shared memory port across tasks (InMemoryMemory with FactCardStore persistence)
Flags: --reflect --patterns --memory
```

**Condition C (affect):**
```
Same as A, plus:
- P3: computeAffect() runs each cycle; guidance injected into workspace
- Affect signals feed into monitor stagnation detection
Flags: --affect
```

**Condition D (conflict):**
```
Same as A, plus:
- P2: gatherTaskSignals() + classifyTask() before each task selects config
- P1: When classified as 'conflicted', parallel reasoner invocation + conflict-resolver
- Config may shift to v2-full based on meta-composer classification
Flags: --adaptive
```

**Condition E (combined):**
```
All of B + C + D combined:
- P5: Thought patterns seeded
- P6: Post-task reflection
- P3: Per-cycle affect computation
- P2: Adaptive config selection
- P1: Conflict resolution when triggered
- P4: Dynamic persona injection (cycle 0)
- Shared memory across tasks
Flags: --pattern=all --memory
```

### File Layout

```
experiments/exp-advanced-patterns/
  README.md                          <- This file
  configs/
    condition-a.yaml                 <- Control condition config
    condition-b.yaml                 <- Reflector condition config
    condition-c.yaml                 <- Affect condition config
    condition-d.yaml                 <- Conflict condition config
    condition-e.yaml                 <- Combined condition config
  scripts/
    run.ts                           <- Main experiment runner
    task-suite.ts                    <- Task definitions (T06, T07, T08)
    analyze.ts                       <- Post-experiment statistical analysis
  results/                           <- Empty, populated by runs
```

## Gate Status

No hard gates. Success is measured by statistical tests on the full dataset. However,
the pilot batch serves as a soft gate: if condition A achieves <2/8 tasks at N=2,
the task infrastructure needs debugging before the full experiment.

## Runs

| Run | Date | Config | Key Result | Verdict |
|-----|------|--------|------------|---------|

## Findings

Awaiting experiment execution.
