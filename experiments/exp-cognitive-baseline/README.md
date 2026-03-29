# exp-cognitive-baseline: Cognitive vs Flat Agent Strategy-Shift Recovery

**Hypothesis:** The 8-module cognitive cycle with default-interventionist monitoring
recovers from failing strategies at higher rates than flat ReAct agents, at equivalent
token budgets.
**Status:** in-progress
**PRD:** docs/prds/030-pacta-cognitive-composition.md
**RFC:** docs/rfcs/001-cognitive-composition.md
**ov-research:** EXP-023 (cognitive-strategy-shift), EXP-024 through EXP-027 (related)
**Started:** 2026-03-27

## Methodology

Three conditions compared on strategy-shift recovery tasks:

| Condition | Agent Type | Provider | Environment |
|-----------|-----------|----------|-------------|
| A | Flat agent | AnthropicProvider + VirtualToolProvider | In-memory filesystem |
| B | CLI agent | Real Claude Code sub-agent | Temp directory |
| C | Cognitive agent | 8-module cognitive cycle + VirtualToolProvider | In-memory filesystem |

5 tasks designed to require strategy shifts:
1. Circular dependency detection
2. Test-first bug fixing
3. Config migration
4. API versioning
5. Dead code removal

Measured: task success rate, token usage, strategy shifts detected, error recovery count.

## Runs

| Run | Date | Condition | Task | N | Key Result | Verdict |
|-----|------|-----------|------|---|------------|---------|
| pilot | 2026-03-27 | C | Task 01 | 3 | Cognitive agent recovers from circular dep | preliminary |

## Findings

Preliminary (N=3, Task 01 only):
- Cognitive condition shows strategy-shift recovery via Monitor escalation
- Insufficient N for statistical significance
- Tasks 02-05 not yet run

## Gate Status

No hard gates — this is an ongoing comparison. Statistical significance requires N≥10
per condition per task.

## Open Research Items

See `AGENDA.md`:
- R-02: Increase N from 3 to 10 on Task 01
- R-03: Run Tasks 02-05 under all 3 conditions

## Files

- `run.ts` — Main experiment runner (38KB, all 3 conditions + 5 tasks)
- `strategies.ts` — Strategy configurations for cognitive condition
- `task-01-circular-dep.ts` through `task-05-dead-code-removal.ts` — Task definitions
