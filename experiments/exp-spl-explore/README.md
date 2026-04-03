# EXP-SPL-EXPLORE: Flat vs Recursive Codebase Exploration

## Hypothesis

**H1:** FCA-recursive exploration (SPL `explore` algorithm) achieves ≥20% higher
judge-rated quality than flat single-agent exploration on ≥50% of queries,
at a token cost of ≤5x flat.

**H0:** No meaningful quality difference, or flat is better.

## Conditions

| Condition | Description |
|-----------|-------------|
| `no-context` | Baseline — LLM answers the query with zero codebase context |
| `flat` | Single agent receives root-level README + directory listing |
| `recursive` | SPL explore: root level → LLM selects children → recurse into selected |

## Query Set

8 queries spanning 4 categories:
- **Factual lookup** (2): find specific types/functions
- **Synthesis** (2): combine information from multiple components
- **Negative** (2): ask about things that don't exist
- **Evaluative** (2): judge design decisions

## Metrics

Evaluated by LLM-as-judge (`judge.ts`) on 3 dimensions (0-5 each):
- **Correctness** — factual accuracy vs ground truth (weight: 40%)
- **Completeness** — covers all parts of the question (weight: 30%)
- **Precision** — no hallucinated or irrelevant claims (weight: 30%)

Plus: tokens, cost (USD), latency, number of LLM calls.

## Execution

```bash
cd packages/methodts
npx vitest run src/semantic/__tests__/experiment-v2.test.ts
```

Results persisted to `experiments/exp-spl-explore/results/run-{timestamp}.jsonl`.

## Status

- [ ] Initial run with haiku
- [ ] Variance analysis (5+ runs)
- [ ] Model comparison (haiku vs sonnet)
