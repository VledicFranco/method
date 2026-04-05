---
type: prd
title: "PRD 052: Router SLM — Compiled Architecture Selection"
date: "2026-04-05"
status: draft
tier: lightweight
depends_on: [50, 49]
enables: []
blocked_by: []
complexity: low
domains: [experiments/exp-slm-composition, algebra, modules/router]
surfaces: [RouterSLMPort]
rfc: "docs/rfcs/002-small-language-models.md"
---

# PRD 052: Router SLM — Compiled Architecture Selection

## Problem

PRD 050's meta-cognitive router uses rule-based feature extraction that
misclassifies 2/6 tasks (R-30b: 53% composite, 67% if routing were perfect).

The critical misclassification: T04 (api-versioning) looks like a multi-file
task with constraints → routed to unified-memory. But Sonnet 4 handles it
natively at 100% flat. The rule-based features can't distinguish "multi-file
but clear goals" from "multi-file and genuinely structural." This costs 80pp.

Same compilation pattern as PRD 049 (KPI Checker SLM): a recurring cognitive
decision (classify task → select architecture) that should be compiled from
slow frontier deliberation into fast specialized execution.

## Constraints

- **Same pipeline as PRD 049.** Uses experiments/exp-slm-composition infrastructure,
  Qwen2.5-0.5B base, LoRA, chobits GPU.
- **Inference < 100ms.** Router runs once per task — latency is fine.
- **Binary output.** `flat` or `unified-memory` + confidence score.
- **Backward compatible.** `RouterConfig.slmPort` is optional. Falls back to
  rule-based when not provided.

## Success Criteria

1. **Routing accuracy ≥ 5/6** on T01-T06 task suite (currently 4/6).
2. **Composite pass rate ≥ 63%** (N=5, meta-cognitive condition). Currently 53%.
3. **Inference latency < 100ms** on CPU.
4. **DSL parse rate 100%** — output is `flat` or `unified-memory` (trivial grammar).

## Input/Output Format

**Input:**
```
<task>Create v2 API handler. Update router. Do not include notification or audit side effects.</task>
```

**Output:**
```
flat
```

Or:
```
unified-memory
```

The simplest possible output format — a single word. Confidence is derived
from the model's sequence log-probability (same as KPI Checker).

## Training Data Strategy

### Ground Truth (from R-28 + R-29 N=5 experiments)

| Task Pattern | Best Architecture | Evidence |
|-------------|-------------------|----------|
| Structural refactoring (circular dep, module extraction) | unified-memory | T01 +20pp cognitive |
| Single-file bug fix (locate + edit) | flat | T02 +80pp flat |
| Config migration (multi-file + env wiring) | unified-memory | T03 +20pp cognitive |
| Multi-file API extension (clear goals) | flat | T04 +80pp flat |
| Trap detection (don't delete dynamic refs) | flat | T05 tied, flat cheaper |
| Complex extraction (8+ files) | unified-memory | T06 tied, but cognitive needed |

### Corpus Construction

1. **Seed pairs (20):** T01-T06 task descriptions × paraphrases → architecture label
2. **Frontier trace collection (200+):** Run frontier LLM classifier on varied task
   descriptions (generated from T01-T06 templates with varied file paths, language,
   constraints). Manually correct.
3. **Synthetic expansion (1K-2K):** Paraphrase tasks, vary file paths/names, augment
   with noise. Each labeled with ground-truth architecture.
4. **Adversarial examples:** Tasks that look structural but aren't (T04 pattern),
   tasks that look simple but are structural (implicit dependency chains).

### Grammar

```
output := 'flat' | 'unified-memory'
```

No parsing complexity. Validation is string equality.

## Integration

### Port Interface (algebra/router-slm-port.ts)

```typescript
interface RouterSLMPort {
  classify(taskDescription: string, objective: string): Promise<{
    architecture: 'flat' | 'unified-memory';
    confidence: number;
  }>;
  readonly model: string;
}
```

### Router Module Update (modules/router.ts)

```typescript
interface RouterConfig {
  // ... existing fields ...
  slmPort?: RouterSLMPort;  // NEW: when provided, replaces rule-based classification
}
```

In `step()`:
```
if (slmPort) {
  const result = await slmPort.classify(input.taskDescription, input.goal.objective);
  return { architecture: result.architecture, confidence: result.confidence, ... };
}
// else: fall through to existing rule-based extractFeatures + decide
```

### HTTP Adapter

Same pattern as `createHttpKPIChecker` — calls Python server on chobits.
The server wraps the task in `<task>...</task>` and returns a single word.

## Phase Plan

### Phase 1: Corpus Construction (chobits, GPU agent)

- Collect frontier traces from T01-T06 variations
- Manual labeling + synthetic expansion
- Target: 1K-2K pairs, validated

### Phase 2: Training (chobits, GPU agent)

- Fine-tune Qwen2.5-0.5B with LoRA r=16
- Evaluate: accuracy ≥ 5/6 on holdout
- ONNX export

### Phase 3: Integration (this codebase)

- Add `RouterSLMPort` to algebra
- Update `modules/router.ts` to consume it
- HTTP adapter for chobits server
- Wire into experiment runner

### Phase 4: R-31 Validation

- Run `--condition=meta-cognitive` N=5 with SLM router
- Target: composite ≥ 63%, routing accuracy ≥ 5/6

## Risks

- **Corpus size for binary classification may be overkill.** Qwen2.5-0.5B may
  learn this distinction with just 200 examples. Start small, expand if needed.
- **Task suite is only 6 tasks.** SLM must generalize beyond T01-T06. Include
  diverse task templates in training data.
- **Flat vs cognitive is model-dependent.** If we switch to Opus, the routing
  truth table changes. The SLM would need retraining. Mitigation: include model
  tier as a training feature.

## Relationship to Existing Work

- **PRD 049 (KPI Checker SLM):** Same pipeline, same infrastructure, same base model.
  Could share the training harness.
- **PRD 050 (Meta-Cognitive Router):** This replaces the rule-based classification
  in the existing Router module. All other Router logic (caching, monitoring, fallback)
  stays unchanged.
- **RFC 002 (SLM Compilation):** Fifth compilation target after Monitor, Observer,
  Evaluator, KPI Checker. The simplest SLM in the family (binary classification).
