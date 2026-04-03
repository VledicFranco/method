# RFC 005: Composed Language Models — SLM Composition and Bootstrapping

**Status:** Draft — exploratory theory document
**Author:** PO + Lysica
**Date:** 2026-04-03
**Applies to:** `@method/pacta`, `experiments/exp-slm-composition`
**Organization:** Vidtecci
**Extends:** RFC 002 (Small Language Models as Cognitive Skill Compilation)
**Depends on:** RFC 002 experimental results (Phase 3 Gate 3 PASS, Phase 5 R-14 through R-22)

## Motivation

RFC 002 proved that individual cognitive modules can be compiled to SLMs with
production-grade accuracy (93.4% adversarial, 99.6% on generalization tasks) at
a fraction of frontier LLM cost. Phase 5 experiments (R-14 through R-22) then showed
that composing SLMs with workspace partitioning, memory, and write-phase enforcement
produces emergent capabilities none of the components achieve alone — T06 went from
0% to 71% pass rate only when all layers were present.

But the current architecture uses SLMs only for metacognition (Observer, Monitor,
Evaluator). The Reasoner-Actor — the module that does the actual work — remains a
frontier LLM. This means the most expensive component is uncompiled.

This RFC proposes two advances:

1. **SLM Composition (CLM):** Composed Language Models that chain specialized SLMs
   to perform complex tasks currently requiring frontier models. Not one SLM replacing
   one LLM, but a *pipeline* of SLMs where each handles a bounded subtask.

2. **SLM Bootstrapping:** Using SLMs to accelerate the creation of new SLMs, creating
   a flywheel that makes composition experiments practical by reducing the per-SLM
   creation cost.

The insight: if the bottleneck to composition is that each SLM requires manual grammar
design (Phase 2) and corpus engineering (Phase 3), then the first composition target
should be the SLM creation pipeline itself.

### Why Composition, Not Bigger SLMs

The scaling analysis from Phase 3 showed the 0.5B model class plateaus at 93.4%
adversarial accuracy. Breaking past 95% likely requires 1.5B+ models, which erodes the
cost advantage. Composition offers an alternative: instead of making one SLM more
capable, make multiple SLMs collaborate on a problem where each sees a bounded subproblem.

This mirrors the cognitive architecture finding from R-07: selective, targeted
metacognition outperforms maximal monitoring. The same principle applied to generation:
selective, targeted SLMs outperform monolithic ones.

## Part I: SLM Taxonomy

RFC 002 defined SLMs as compiled cognitive modules. This RFC refines the taxonomy based
on what the SLM actually does:

### Three Types

| Type | Function | I/O Characteristics | Examples (existing) |
|------|----------|---------------------|---------------------|
| **Classifier** | Bounded judgment → structured label | Closed output vocabulary, enumerable | Observer (novelty), Monitor (anomaly), Evaluator (progress) |
| **Translator** | Format A → Format B | Both sides are formal languages, often round-trippable | MonitorReport ↔ DSL, signal-translators, type-mapping |
| **Generator** | Structured input → structured output | Input is formal, output is formal but creative | JSON Schema → TypeScript (Phase 3 Run 10, 99.6%) |

The distinction matters for composition because **error propagation behaves differently**:

- **Classifier errors** are bounded: a wrong label affects one decision point.
- **Translator errors** compound linearly: each hop in a translation chain can
  introduce format errors that break downstream parsing.
- **Generator errors** compound multiplicatively: a structural error in generated code
  (e.g., missing export) cascades through everything that depends on it.

This means composition pipelines should minimize generator stages and maximize
classifier/translator stages, where errors are contained.

### Composition Operators

SLMs compose via the same algebra as cognitive modules (RFC 001):

- **Sequential** `A ▸ B` : Output of A feeds input of B. The translation chain.
- **Parallel** `A ⊗ B` : Independent SLMs run concurrently, results merged.
- **Competitive** `A ⊕ B` : Multiple SLMs produce candidates, a classifier picks.
- **Gated** `g → A | B` : A classifier SLM routes to the appropriate generator.

A **Composed Language Model (CLM)** is a composition expression over SLMs:

```
CLM = (S₁ ▸ S₂ ▸ ... ▸ Sₙ) where each Sᵢ is an SLM or sub-CLM
```

With validation gates between stages:

```
CLM = S₁ ▸ V₁ ▸ S₂ ▸ V₂ ▸ ... ▸ Sₙ
```

Where each `Vᵢ` is a classifier SLM that validates the output of `Sᵢ` before passing
it to `Sᵢ₊₁`. If validation fails, the pipeline can retry, escalate to frontier LLM,
or abort. This bounds error propagation.

## Part II: The Bootstrapping Problem

### Current SLM Creation Pipeline

```
Step 1: Collect frontier LLM traces      ← manual, creative
Step 2: Design DSL grammar (PEG)          ← manual, creative (bottleneck)
Step 3: Write corpus generator            ← manual Python/TS script
Step 4: Ensure causal consistency         ← manual, Phase 3's key finding
Step 5: Train (LoRA, Qwen2.5-0.5B)       ← automated
Step 6: Validate (parse/semantic/adv)     ← automated
Step 7: Export ONNX, integrate            ← automated
```

Steps 1-4 require ~1 week of human+LLM work per SLM. A 5-stage CLM requires 5 SLMs.
At current velocity, that's 5 weeks before you can even test the composition hypothesis.

### The Bootstrap Strategy

Build SLMs that automate steps 1-4, in priority order:

#### B-1: Type→Grammar SLM (Translator)

**Input:** TypeScript interface definition
**Output:** PEG grammar (Peggy format)

The keystone. Every SLM ultimately needs a grammar. You already have 3 working
type→grammar pairs (Monitor, Observer, Evaluator) plus the general pattern is
well-documented in RFC 002 Part II.

**Why this is tractable:** Both TypeScript types and PEG grammars are formal languages
with well-defined structure. The mapping has clear rules:
- `string` → `QuotedString` rule
- `boolean` → `"yes" / "no"` alternation
- `enum` → enumerated alternation
- `Array<T>` → repetition rule with separator
- `interface` → section sequence
- optional fields → optional sections

**Self-validating:** Generate a grammar, compile it with Peggy, try to parse examples.
If parsing fails, the grammar is wrong. Free validation signal.

**Training data sources:**
- Existing type→grammar pairs (Monitor, Observer, Evaluator) — 3 pairs
- TypeScript standard library types → synthetic grammars (augmentation)
- Grammar correctness validated by Peggy compilation (filter bad outputs)

**Estimated corpus:** ~5K examples (type variations × grammar patterns). Smaller
than Phase 3's 10K because the output space (PEG syntax) is more constrained than
Monitor DSL decisions.

#### B-2: Causal Validator SLM (Classifier)

**Input:** (input example, output example, causal rules)
**Output:** valid | invalid | uncertain

Phase 3's biggest finding: causal consistency in training data was the difference
between 39% and 98.6% accuracy. A classifier SLM that detects causal violations
in generated corpus entries would automate the quality gate.

**Why this is tractable:** Binary classification with rules provided in-context.
The SLM doesn't need to invent causal rules — it applies given rules to given
examples. This is the same pattern as the Monitor SLM (apply anomaly rules to
signal inputs).

**Conservative threshold is safe:** False negatives (rejecting valid pairs) waste
training data but don't hurt model quality. False positives (accepting broken pairs)
hurt quality. Threshold high, accept only confident "valid" predictions.

#### B-3: Trace Distiller SLM (Translator)

**Input:** Frontier LLM natural language output (reasoning trace)
**Output:** Structured decision pattern (typed fields extracted)

Automates Step 1. When you run a frontier LLM on a task and want to compile the
behavior to an SLM, the first step is extracting what structured decisions the LLM
actually made. Currently this is manual trace analysis.

**Why this is tractable:** The output is bounded by the module's type contract.
The SLM isn't understanding the reasoning — it's extracting typed fields from
natural language. This is essentially NER (named entity recognition) over
domain-specific output, a well-understood SLM task.

#### B-4: World Extractor SLM (Translator)

**Input:** Source code + type definitions + documentation
**Output:** World specification (input/output types, causal rules, vocabulary bounds)

The most ambitious bootstrap SLM. Given a codebase context, extract a specification
of what an SLM for that domain needs to know: what types it handles, what rules
govern the mapping, and whether the vocabulary is closed or open-ended.

**Why this is harder:** The input (source code + docs) is less constrained than
the other bootstrap SLMs' inputs. May require a smaller scope — e.g., extracting
from a single TypeScript file rather than a full codebase.

**May not need to be an SLM:** This step could remain a frontier LLM call (one-shot,
not per-training-example) that produces a world spec, which then feeds into the
automated pipeline. The cost is acceptable because it runs once per SLM, not once
per corpus entry.

### The Flywheel

```
B-1 (Type→Grammar) exists
  → creating B-2's grammar is automated by B-1
  → B-2 (Causal Validator) exists
    → corpus quality for ALL future SLMs is automated
    → creating B-3's grammar is automated by B-1
    → B-3 (Trace Distiller) exists
      → Step 1 (trace collection) is automated
      → full pipeline: code → traces → distill → grammar → corpus → validate → train
      → new SLM creation drops from ~1 week to ~1 day
        → composition experiments become practical
```

Each turn of the flywheel reduces the human effort required per SLM. The goal is not
zero-human SLM creation (the creative decisions still need human or frontier LLM
judgment) but reducing the mechanical labor that currently dominates the timeline.

## Part III: Composition Targets

Once bootstrapping makes SLM creation cheap, these are the first composition
experiments:

### Target 1: DSL Pipeline CLM

The bootstrapping pipeline itself is the first CLM:

```
TypeScript interface
  → B-1 (Type→Grammar)     [translator]
  → Peggy compile           [deterministic — not an SLM]
  → Corpus generation       [deterministic + B-2 validation]
  → Training                [automated]
  → Validation              [automated]
```

This is a CLM where most stages are deterministic and only 2 are SLMs. Low risk,
high leverage. If this works, you've built a self-improving SLM factory.

### Target 2: Domain-Scoped Code CLM

A CLM for generating code within a constrained domain (e.g., FCA domain scaffolding):

```
Domain spec (ports, types, routes)
  → Interface Generator SLM       [generator: spec → .d.ts]
  → Implementation Skeleton SLM   [generator: interface → body]
  → Import Resolver SLM           [translator: context → imports]
  → Validation Classifier SLM     [classifier: does it typecheck?]
```

Each stage has bounded I/O because the domain conventions constrain the solution space.
This is NOT a general-purpose code generator — it's a pattern instantiator for a
specific architectural style.

### Target 3: Cognitive Reasoner Decomposition

The most ambitious target: decomposing the Reasoner-Actor into composed SLMs:

```
Task + workspace context
  → Task Classifier SLM           [classifier: what kind of task?]
  → Strategy Selector SLM         [classifier: which approach?]
  → Action Generator SLM          [generator: context → tool call]
  → Result Validator SLM          [classifier: did it work?]
```

This only works if the task space is bounded (known task types, known tools, known
patterns). For open-ended reasoning, the frontier LLM remains necessary. The
MetaComposer module (already v1 production in `packages/pacta`) classifies tasks into
cognitive profiles (muscle-memory, routine, deliberate, conflicted, creative). SLM
composition handles muscle-memory and routine; frontier handles deliberate+.

## Part IV: Error Compounding Analysis

The central risk of composition: if each SLM is 93% accurate and you chain 5,
you're at ~70% overall. This section analyzes where the errors actually come from
and how to bound them.

### Error Sources by Type

| SLM Type | Error Mode | Detectable? | Recovery |
|----------|-----------|-------------|----------|
| Classifier | Wrong label | Downstream behavior anomaly | Retry with different threshold |
| Translator | Malformed output | Parse failure (free) | Retry or escalate |
| Generator | Structurally valid but semantically wrong | Requires external validation | Escalate to frontier |

**Key insight:** Translator errors are **self-healing** because the next stage's parser
rejects malformed input. This means translator-heavy pipelines are safer than
generator-heavy ones. Design CLMs to maximize translator stages.

### Validation Gates

Between every composition stage, insert a validation gate:

```
Sᵢ output → parse check → schema check → Vᵢ classifier → Sᵢ₊₁ input
```

1. **Parse check** (free): Does the output conform to the grammar?
2. **Schema check** (free): Does the parsed output match the expected type?
3. **Classifier gate** (SLM): Is the output semantically reasonable?

If any gate fails: retry Sᵢ (up to N times), then escalate to frontier LLM for
that stage. This bounds the composition error rate to the gate classifier's
false-positive rate, not the generator's raw error rate.

### Theoretical Error Bounds

For a pipeline of N stages with per-stage accuracy `a` and gate false-positive
rate `f`:

- **Without gates:** `a^N` (multiplicative compounding)
- **With gates:** `1 - N × f` (linear in gate error, independent of generator accuracy)

With gates at 95% true-positive rate (conservative), a 5-stage pipeline has
`1 - 5 × 0.05 = 75%` lower bound. With gates at 99%, it's `1 - 5 × 0.01 = 95%`.

The gate classifier accuracy is the binding constraint, not the generator accuracy.
This inverts the optimization target: invest in gate classifiers, not generators.

## Part V: Infrastructure Requirements

### What Exists (from RFC 002 experiments)

- Qwen2.5-Coder-0.5B LoRA training pipeline (Phase 3)
- PEG grammar tooling: Peggy compiler, round-trip verification (Phase 2)
- DSL codecs: encoder/decoder for Monitor, Observer, Evaluator (Phase 4)
- SLM inference: Ollama adapter, ONNX export path (Phase 4)
- Cognitive cycle integration: SLM provider adapter (Phase 5)
- GPU: RTX 2080 Ti (local), RTX 4090 (chobits, Tailscale)

### What Needs to Be Built

| Component | Purpose | Depends On |
|-----------|---------|------------|
| **Grammar corpus generator** | Produce (TS type, PEG grammar) training pairs from existing grammars + synthetic variations | Existing grammars as seed data |
| **Composition runtime** | Execute CLM pipelines: stage routing, validation gates, error recovery, escalation | Existing SLM inference adapter |
| **Composition metrics** | Per-stage accuracy, error propagation tracking, gate effectiveness | Existing slm-cycle-metrics |
| **Peggy-in-the-loop validator** | Compile generated grammars, parse test examples, report errors back to training | Peggy CLI |
| **Bootstrap evaluation harness** | Test meta-SLMs by measuring whether the SLMs they help create are actually good | Phase 3 evaluation scripts |

### Training Budget

| SLM | Estimated corpus | Training time (RTX 4090) | Training time (RTX 2080 Ti) |
|-----|-----------------|--------------------------|----------------------------|
| B-1 Type→Grammar | ~5K pairs | ~10 min | ~20 min |
| B-2 Causal Validator | ~10K pairs | ~15 min | ~25 min |
| B-3 Trace Distiller | ~8K pairs | ~12 min | ~22 min |

All SLMs use Qwen2.5-Coder-0.5B with LoRA r=16 (the recommended production
configuration from Phase 3).

## Part VI: Validation Plan

### Gate B — Bootstrap Validation

| Gate | Metric | Target | How to measure |
|------|--------|--------|----------------|
| B-G1 | B-1 grammar compilability | >= 90% of generated grammars compile | Peggy compile + parse test |
| B-G2 | B-1 grammar quality | SLM trained on B-1 grammar achieves >= 85% semantic accuracy | Train a downstream SLM, compare to hand-designed grammar |
| B-G3 | B-2 causal detection | >= 90% precision on known-bad pairs, >= 70% recall | Holdout set of labeled pairs |
| B-G4 | Pipeline speedup | New SLM creation time < 2 days (vs ~1 week baseline) | Wall-clock measurement |

### Gate C — Composition Validation

| Gate | Metric | Target | How to measure |
|------|--------|--------|----------------|
| C-G1 | 2-stage CLM accuracy | >= 85% end-to-end on bounded task | Target 1 (DSL pipeline) |
| C-G2 | Gate effectiveness | Gates reduce error propagation by >= 50% vs ungated | Ablation: remove gates, measure delta |
| C-G3 | Cost ratio | CLM cost < 10% of frontier LLM for equivalent task | Token cost comparison |

### Abandonment Conditions

- If B-1 (Type→Grammar) cannot achieve >= 80% compilable grammars after 3 training
  iterations, the grammar design task is too creative for 0.5B SLMs. Escalate to
  frontier LLM for grammar design (one-shot cost acceptable) and focus composition
  research on non-bootstrap targets.
- If 2-stage CLM error compounding exceeds gate recovery capacity (net accuracy < 60%),
  composition is not viable at current SLM accuracy levels. Wait for higher base
  accuracy (larger models or better training).
- If bootstrapping speedup is < 2x (creation time doesn't halve), the automation
  overhead exceeds the manual effort it replaces. Keep manual pipeline.

## Open Research Questions

**Q1: What is the minimum grammar corpus size for B-1?**
The existing seed data is only 3 type→grammar pairs. Synthetic augmentation
(type variations, grammar perturbations) may suffice, or may introduce distribution
artifacts. Empirical question.

**Q2: Can causal rules be expressed in a DSL that B-2 can parse?**
If causal rules are natural language, B-2 needs NLU. If they're a formal DSL
(like the world spec in Part II), B-2 only needs pattern matching. The world spec
DSL design determines B-2's feasibility.

**Q3: Where is the composition depth ceiling?**
At what N does the CLM pipeline become less reliable than a single frontier LLM call?
Depends on gate quality. If gates are 99% accurate, N can be large. If 90%, N ≈ 3-4.

**Q4: Does the cognitive module algebra transfer to SLM composition?**
The sequential/parallel/competitive/gated operators from RFC 001 were designed for
cognitive modules with state. SLMs in a pipeline may not need state — does the
algebra simplify, and does it still compose correctly?

**Q5: Can competitive composition (`A ⊕ B`) improve generator reliability?**
Run 3 generators with different temperatures, pick the output that passes the most
validation gates. This converts generator variance into reliability at 3x compute
cost. Worth it if gate classifiers are strong.
