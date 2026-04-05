---
type: prd
title: "PRD 049: KPI Checker SLM — Compiled Verification Predicates"
date: "2026-04-05"
status: draft
tier: heavyweight
depends_on: [48, 45]
enables: []
blocked_by: []
complexity: high
domains: [experiments/exp-slm, algebra/verification, modules/verifier, modules/planner]
surfaces: [KPICheckerSLM, KPICheckerInput, KPICheckerOutput, CheckDSLGrammar]
rfc: "docs/rfcs/002-small-language-models.md"
---

# PRD 049: KPI Checker SLM — Compiled Verification Predicates

## Problem

PRD 048 (Cybernetic Verification Loop) introduced the Verifier module with two modes:
programmatic checks (via DSL predicates) and LLM fallback. R-27 revealed that the
Planner's LLM call generates **0 programmatic checks** for most tasks — the `<checks>`
block is not reliably produced. This forces every verification into LLM fallback mode,
which costs ~1K tokens per check and is unreliable (the same LLM quality issues that
cause the agent to write wrong code also affect its verification assessments).

The root cause: asking a frontier LLM to generate structured DSL code inside a complex
planning prompt is the wrong tool for the job. The LLM is optimized for natural language,
not for reliably emitting a constrained formal language. This is exactly the compilation
pattern from RFC 002: a recurring cognitive task (KPI → predicate mapping) that should
be compiled from slow frontier deliberation into fast specialized execution.

### The Compilation Target

```
Input:  "v2 handler file created with handleOrderV2 exported, no side effects"
Output: allChecks(fileExists('src/handlers/v2.ts'), fileExports('src/handlers/v2.ts', 'handleOrderV2'))
```

This mapping is:
- **Repetitive:** Every task produces 3-6 KPIs, each needing the same kind of translation
- **Constrained:** The output is a small formal language (the Check DSL from PRD 048)
- **Pattern-based:** "file created" → fileExists, "exports X" → fileExports, "contains Y" → fileContains
- **Low-latency required:** Runs at cycle 0, must not add perceptible delay

RFC 002 has validated this pipeline: frontier traces → synthetic corpus → DSL grammar →
SLM training → ONNX export. Gates 0-5 PASSED for Monitor, Observer, and Evaluator SLMs.
The KPI checker is the fourth compilation target.

## Design Alternatives

### Alternative A: Classification SLM (Recommended)

**Architecture:** Encoder-classifier that maps KPI text → one of N predefined templates
with extracted argument slots.

```
Input:  "<kpi>v2 handler file created with handleOrderV2</kpi><context>TypeScript project, src/handlers/</context>"
Output: "file_exists('src/handlers/v2.ts') && file_exports('src/handlers/v2.ts', 'handleOrderV2')"
```

**How it works:**
1. Input is a KPI description + task context (file paths mentioned, goal summary)
2. SLM outputs a DSL string that maps directly to the Check DSL grammar
3. Output is parsed by the existing `parseChecksBlock` infrastructure
4. Invalid outputs fall back to description-only KPIs

**Pros:** Most aligned with RFC 002's validated pipeline. DSL grammar is already defined.
Training data can be synthesized from the existing task suite. SmolLM2-135M likely
sufficient (Monitor SLM handles similar complexity at 100% accuracy).

**Cons:** Limited to the existing DSL primitives. Can't express arbitrary verification
logic (but the DSL covers ~90% of coding task KPIs).

### Alternative B: Seq2Seq Generation SLM

**Architecture:** Encoder-decoder that generates arbitrary TypeScript verification
functions from KPI descriptions.

```
Input:  "<kpi>v2 handler has no side effects (no audit logging, no notifications)</kpi>"
Output: "(state) => { const f = state.files.get('src/handlers/v2.ts'); return { met: f && !f.includes('notifyAudit') && !f.includes('logOrder'), evidence: '...' }; }"
```

**Pros:** Maximum flexibility — can express any verification logic.

**Cons:** Much harder to train reliably. Generated code may have syntax errors, runtime
errors, or security issues. Requires a sandbox for execution. The bootstrapping problem:
an SLM trained on LLM-generated code inherits the LLM's code quality issues.
Needs 360M+ parameters for reliable TypeScript generation.

### Alternative C: Template Matching + Slot Filling

**Architecture:** Two-stage pipeline — first classify the KPI type (existence, content,
export, structural), then fill argument slots.

```
Stage 1: "v2 handler file created" → template: FILE_EXISTS(path)
Stage 2: path → "src/handlers/v2.ts" (from context: src/handlers/ directory + "v2" keyword)
```

**Pros:** Extremely reliable (classification is much easier than generation). Each stage
can be a tiny model or even rule-based. Argument extraction can use pattern matching.

**Cons:** Less flexible than full generation. Adding new KPI types requires new templates.
But templates can be added incrementally.

### Alternative D: Hybrid — SLM Classification + Rule-Based Slot Filling

**Architecture:** SLM classifies the KPI intent, rules extract arguments.

```
SLM:   "v2 handler file created with handleOrderV2 exported" → INTENT: [EXISTS, EXPORTS]
Rules: EXISTS → fileExists(extractPath(context, 'v2'))
       EXPORTS → fileExports(extractPath(context, 'v2'), extractName(kpi, 'export'))
```

**Pros:** Combines SLM's strength (intent classification) with deterministic reliability
(rule-based slot filling). Very small SLM needed (just intent classification).

**Cons:** Rules need maintenance. But the intent space is small and well-defined.

### Recommendation

**Alternative A (Classification SLM)** for the primary path — it aligns with the
proven RFC 002 pipeline and the existing DSL infrastructure. **Alternative D (Hybrid)**
as the backup if the SLM's argument extraction is unreliable.

## Inputs and Outputs

### Input Schema

```typescript
interface KPICheckerInput {
  /** Natural language KPI description. */
  kpi: string;
  /** Task context for argument extraction. */
  context: {
    /** Goal objective (one sentence). */
    objective: string;
    /** File paths mentioned in the task or discovered by the agent. */
    knownPaths: string[];
    /** Identifiers mentioned (function names, class names, etc). */
    knownIdentifiers: string[];
    /** Task type hint from Planner difficulty assessment. */
    difficulty: 'low' | 'medium' | 'high';
  };
}
```

### Output Schema

```typescript
interface KPICheckerOutput {
  /** DSL expression string, parseable by parseChecksBlock(). */
  dslExpression: string;
  /** Confidence in the output [0, 1]. */
  confidence: number;
  /** Whether this output should be used (confidence > threshold). */
  usable: boolean;
}
```

### DSL Grammar (from PRD 048)

```
check_expr := primitive | and_expr
and_expr   := check_expr '&&' check_expr
primitive  := 'file_exists' '(' path ')'
            | 'file_contains' '(' path ',' pattern ')'
            | 'file_exports' '(' path ',' name ')'
            | 'file_count_changed' '(' number ')'
path       := "'" filepath "'"
pattern    := "'" string "'"  | '/' regex '/'
name       := "'" identifier "'"
number     := [0-9]+
```

## SLM Family

Multiple model sizes for different cost/quality tradeoffs:

| Model | Parameters | Inference | Use Case |
|-------|-----------|-----------|----------|
| KPI-Checker-Nano | SmolLM2-135M | <50ms, ~50MB | Classification only (intent → template) |
| KPI-Checker-Lite | SmolLM2-360M | <100ms, ~150MB | Full DSL generation (KPI → expression) |
| KPI-Checker-Base | Phi-3-mini-3.8B | <500ms, ~2GB | Complex multi-predicate expressions |

**Training pipeline (per RFC 002):**

```
Phase 1: Frontier trace collection
  → Run tasks with frontier Planner, collect (KPI, context) → DSL pairs
  → Manual correction of frontier outputs for quality

Phase 2: Synthetic corpus expansion
  → Generate variations: paraphrased KPIs, different path structures
  → Target: 2K-5K pairs per model size

Phase 3: DSL grammar validation
  → Every training example's output must parse and type-check
  → Grammar-based filtering (reject malformed DSL)

Phase 4: Fine-tuning
  → SmolLM2-135M/360M on the validated corpus
  → Causal language modeling (same as Monitor/Observer SLM training)

Phase 5: Evaluation gates
  → Gate 1: 100% DSL parse accuracy on validation set
  → Gate 2: ≥ 90% semantic accuracy (correct predicate for the KPI)
  → Gate 3: ≥ 85% argument accuracy (correct paths/names extracted)
  → Gate 4: ONNX export + inference parity with PyTorch

Phase 6: Integration
  → Replace Planner's LLM-based CheckableKPI generation
  → Verifier uses SLM-generated programmatic checks first
```

## Integration with Cognitive Modules

### Integration Point 1: Planner (cycle 0)

Replace the LLM `requestCheckableKPIs()` call with the SLM:

```typescript
// Current (PRD 048): LLM call, unreliable
const { checkableKpis } = await requestCheckableKPIs(adapter, goal, kpis, id);

// Proposed: SLM inference, reliable + near-zero cost
const checkableKpis = kpiCheckerSLM.generateChecks(kpis.map(kpi => ({
  kpi,
  context: { objective: goal.objective, knownPaths, knownIdentifiers, difficulty },
})));
```

**Port interface:**

```typescript
interface KPICheckerPort {
  /** Generate checkable predicates from KPI descriptions. */
  generateChecks(inputs: KPICheckerInput[]): CheckableKPI[];

  /** Model metadata. */
  readonly model: string;
  readonly version: string;
}
```

Injected via the existing port pattern. The Planner consumes `KPICheckerPort`.
Default implementation: frontier LLM fallback (current behavior). SLM implementation
replaces it after training.

### Integration Point 2: Verifier (per-action, future)

The Verifier could also use the SLM to generate ad-hoc checks based on action outcomes:

```
Input:  "Agent wrote src/handlers/v2.ts with content: ..."
KPI:    "v2 handler exports handleOrderV2"
SLM →:  fileExports('src/handlers/v2.ts', 'handleOrderV2')
```

This is a stretch goal — the primary integration is through the Planner.

### Integration Point 3: Evaluator (KPI-informed discrepancy, future)

The phase-aware evaluator could use programmatic KPI checks to provide more accurate
discrepancy signals:

```
Evaluator prompt: "KPI check results: 2/4 passed (file_exists: PASS, file_exports: FAIL, ...)"
```

This replaces the LLM's guess-based assessment with ground truth from programmatic checks.

## Training Data Strategy

### Source 1: Existing Task Suite (T01-T06)

Each task has a `validate()` function that checks specific conditions. These are
effectively KPIs with programmatic checks already defined:

| Task | KPI (natural language) | DSL (from validate()) |
|------|----------------------|----------------------|
| T01 | No circular dependency in import graph | `fileContains('module-a.ts', /^(?!.*import.*from.*module-b)/)` |
| T02 | applyDiscount formula fixed | `fileContains('src/pricing.ts', 'price - (price * percent / 100)')` |
| T04 | v2 handler exports handleOrderV2 | `fileExports('src/handlers/v2.ts', 'handleOrderV2')` |
| T04 | Router handles v2 | `fileContains('src/router.ts', 'v2')` |
| T05 | No files removed (trap) | `fileCountChanged(0, initialFiles)` |

These provide ~20 high-quality (KPI, DSL) pairs for few-shot seeding.

### Source 2: Frontier Trace Collection

Run the Planner with an enhanced prompt that reliably produces the `<checks>` block:
- Use a separate, focused LLM call (not embedded in the assessment prompt)
- Provide 5+ few-shot examples in the prompt
- Collect (KPI description, generated DSL) pairs
- Human-review and correct
- Target: 200+ pairs from 50+ task variations

### Source 3: Synthetic Expansion

From the 200+ corrected pairs, generate variations:
- Paraphrase KPIs: "file created" → "new file exists" → "file was written"
- Vary paths: "src/handlers/v2.ts" → "lib/routes/v2.ts" → "api/endpoints/v2.ts"
- Vary identifiers: "handleOrderV2" → "processRequestV2" → "createUserV2"
- Compose predicates: combine 2-3 primitives per example
- Target: 2K-5K pairs for SmolLM2-135M, 5K-10K for 360M

### Source 4: Adversarial Examples

Generate edge cases the SLM must handle correctly:
- Ambiguous KPIs: "code quality improved" → no DSL possible → output empty/low confidence
- Negative patterns: "no side effects" → fileContains with negated regex
- Multi-file KPIs: "all import sites updated" → multiple fileContains checks
- Non-coding KPIs: "documentation complete" → no DSL → fall back to LLM

## Success Criteria

1. **DSL parse rate ≥ 98%.** SLM outputs must parse as valid DSL expressions.
   Measured on held-out test set (100+ examples).

2. **Semantic accuracy ≥ 90%.** The generated predicate correctly captures the KPI's
   intent. Measured by human evaluation of 50+ test cases.

3. **Argument accuracy ≥ 85%.** Paths and identifiers extracted correctly from context.
   Measured by exact match on held-out test set.

4. **Inference latency < 100ms.** SLM must not add perceptible delay to cycle 0.
   Measured on CPU (no GPU required for inference).

5. **Integration lift.** When integrated into the Planner, programmatic check rate
   rises from 0% (current) to ≥ 80% of KPIs. Measured in R-28 experiment.

6. **Task performance lift.** T04 pass rate improves when the Verifier has programmatic
   checks (catching errors like "handleOrderV2 not exported" immediately).
   Target: T04 ≥ 50% with SLM checks vs ~33% without.

## Experiment Plan

### Phase 1: Corpus Construction

- Collect frontier traces from T01-T06 (200+ KPI/DSL pairs)
- Manual correction + synthetic expansion to 2K-5K pairs
- DSL grammar validation (100% parse rate on corpus)

### Phase 2: Training (per RFC 002 pipeline)

- Fine-tune SmolLM2-135M and SmolLM2-360M
- Evaluate on held-out set: parse rate, semantic accuracy, argument accuracy
- ONNX export for production inference

### Phase 3: Integration + Validation

- Replace Planner's `requestCheckableKPIs()` with SLM inference
- R-28: Run T01-T06 N=5 with SLM-powered verification
- Compare programmatic check rates and task pass rates

## Scope

**In scope:**
- KPICheckerPort interface (consumed by Planner, implemented by SLM adapter)
- Training data collection from existing task suite + frontier traces
- SLM training (SmolLM2-135M primary, 360M if 135M insufficient)
- ONNX export + inference adapter
- Planner integration (replace LLM `requestCheckableKPIs`)
- R-28 validation experiment

**Out of scope:**
- Verifier integration point 2 (per-action SLM checks — future)
- Evaluator integration point 3 (KPI-informed discrepancy — future)
- Alternative B (Seq2Seq code generation — deferred)
- Multi-language support (TypeScript only for now)
- GPU inference (CPU-only, targeting < 100ms)

## Relationship to Existing Work

- **RFC 002 (SLM Compilation):** Fourth compilation target after Monitor, Observer,
  Evaluator. Uses the same pipeline (phases 0-5) and infrastructure (exp-slm/).
- **PRD 048 (Verification Loop):** The SLM replaces the unreliable LLM-based
  CheckableKPI generation. Verifier + Check DSL remain unchanged.
- **RFC 006 (Anticipatory Monitoring):** KPI checks feed the Evaluator's
  discrepancy computation, improving goal-state monitoring accuracy.
- **experiments/exp-slm/:** Training infrastructure from phases 0-4 is reused.
  Phase 6 (KPI checker) becomes a new subdirectory.
