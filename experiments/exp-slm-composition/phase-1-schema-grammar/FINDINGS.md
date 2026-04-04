# Phase 1 Findings — Schema→Grammar SLM (B-1)

**Date:** 2026-04-03
**Status:** Gates A-G1 and A-G2 PASS
**Model:** Qwen2.5-0.5B-Instruct, LoRA r=16
**Hardware:** RTX 4090 (chobits, Tailscale)

---

## Thesis

RFC 005 proposes that SLMs can bootstrap the creation of new SLMs by automating
the grammar design step — the manual bottleneck in the SLM compilation pipeline.
The B-1 SLM translates TypeScript interfaces into PEG grammars that can be used
to train downstream SLMs.

## Training

### Seed Data

12 TypeScript interface → PEG grammar pairs, hand-crafted from workspace repos:

| Pattern | Examples |
|---------|----------|
| Simple primitives | TokenBucket (4 floats) |
| Required + optional | RunMetrics, EvictionInfo, WorkspaceEntry |
| Union/enum types | EvaluatorReport, ObserverReport |
| Nested objects | ReasonerOutput (action with args map) |
| Arrays of objects | MonitorReport (anomalies), GoalRepresentation (subgoals) |
| All-optional fields | TimelineOptions |
| Booleans | ClusterConfig, CognitiveModuleStep |
| Signed numbers | EvictionInfo (negative delta) |
| Literal discriminators | CognitiveModuleStep (type: 'cognitive:module_step') |

### Corpus

Synthetic augmentation from 12 seeds → 2000 pairs (1600 train / 400 holdout).
Generator (`scripts/generate-corpus.mjs`) produces random interfaces with
3-8 fields, varied types, and validates each pair compiles with Peggy.
~55% validation pass rate (rest filtered as invalid grammar combinations).

### Training Run

| Parameter | Value |
|-----------|-------|
| Base model | Qwen/Qwen2.5-0.5B-Instruct |
| Method | LoRA r=16, alpha=32 |
| Trainable params | 2.16M / 494.0M (0.44%) |
| Steps | 3000 |
| Batch size | 2 |
| Learning rate | 2e-4 |
| Max length | 768 tokens |
| Training time | 55 min (RTX 4090) |
| Peak VRAM | 9018 MB |
| Final train loss | 0.167 |
| Final eval loss | 0.130 |
| Token accuracy | 96.1% |

### Eval Loss Progression

| Step | Eval Loss | Token Accuracy | Epoch |
|------|-----------|---------------|-------|
| 500 | 0.141 | 96.1% | 0.62 |
| 1000 | 0.135 | 96.1% | 1.25 |
| 1500 | 0.133 | 96.1% | 1.88 |
| 2000 | 0.131 | 96.1% | 2.50 |
| 2500 | 0.130 | 96.1% | 3.12 |
| 3000 | 0.130 | 96.1% | 3.75 |

Loss converged by step 2000. Token accuracy plateaued at 96.1% from the
start — the model learned the grammar structure very quickly.

---

## Gate A-G1: Grammar Compilability

**Target:** >= 90% of generated grammars compile with Peggy
**Result:** **100% (50/50)**

### Synthetic Holdout

50 holdout entries (same distribution as training). All 50 grammars compile
and parse a test example. 49/50 structural match with expected grammar (98%).

### Real Unseen Interfaces (Generalization)

5 production interfaces from parts of the codebase NOT in training data:

| Interface | Source | Fields | Result |
|-----------|--------|--------|--------|
| TriggerEvent | bridge/triggers | 6 (enum + strings + number) | **COMPILES** |
| OllamaModelInfo | pacta-provider-ollama | 6 (strings + number) | **COMPILES** |
| RelayableEvent | cluster/federation | 6 (required + optional + enum + boolean) | **COMPILES** |
| WorktreeInfo | bridge/sessions | 4 (enum + nullable strings + boolean) | **COMPILES** |
| StrategyGate | bridge/strategies | 6 (strings + enums + optionals) | **COMPILES** |

**5/5 compile.** The model generalizes to real interfaces it never saw during training.

### Observed Grammar Quality

The model correctly handles:
- **Enum types:** `'file' | 'git' | 'webhook'` → `("file" / "git" / "webhook")`
- **Nullable strings:** `string | null` → `"none" { return null; } / QuotedString`
- **Optional fields:** `timeout_ms?: number` → `TimeoutMsOpt` with empty-string fallback
- **camelCase → UPPER_SNAKE:** `trigger_type` → `TRIGGER_TYPE:`
- **Primitive selection:** `number` → `Float`, `string` → `QuotedString`, `boolean` → `Bool`
- **Consistent structure:** top-level rule with labeled fields, section rules, shared primitives

---

## Gate A-G2: Downstream SLM Quality

**Target:** >= 85% parse accuracy for downstream SLM trained on B-1 grammar
**Result:** **100% parse accuracy, 100% semantic match (50/50)**

### Method

1. Took B-1's generated grammar for `WorktreeInfo` (4 fields: enum, 2× nullable, boolean)
2. Generated 1250 corpus entries: random context → DSL output following B-1's grammar
3. 100% of generated entries parse through the B-1 grammar (grammar is self-consistent)
4. Trained downstream SLM: Qwen2.5-0.5B LoRA r=16, 1500 steps, batch 4
5. Downstream training: 26 min on RTX 4090, 3.4 GB VRAM, loss 0.138
6. Generated 50 predictions on holdout
7. Validated each prediction parses through B-1's grammar

### Results

| Metric | Value |
|--------|-------|
| Parse accuracy | 50/50 (100%) |
| Semantic match | 50/50 (100%) |
| Downstream training time | 26 min |
| Downstream VRAM | 3394 MB |

Every prediction from the downstream SLM is valid DSL that parses through the
grammar B-1 generated. The full flywheel works end-to-end.

---

## Key Findings

**F1: 2K synthetic pairs are sufficient for Level 1 abstraction.**
12 hand-crafted seed pairs, augmented to 2000 with a synthetic generator, produce
a B-1 model that achieves 100% compilability. No GitHub scraping or large corpus
needed for the initial validation. The seed data quality (covering diverse type
patterns) matters more than quantity.

**F2: B-1 generalizes to unseen real interfaces.**
The model was trained only on synthetic interfaces generated from composable parts.
When given 5 real production interfaces with different naming conventions, domain
contexts, and type combinations, it produced valid grammars for all 5. The model
learned the *pattern* of type→grammar translation, not just the specific types.

**F3: The bootstrap flywheel works end-to-end.**
TypeScript interface → B-1 grammar → corpus → downstream SLM → valid DSL output.
Each stage produces output that the next stage can consume. The downstream SLM
achieves 100% parse accuracy on a grammar it never saw during training — a grammar
that was itself generated by another SLM.

**F4: Training is cheap and fast.**
B-1: 55 min, 9 GB VRAM. Downstream: 26 min, 3.4 GB VRAM. Both on a consumer
RTX 4090 with LoRA r=16 training < 1% of parameters. The entire pipeline from
seed data to validated downstream SLM ran in a single session.

**F5: Token accuracy plateaus early at 96.1%.**
The model reached its accuracy ceiling by step 500 (epoch 0.62). Additional
training reduced loss but didn't improve token accuracy. This suggests 96.1%
may be the accuracy ceiling for this corpus size/distribution, or the remaining
3.9% are genuinely hard edge cases. Worth investigating with adversarial
evaluation in a future run.

---

## What's Not Yet Validated

- **Multi-language input:** B-1 trained on TypeScript only. JSON Schema, Protobuf,
  Rust struct inputs are untested.
- **Complex types:** Nested objects, recursive types, generic types, discriminated
  unions with payloads are not in the synthetic generator.
- **Adversarial accuracy:** No boundary-case evaluation (cf. Phase 3's adversarial
  metric which was the primary scaling signal).
- **Grammar A-G2 at scale:** Only tested on WorktreeInfo (4 fields, simple grammar).
  More complex grammars (arrays of objects, nested structures) need validation.

---

## Next Steps

1. **B-2 (Causal Validator SLM):** Now that B-1 is validated, automate corpus
   quality validation — the next bottleneck in the flywheel.
2. **A-G2 on complex grammar:** Repeat Gate A-G2 with a B-1 grammar for a more
   complex interface (6+ fields, arrays, nested objects).
3. **Adversarial evaluation:** Create boundary cases for B-1 (unusual type
   combinations, deeply nested generics, edge-case field names) and measure
   adversarial accuracy.
4. **Composition runtime:** Build the CLM execution engine with validation gates
   (Phase 3 of the experiment plan).
5. **Multi-language generalization:** Test B-1 on JSON Schema and Protobuf inputs
   without retraining.
