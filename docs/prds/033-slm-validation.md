---
title: "PRD 033: SLM Validation — RFC 002 Experimental Proof"
status: draft
date: "2026-03-28"
tier: "standard"
depends_on: ["030-pacta-cognitive-composition"]
enables: []
blocked_by: []
complexity: "high"
domains_affected: ["pacta/cognitive/modules", "pacta/cognitive/algebra", "experiments/exp-slm"]
rfc: "002-small-language-models"
---

# PRD 033: SLM Validation — RFC 002 Experimental Proof

**Status:** Draft
**Author:** PO + Lysica
**Date:** 2026-03-28
**Package:** `experiments/exp-slm` + `@method/pacta`
**Dependencies:** PRD 030 (complete), RFC 002
**Organization:** Vidtecci

## Problem Statement

RFC 002 proposes Small Language Models trained on typed DSLs as the System 1/2 compilation
mechanism for the cognitive architecture. The thesis: specialized small models (10M-500M
params) can replace frontier LLM calls for routine cognitive module invocations, achieving
order-of-magnitude cost and latency reduction while maintaining task accuracy.

This thesis has zero empirical evidence and cannot yet be tested against the current codebase.
The cognitive modules ranked as highest SLM compilation potential by RFC 002 (Monitor, Observer,
Evaluator) are currently implemented as **pure deterministic TypeScript functions** — they do
not call LLMs and incur zero token cost. There is nothing to compile because there is no LLM
call to replace.

However, these modules are deliberately minimal. The current Monitor applies threshold
arithmetic to detect anomalies; an LLM-backed Monitor could perform richer analysis — detecting
subtle signal patterns, producing natural-language explanations, and adapting its detection
strategy to context. The same applies to Observer (LLM-scored novelty instead of character-level
heuristic) and Evaluator (LLM-assessed progress instead of signal counting).

This PRD takes a two-step approach:
1. **Build an LLM-backed Monitor** that uses `ProviderAdapter` for richer anomaly analysis —
   establishing a real cost baseline
2. **Compile it with an SLM** — validating the full RFC 002 pipeline: DSL design, synthetic
   data generation, small model training, calibration, and integration

This validates the complete thesis end-to-end: can you take an LLM-backed cognitive module,
design a DSL for its output, train a small model to produce that DSL, and achieve cost
reduction without sacrificing task accuracy?

### Current State Analysis

Modules that **use ProviderAdapter** (have LLM cost):
- Reasoner — open-ended reasoning traces, high cost, **poor** SLM candidate
- Planner — goal decomposition, moderate cost, **harder** SLM candidate
- ConflictResolver (P1) — adversarial synthesis, moderate cost, moderate candidate
- ReflectorV2 (P6) — lesson extraction, low cost (Haiku-level), moderate candidate

Modules that **do NOT use ProviderAdapter** (zero LLM cost today):
- Monitor — threshold arithmetic, zero cost, **would be strong** SLM candidate if LLM-backed
- Observer — novelty heuristic, zero cost, **would be strong** candidate if LLM-backed
- Evaluator — progress estimation, zero cost, **would be good** candidate if LLM-backed
- Actor — tool execution dispatch, zero cost

The experiment builds an LLM-backed Monitor v2 to create the compilation target that
doesn't yet exist.

## Objective

Execute a 5-phase validation of RFC 002's SLM compilation thesis:

1. **Phase 0:** Establish infrastructure — Python ML environment, GPU validation, Node.js
   inference runtime
2. **Phase 1:** Build an LLM-backed Monitor v2 using ProviderAdapter — establish cost baseline
3. **Phase 2:** Design DSL for Monitor v2 output, generate synthetic corpus, validate
4. **Phase 3:** Train SLM on Monitor DSL corpus, measure accuracy and calibration
5. **Phase 4:** Integrate SLM Monitor into cognitive cycle, measure cost reduction vs baseline

Each phase has hard gates with explicit abandonment criteria. Cheap sanity checks precede
expensive commitments.

## Architecture & Design

### Experiment Infrastructure

All experiment code lives in `experiments/exp-slm/`, isolated from production packages.
TypeScript experiment code uses project references to `@method/pacta` (not workspace
membership) for type access without coupling.

```
experiments/exp-slm/
  README.md                       Experiment overview, setup, reproducibility
  .gitignore                      Ignore models/, *.onnx, *.gguf; track results/, grammars/, corpus/
  pyproject.toml                  Python deps (transformers, trl, peft, accelerate)
  package.json                    TypeScript deps (peggy, onnxruntime-node)
  tsconfig.json                   Project references to packages/pacta/tsconfig.json
  Makefile                        Orchestrates Python + TypeScript pipeline

  phase-0-infra/                  Infrastructure validation
    scripts/
      smoke-test-gpu.py           Verify GPU access, VRAM, CUDA version
      smoke-test-sft.py           1-step SFTTrainer on dummy data — validates stack
      smoke-test-inference.ts     Load pre-trained SmolLM2-135M via ONNX in Node.js
    results/
      infra-report.json           GPU specs, library versions, smoke test pass/fail

  phase-1-llm-monitor/            LLM-backed Monitor v2
    src/
      llm-monitor.ts              LLM-backed Monitor module (CognitiveModule impl)
      llm-monitor-prompt.ts       System prompt for LLM anomaly analysis
    __tests__/
      llm-monitor.test.ts         Unit tests with RecordingProvider
    scripts/
      collect-traces.ts           Run cognitive cycles, collect LLM Monitor traces
      measure-baseline.ts         Measure token cost + latency per Monitor invocation
    results/
      baseline-cost.json          Baseline: tokens/call, latency, cost/call
    traces/                       Collected trace records (JSONL)

  phase-2-dsl/                    DSL feasibility
    grammars/
      monitor-v2.peg              Monitor v2 DSL grammar (PEG format)
    corpus/
      monitor-v2/                 Generated (input, DSL-output) training pairs
    scripts/
      design-dsl.py               LLM-driven DSL grammar design
      generate-corpus.py          Synthetic data generation from real traces
      validate-corpus.py          Parse validity + semantic accuracy checks
      augment-corpus.py           Adversarial augmentation
    results/
      dsl-eval.json               Parse validity, semantic accuracy, revision count

  phase-3-training/               SLM training
    configs/
      monitor-smollm2-135m.yaml   Training config (SmolLM2-135M full fine-tune)
      monitor-smollm2-360m.yaml   Fallback config (SmolLM2-360M LoRA)
    scripts/
      train.py                    SFTTrainer-based fine-tuning
      evaluate.py                 Accuracy, calibration (ECE), latency
      calibrate.py                Temperature scaling post-training
      export-onnx.py              Export trained model to ONNX format
    models/                       Checkpoints (gitignored)
    results/
      training-eval.json          Parse accuracy, semantic accuracy, ECE, latency

  phase-4-integration/            Cognitive cycle integration
    src/
      slm-provider-adapter.ts     SLMProviderAdapter (decorator over ProviderAdapter)
      slm-inference.ts            ONNX Runtime local inference wrapper
      monitor-v2-dsl-parser.ts    peggy-generated parser for Monitor v2 DSL
    __tests__/
      slm-provider-adapter.test.ts
    scripts/
      run-benchmark.ts            Cognitive cycle with SLM Monitor vs LLM Monitor
      compare-baseline.ts         Cost reduction, success rate, escalation analysis
    results/
      integration-eval.json       Task success, cost reduction, escalation correlation

  shared/
    dsl-parser/                   Shared peggy parser utilities
    metrics/                      Python: ECE, accuracy. TypeScript: cost comparison
    fixtures/                     Workspace snapshots, mock signals for testing
```

### LLM-Backed Monitor v2

The current Monitor (`packages/pacta/src/cognitive/modules/monitor.ts`) is ~200 lines of
threshold logic. The experiment builds a Monitor v2 that uses `ProviderAdapter` for richer
anomaly analysis:

```typescript
// LLM Monitor v2 — uses ProviderAdapter for anomaly analysis
// Input: AggregatedSignals (same as current Monitor)
// Output: MonitorReport (same as current Monitor)
// Difference: LLM reasons about signal patterns instead of threshold checks

const LLM_MONITOR_V2: CognitiveModule<
  AggregatedSignals,    // same input
  MonitorReport,        // same output
  LlmMonitorState,     // tracks LLM invocation state
  MonitorMonitoring,    // same monitoring signal
  NoControl             // same no-op control
> = {
  id: moduleId('llm-monitor-v2'),
  async step(input, state, control) {
    // Build prompt from aggregated signals
    const prompt = buildMonitorPrompt(input);

    // Call LLM via ProviderAdapter — THIS IS THE COST TO REDUCE
    const result = await providerAdapter.invoke(workspace.snapshot(), {
      pactTemplate: { mode: { type: 'oneshot' } },
      systemPrompt: MONITOR_SYSTEM_PROMPT,
    });

    // Parse LLM's structured response into MonitorReport
    const report = parseMonitorResponse(result.output);
    return { output: report, state: nextState, monitoring: { ... } };
  }
};
```

This module has real LLM cost per invocation — the cost the SLM compilation will reduce.

### SLMProviderAdapter — Decorator Pattern

The SLM adapter wraps a fallback `ProviderAdapter` (frontier LLM). On success, it returns
the SLM's output. On low confidence or parse failure, it invokes the fallback. This is
transparent to the calling module.

```typescript
function createSLMProviderAdapter(
  slm: SLMInference,
  grammar: DSLGrammar,
  fallback: ProviderAdapter,     // frontier LLM as fallback
  escalationThreshold: number,
): ProviderAdapter {
  return {
    async invoke(snapshot, config): Promise<ProviderAdapterResult> {
      const encoded = grammar.encodeInput(snapshot);
      const result = slm.generate(encoded);
      const parsed = grammar.parse(result.tokens);

      // Line 1: DSL parse failure → escalate to fallback LLM
      if (!parsed.success) {
        return fallback.invoke(snapshot, config);
      }

      // Line 2: Low calibrated confidence → escalate to fallback LLM
      if (result.confidence < escalationThreshold) {
        return fallback.invoke(snapshot, config);
      }

      // SLM output accepted — return with local inference metrics
      return {
        output: grammar.decodeOutput(parsed.value),
        usage: {
          inputTokens: result.inputTokenCount,
          outputTokens: result.outputTokenCount,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: result.inputTokenCount + result.outputTokenCount,
        },
        cost: {
          totalUsd: 0, // local inference — zero API cost
          perModel: {
            [`slm:${slm.modelId}`]: {
              tokens: { inputTokens: result.inputTokenCount, outputTokens: result.outputTokenCount,
                        cacheReadTokens: 0, cacheWriteTokens: 0,
                        totalTokens: result.inputTokenCount + result.outputTokenCount },
              costUsd: 0,
            },
          },
        },
      };
    },
  };
}
```

**Key design decisions:**
- **Decorator pattern** resolves the escalation path problem (F-A-9) — SLM adapter holds
  a reference to the fallback LLM adapter, no architectural changes needed
- **TokenUsage** populated honestly — SLM tokenizer output length for input/output tokens,
  `costUsd: 0` for local inference (F-A-3)
- **Model key** uses `slm:` prefix to distinguish from API model names in cost reports

### Model Lifecycle

The `SLMInference` wrapper manages model lifecycle:

```typescript
interface SLMInference {
  readonly modelId: string;
  init(): Promise<void>;         // Load model into memory/GPU, warm up
  generate(input: string): SLMResult;
  dispose(): Promise<void>;      // Free model memory
}
```

- **Loading:** Model loaded during `init()`, called by the composition root at startup
- **Warm-up:** First 10 invocations discarded from latency measurements (F-A-6)
- **Memory:** 135M params FP16 = ~270MB VRAM. Three models at FP16 = ~810MB. Well within 11GB.
- **Concurrency:** ONNX sessions are thread-safe. Concurrent `invoke()` calls are safe.
- **Disposal:** `dispose()` called at process shutdown

### Hardware

- **Training:** GPU 1 (RTX 2080 Ti, 11GB VRAM, CUDA version per `nvidia-smi`)
- **Inference:** Same GPU, or CPU for <100M param models
- **No cloud dependencies.** All training and inference runs locally.
- **GPU 0** is the display GPU — training uses `CUDA_VISIBLE_DEVICES=1`

> **Note:** `nvidia-smi` reports CUDA 13.2. RTX 2080 Ti has compute capability 7.5
> (Turing architecture). BF16 is NOT natively supported — use FP16 for training.
> Verify `nvcc --version` matches the CUDA reported by the driver.

### Training Stack

| Component | Tool | Purpose |
|-----------|------|---------|
| Base models | SmolLM2-135M, SmolLM2-360M, Qwen2.5-0.5B | Pretrained small LMs |
| Fine-tuning | HuggingFace `trl` SFTTrainer | Supervised fine-tuning on DSL corpus |
| Parameter efficiency | `peft` (LoRA/QLoRA) | Fit larger models in 11GB VRAM |
| Model export | `optimum` → ONNX | TypeScript-accessible inference |
| DSL parsing | peggy (TypeScript) | PEG grammar definition → generated parser |
| Calibration | Temperature scaling (custom) | Post-training confidence calibration |

### TypeScript Integration

Experiment TypeScript code accesses `@method/pacta` types via **project references**
(`tsconfig.json` with `"references": [{ "path": "../../packages/pacta" }]`). This provides
type checking without adding the experiment to the npm workspace.

**Inference runtime:** ONNX Runtime for Node.js (`onnxruntime-node`). Validated in Phase 0
before any training begins. Fallback: HTTP bridge to Python inference server if native
bindings fail on this platform (Windows + Node16 + ESM).

### Python ↔ TypeScript Communication

- Phase 0-3 (Python-heavy): Python scripts read/write JSON to `results/` and `corpus/`
- Phase 4 (TypeScript-heavy): TypeScript reads trained ONNX model directly
- Cross-language boundary: JSON files on disk (no subprocess piping, no HTTP during training)
- `Makefile` orchestrates the pipeline: `make phase-0`, `make phase-1`, etc.

## Alternatives Considered

### Alternative 1: Target existing LLM-backed modules (ConflictResolver, ReflectorV2)

**Approach:** Skip building a new LLM Monitor. Compile ConflictResolver or ReflectorV2
directly — they already use ProviderAdapter.

**Pros:** No new module to build. Tests real existing cost.

**Cons:** ConflictResolver has complex adversarial reasoning output that resists DSL encoding.
ReflectorV2 produces free-text FactCards. Neither is a clean DSL target. RFC 002 ranks both
as "moderate candidates" — starting with a moderate candidate when the thesis is unproven
risks conflating "SLMs can't do this" with "this module was too hard."

**Why rejected:** Starting with the easiest possible compilation target maximizes the chance
of proving the thesis. Building an LLM Monitor with structured output is more work upfront
but produces a cleaner experiment.

### Alternative 2: DSL learnability only (no cost reduction claim)

**Approach:** Validate only whether SLMs can learn typed DSLs from synthetic data.
Module-agnostic. No integration, no cost measurement.

**Pros:** Cheapest experiment. Answers the foundational question.

**Cons:** Doesn't test the integration path, cost reduction, or escalation mechanism. Leaves
the hardest parts of the RFC unvalidated. A positive result ("SLMs can learn DSLs") is
necessary but not sufficient.

**Why rejected:** The full pipeline test is worth the additional investment. If only DSL
learnability is validated, we still don't know whether the integration works.

### Alternative 3: Skip validation, build production SLM infrastructure

**Approach:** Jump to production implementation without experiments.

**Pros:** Faster if it works.

**Cons:** If it doesn't, weeks wasted on training pipeline, model serving, DSL tooling that
gets thrown away. RFC 002 explicitly has abandonment criteria for this reason.

**Why rejected:** Validation de-risks production investment.

## Scope

### In-Scope

- LLM-backed Monitor v2 module implementation (new CognitiveModule)
- Baseline cost measurement (tokens, latency, USD per invocation)
- DSL grammar design (LLM-assisted) for Monitor v2 output
- Synthetic corpus generation (5K-50K pairs)
- SLM training on local GPU (SmolLM2/Qwen2.5 base models)
- ONNX export and Node.js inference integration
- SLMProviderAdapter with decorator-pattern escalation
- Cognitive cycle benchmark (SLM Monitor vs LLM Monitor)
- Cost reduction and escalation correlation measurement
- Python ML environment setup and validation
- Experiment documentation and reproducibility

### Out-of-Scope

- Production SLM deployment infrastructure
- Automated retraining pipelines
- Observer v2 or Evaluator v2 (deferred to follow-up if Monitor validates)
- Reasoner compilation (RFC ranks as poor candidate)
- Cloud GPU training
- Model serving infrastructure (beyond local ONNX inference)
- Integration with Meta-Composer routing (deferred to production PRD)
- Multi-task transfer experiments

### Non-Goals

- Replace frontier LLMs for all modules — the thesis is selective compilation
- Achieve production-grade LLM Monitor v2 — it exists only as a compilation target
- Build a general-purpose SLM training framework — this is experiment-specific code

## Implementation Phases

### Phase 0: Infrastructure Setup (Week 1)

**Goal:** Validate that the ML training stack and inference runtime work on this hardware
before committing to weeks of experiment work.

**Deliverables:**

Files:
- `experiments/exp-slm/pyproject.toml` — new — Python dependencies
- `experiments/exp-slm/package.json` — new — TypeScript dependencies
- `experiments/exp-slm/tsconfig.json` — new — project references to pacta
- `experiments/exp-slm/Makefile` — new — pipeline orchestration
- `experiments/exp-slm/.gitignore` — new — ignore models/, *.onnx, *.gguf
- `experiments/exp-slm/phase-0-infra/scripts/smoke-test-gpu.py` — new
- `experiments/exp-slm/phase-0-infra/scripts/smoke-test-sft.py` — new
- `experiments/exp-slm/phase-0-infra/scripts/smoke-test-inference.ts` — new
- `experiments/exp-slm/phase-0-infra/results/infra-report.json` — new

Tests (smoke tests):
1. `smoke-test-gpu.py`: GPU detected, ≥10GB free VRAM, CUDA functional
2. `smoke-test-sft.py`: SFTTrainer runs 1 training step on SmolLM2-135M with dummy data
3. `smoke-test-inference.ts`: SmolLM2-135M loaded into ONNX Runtime from Node.js, produces output

**Checkpoint:** All 3 smoke tests pass. Infrastructure report documents actual GPU specs.

---

### >>> PRE-GATE 0 — Infrastructure Viability

**Cost:** ~1 day.

**Pass:** All 3 smoke tests pass.

**Fail:** If GPU smoke test fails → verify CUDA drivers. If SFT smoke test fails → check
VRAM, try CPU training with tiny model. If ONNX inference fails → try `node-llama-cpp` with
GGUF format. If both native runtimes fail → validate HTTP bridge (Python FastAPI serving
ONNX, TypeScript calls HTTP). If HTTP bridge works, adjust latency gate from 50ms to 100ms.

---

### Phase 1: LLM-Backed Monitor v2 (Week 1-2)

**Goal:** Build an LLM-backed Monitor that uses ProviderAdapter for anomaly analysis.
Measure its cost as the baseline the SLM will optimize.

**Deliverables:**

Files:
- `experiments/exp-slm/phase-1-llm-monitor/src/llm-monitor.ts` — new — LLM Monitor module
- `experiments/exp-slm/phase-1-llm-monitor/src/llm-monitor-prompt.ts` — new — system prompt
- `experiments/exp-slm/phase-1-llm-monitor/\_\_tests\_\_/llm-monitor.test.ts` — new — 5 scenarios
- `experiments/exp-slm/phase-1-llm-monitor/scripts/collect-traces.ts` — new — trace collection
- `experiments/exp-slm/phase-1-llm-monitor/scripts/measure-baseline.ts` — new — cost measurement
- `experiments/exp-slm/phase-1-llm-monitor/results/baseline-cost.json` — new
- `experiments/exp-slm/phase-1-llm-monitor/traces/*.jsonl` — new — collected traces

Tests:
1. LLM Monitor produces valid MonitorReport for normal signals (no anomalies)
2. LLM Monitor detects low-confidence anomaly
3. LLM Monitor detects compound anomaly (multiple signals)
4. LLM Monitor produces structured output parseable to MonitorReport type
5. Baseline cost measured: tokens/invocation, latency, USD/invocation

**Dependencies:** Phase 0 infrastructure validated.

**Checkpoint:** LLM Monitor passes all 5 tests. Baseline cost documented. ≥100 traces collected.

---

### >>> GATE 1 — LLM Monitor Baseline

**Cost:** ~1 day to evaluate.

**Measure:** LLM Monitor v2 produces valid MonitorReport, cost is measurable and non-trivial.

**Pass:** Monitor invocations cost ≥50 tokens each AND produce semantically valid reports
on ≥90% of test inputs.

**Fail:** If the LLM Monitor costs <50 tokens (too cheap to optimize), the cost reduction
thesis has no room. Investigate whether a richer prompt increases cost meaningfully.

---

### Phase 2: DSL Design + Corpus Generation (Week 2-3)

**Goal:** Design a DSL for Monitor v2's output, generate a training corpus from real traces,
and validate.

**Quick sanity check (1 hour, before full DSL design):** Have the frontier LLM generate
10 sample Monitor v2 DSL outputs. Manually check if the concept is viable before committing
to grammar iteration.

**Deliverables:**

Files:
- `experiments/exp-slm/phase-2-dsl/grammars/monitor-v2.peggy` — new — DSL grammar (peggy PEG format)
- `experiments/exp-slm/phase-2-dsl/scripts/design-dsl.py` — new — LLM-driven grammar design
- `experiments/exp-slm/phase-2-dsl/scripts/type-mapping.ts` — new — formal mapping: MonitorReport TypeScript type ↔ DSL grammar (grounded in actual types, not RFC sketches)
- `experiments/exp-slm/phase-2-dsl/scripts/generate-corpus.py` — new — corpus generation
- `experiments/exp-slm/phase-2-dsl/scripts/validate-corpus.py` — new — validation harness
- `experiments/exp-slm/phase-2-dsl/scripts/augment-corpus.py` — new — adversarial augmentation
- `experiments/exp-slm/phase-2-dsl/corpus/monitor-v2/` — new — 500+ pairs (pre-augmentation)
- `experiments/exp-slm/shared/dsl-parser/monitor-v2-parser.ts` — new — peggy-generated parser

Tests:
1. All corpus entries parse successfully (100% parse validity)
2. Automated semantic checker validates decoded DSL against MonitorReport type (≥95% pass)
3. Manual spot-check of 30 random samples confirms semantic correctness (≥90%)
4. Round-trip fidelity: encode → decode → re-encode produces identical output
5. Augmented corpus (5K-10K pairs) maintains ≥95% parse validity

> **Note (F-I-2):** DSL grammar MUST be grounded in the actual MonitorReport TypeScript type
> from `monitor.ts` — not the RFC 002 sketches, which diverge from the implementation
> (e.g., RFC uses `severity: number` but actual type uses discriminated union `type:
> 'low-confidence' | 'unexpected-result' | 'compound'`). The `type-mapping.ts` deliverable
> enforces this alignment.

**Dependencies:** Phase 1 traces (real LLM Monitor outputs for seeding DSL design).

**Checkpoint:** Grammar parses 100% of corpus. Semantic validity ≥90%.

---

### >>> GATE 2 — DSL Feasibility

**Cost:** ~2 hours to assess after corpus validation.

**Pass:** Grammar achieves parse 100% + semantics ≥90% in ≤3 revision iterations.

**Fail:** After 3 grammar revisions, targets not met → attempt hand-designed grammar. If
hand-designed grammar also fails → the DSL-as-curriculum thesis is unsupported for this
module's output type. Report findings, update RFC 002.

---

### Phase 3: SLM Training + Evaluation (Week 3-5)

**Goal:** Train a small model on the Monitor v2 DSL corpus. Measure accuracy, calibration,
and latency.

**Quick sanity check (30 min, before full training):** Train SmolLM2-135M for 100 steps.
Can it produce ANY valid DSL output? If not, investigate before committing to days of training.

**Deliverables:**

Files:
- `experiments/exp-slm/phase-3-training/configs/monitor-smollm2-135m.yaml` — new
- `experiments/exp-slm/phase-3-training/scripts/train.py` — new — SFTTrainer fine-tuning
- `experiments/exp-slm/phase-3-training/scripts/evaluate.py` — new — accuracy + ECE
- `experiments/exp-slm/phase-3-training/scripts/calibrate.py` — new — temperature scaling
- `experiments/exp-slm/phase-3-training/scripts/export-onnx.py` — new — ONNX export
- `experiments/exp-slm/phase-3-training/results/training-eval.json` — new
- `experiments/exp-slm/shared/metrics/calibration.py` — new — ECE computation
- `experiments/exp-slm/shared/metrics/accuracy.py` — new — parse + semantic accuracy

Tests:
1. DSL parse accuracy ≥95% on holdout set (20%)
2. Semantic accuracy ≥85% on holdout set
3. Adversarial accuracy ≥70% on boundary cases
4. ECE ≤0.15 after temperature scaling
5. Inference latency ≤50ms (post-warm-up, GPU 1) — or ≤100ms if HTTP bridge
6. ONNX export accuracy within 2% of PyTorch accuracy

**Confidence extraction:** Single confidence score per DSL output is computed as the
**length-normalized sequence log-probability**: `conf = exp(sum(log_probs) / num_tokens)`.
This is the standard approach for sequence-level confidence from autoregressive models.
Temperature scaling learns a single scalar T on a held-out calibration set (10% of corpus,
separate from holdout) that rescales logits to minimize NLL. ECE is computed with 10
equal-width bins over the calibrated confidence scores.

Configuration:
- `CUDA_VISIBLE_DEVICES=1` — train on GPU 1 only
- `SLM_BASE_MODEL=HuggingFaceTB/SmolLM2-135M` (default)
- Training in FP16 (no BF16 — RTX 2080 Ti compute capability 7.5)

**Dependencies:** Phase 2 validated corpus (5K-10K pairs).

**Checkpoint:** All 6 tests pass. Model checkpoint + ONNX export saved.

---

### >>> GATE 3 — Single Module Compilation

**Cost:** ~2 hours to evaluate after training.

**Pass:** Parse ≥95%, semantic ≥85%, ECE ≤0.15, latency ≤50ms, ONNX accuracy within 2%.

**Fail — escalation path:**
1. Try SmolLM2-360M with LoRA (larger model, may need both GPUs)
2. Try Qwen2.5-0.5B with QLoRA
3. If all 3 base models fail all gate criteria → SLM compilation doesn't work at this
   parameter scale. Report findings, update RFC 002 model size assumptions.

---

### Phase 4: Cognitive Cycle Integration (Week 5-7)

**Goal:** Plug the SLM-backed Monitor v2 into a real cognitive cycle. Measure cost reduction
versus the LLM-backed Monitor v2 baseline.

**Deliverables:**

Files:
- `experiments/exp-slm/phase-4-integration/src/slm-provider-adapter.ts` — new
- `experiments/exp-slm/phase-4-integration/src/slm-inference.ts` — new — ONNX wrapper
- `experiments/exp-slm/phase-4-integration/src/monitor-v2-dsl-parser.ts` — new (import shared)
- `experiments/exp-slm/phase-4-integration/\_\_tests\_\_/slm-provider-adapter.test.ts` — new
- `experiments/exp-slm/phase-4-integration/scripts/run-benchmark.ts` — new
- `experiments/exp-slm/phase-4-integration/scripts/compare-baseline.ts` — new
- `experiments/exp-slm/phase-4-integration/results/integration-eval.json` — new

Benchmark tasks (designed for Monitor, not generic code-editing):
- 5 routine tasks: clear signal patterns where Monitor should NOT escalate
- 5 novel tasks: ambiguous signals where Monitor SHOULD escalate or analyze carefully
- Task difficulty defined operationally: `difficulty = 1 - LLM_baseline_success_rate`
  (computed from Phase 1 LLM Monitor runs, making the Spearman correlation objective)

Tests:
1. Task success rate ≥ LLM Monitor baseline - 5%
2. Token cost reduction ≥30% on routine tasks (SLM handles most, fallback rare)
3. Escalation rate correlates with task difficulty (Spearman ρ ≥0.6)
4. Zero catastrophic failures (no task where SLM Monitor performs worse than random)
5. SLM ProviderAdapter type-checks against ProviderAdapter interface (`tsc --noEmit`)

**Dependencies:** Phase 3 trained + exported model. Phase 1 baseline cost measurement.

**Checkpoint:** All 5 tests pass. Cost reduction documented.

---

### >>> GATE 4 — Cycle Integration

**Cost:** ~1 day to run full benchmark.

**Pass:** All 5 Phase 4 tests pass.

**Fail:** Task success drops >10% vs LLM baseline → investigate escalation threshold. Try
more conservative threshold (higher escalation rate). If still failing → the SLM Monitor
is producing systematically misleading outputs. Investigate whether DSL design or training
data is the root cause before abandoning.

**If pass — next steps:**
- Design follow-up PRD for Observer v2 + Evaluator v2 (next compilation targets)
- Update RFC 002 Implementation Status with empirical results
- Consider production SLM infrastructure PRD

**If fail (after investigation):** Archive experiment code. Update RFC 002 with negative
results and lessons learned. Investigate alternative compilation mechanisms.

---

## Success Criteria

### Functional

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| LLM Monitor v2 produces valid reports | ≥90% valid on test inputs | Automated type check |
| Baseline cost measurable | ≥50 tokens per Monitor invocation | Token counter in traces |
| DSL parse validity | 100% on generated corpus | Parser acceptance rate |
| DSL semantic accuracy | ≥95% automated type check + ≥90% manual spot-check | Automated checker + 30-sample manual review |
| SLM parse accuracy | ≥95% on holdout | Automated eval |
| SLM semantic accuracy | ≥85% on holdout | Automated eval |
| SLM adversarial accuracy | ≥70% on boundary cases | Automated eval on augmented set |
| Confidence calibration | ECE ≤0.15 | Temperature-scaled ECE |
| Inference latency | ≤50ms (GPU) or ≤100ms (HTTP bridge) | Wall-clock post-warm-up |
| ONNX export fidelity | Within 2% of PyTorch accuracy | Side-by-side eval |
| Task success preservation | ≥ LLM baseline - 5% | Benchmark pass rate |
| Cost reduction | ≥30% on routine tasks | Token count comparison |
| Escalation correlation | Spearman ρ ≥0.6 | Rank correlation |

### Non-Functional

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Training fits on GPU 1 | ≤11GB peak VRAM | nvidia-smi during training |
| Reproducibility | Same results ±2% on re-run | Seeded random, fixed splits |
| Experiment isolation | Zero changes to existing package code | git diff of packages/ |

### Architecture

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| ProviderAdapter contract preserved | SLM adapter type-checks | tsc --noEmit |
| Decorator pattern | Escalation uses fallback adapter, not separate path | Code review |
| No existing module changes | Zero modifications to existing cognitive modules | git diff |

## Acceptance Criteria

### AC-01: Infrastructure smoke tests pass

**Given** a fresh Python venv and Node.js environment on the target machine
**When** all 3 smoke tests are executed
**Then** GPU is detected with ≥10GB free VRAM, SFTTrainer runs 1 step, ONNX inference produces output

**Test location:** `experiments/exp-slm/phase-0-infra/scripts/`
**Automatable:** yes

### AC-02: LLM Monitor v2 produces valid MonitorReport

**Given** an LLM-backed Monitor v2 with ProviderAdapter wired to a frontier LLM
**When** it receives AggregatedSignals with a low-confidence anomaly
**Then** it produces a MonitorReport with the anomaly detected, escalation recommended

**Test location:** `experiments/exp-slm/phase-1-llm-monitor/__tests__/llm-monitor.test.ts`
**Automatable:** yes

### AC-03: Baseline cost is non-trivial

**Given** the LLM Monitor v2 running on 100+ cognitive cycle inputs
**When** token usage is measured per invocation
**Then** mean cost ≥50 tokens/invocation, establishing a meaningful baseline to reduce

**Test location:** `experiments/exp-slm/phase-1-llm-monitor/scripts/measure-baseline.ts`
**Automatable:** yes

### AC-04: DSL grammar parses all generated training pairs

**Given** a Monitor v2 DSL grammar designed by a frontier LLM
**When** applied to all 500+ generated (input, output) pairs
**Then** 100% parse successfully

**Test location:** `experiments/exp-slm/phase-2-dsl/scripts/validate-corpus.py`
**Automatable:** yes

### AC-05: DSL corpus is semantically valid

**Given** the parsed corpus from AC-04
**When** automated semantic checker validates decoded DSL output against MonitorReport type
**Then** ≥95% pass automated type validation
**And** manual spot-check of 30 random samples confirms ≥90% semantic correctness

**Test location:** `experiments/exp-slm/phase-2-dsl/scripts/validate-corpus.py`
**Automatable:** mostly (automated type checker primary, 30-sample manual spot-check secondary)

### AC-06: SLM achieves parse accuracy threshold

**Given** a trained Monitor SLM (≤135M params)
**When** generating output for 1000+ holdout inputs
**Then** ≥95% parse as valid Monitor v2 DSL

**Test location:** `experiments/exp-slm/phase-3-training/scripts/evaluate.py`
**Automatable:** yes

### AC-07: SLM confidence is well-calibrated

**Given** a trained SLM with temperature scaling applied
**When** ECE is computed on holdout set (10 bins)
**Then** ECE ≤0.15

**Test location:** `experiments/exp-slm/phase-3-training/scripts/evaluate.py`
**Automatable:** yes

### AC-08: ONNX export preserves accuracy

**Given** a trained SLM in PyTorch and its ONNX export
**When** both are evaluated on the same holdout set
**Then** accuracy difference ≤2%

**Test location:** `experiments/exp-slm/phase-3-training/scripts/evaluate.py`
**Automatable:** yes

### AC-09: SLMProviderAdapter type-checks

**Given** the SLMProviderAdapter implementation
**When** type-checked against the ProviderAdapter interface
**Then** `tsc --noEmit` passes

**Test location:** `experiments/exp-slm/phase-4-integration/` TypeScript compilation
**Automatable:** yes

### AC-10: Task success preserved with SLM Monitor

**Given** a cognitive cycle with SLM-backed Monitor v2 (decorator over LLM fallback)
**When** the benchmark task battery is run (10 tasks: 5 routine + 5 novel)
**Then** pass rate ≥ LLM Monitor baseline - 5%

**Test location:** `experiments/exp-slm/phase-4-integration/scripts/run-benchmark.ts`
**Automatable:** yes

### AC-11: Cost reduction on routine tasks

**Given** the SLM Monitor handling routine tasks (low escalation rate)
**When** total tokens consumed are compared to all-LLM baseline
**Then** reduction ≥30%

**Test location:** `experiments/exp-slm/phase-4-integration/scripts/compare-baseline.ts`
**Automatable:** yes

### AC-12: Escalation correlates with task difficulty

**Given** SLM Monitor escalation rates across 10 tasks ranked by difficulty
**When** Spearman rank correlation is computed (difficulty = 1 - LLM baseline success rate)
**Then** ρ ≥0.6

**Test location:** `experiments/exp-slm/phase-4-integration/scripts/run-benchmark.ts`
**Automatable:** yes

## Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| LLM Monitor v2 output too unstructured for DSL encoding | Critical | Medium | Phase 2 blocked — can't design grammar for free-text output | Constrain LLM Monitor prompt to produce structured JSON-like output. Design prompt and DSL grammar in tandem. |
| SLM calibration too poor for reliable escalation | Critical | Medium | False confidence → bad Monitor signals propagate | Three defense lines (DSL parse check, temperature scaling, ensemble). Start with conservative thresholds. |
| ONNX Runtime native bindings fail on Windows + Node16 + ESM | High | Medium | Phase 4 integration blocked | Validated in Phase 0 smoke test. Fallback: HTTP bridge to Python (adjust latency gate to 100ms). |
| SmolLM2-135M too small for Monitor v2 DSL | High | Medium | Phase 3 fails accuracy gate | Escalation: 360M LoRA → Qwen2.5-0.5B QLoRA. Three base models before abandonment. |
| Synthetic training data inherits LLM bias | Medium | High | SLM performs well on holdout but fails on novel cycle inputs | Adversarial augmentation. Cross-validate against real Phase 1 traces. |
| Python ML environment setup takes longer than expected | Medium | Medium | Phase 0 absorbs 1+ weeks of infrastructure debugging | Smoke test catches this early. Makefile automates env setup. |
| LLM Monitor v2 too cheap (<50 tokens/call) | Medium | Low | Cost reduction thesis has no room to demonstrate savings | Enrich the prompt to produce detailed analysis. If still cheap, the module doesn't justify compilation — select a different target. |

## Dependencies & Cross-Domain Impact

### Dependencies

| Dependency | Type | Status | Impact if Missing |
|-----------|------|--------|-------------------|
| PRD 030 cognitive modules | Internal | Complete | No module contracts to build on — blocked |
| ProviderAdapter interface | Internal | Stable | Integration surface — if it changes, adapter changes |
| Python 3.11+ | External | Available | Training scripts won't run |
| CUDA drivers + RTX 2080 Ti | External | Available | No local training |
| HuggingFace model hub | External | Available | Pre-download and cache models |
| onnxruntime-node | External | npm package | Fallback to HTTP bridge |

### Cross-Domain Impact

| Domain | Change Type | Files Affected | Port Changes | Test Impact | Doc Impact |
|--------|------------|----------------|--------------|-------------|------------|
| experiments/exp-slm/ | New directory | ~30 new files | None | New test suites (Python + TS) | New README |
| pacta/cognitive/modules | Read-only reference | 0 | None | 0 | None |
| pacta/cognitive/algebra | Read-only reference | 0 (interface reused) | None | 0 | Update arch doc |
| pacta/cognitive/engine | Read-only reference | 0 | None | 0 | None |

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `experiments/exp-slm/README.md` | Create | Setup, reproducibility, results |
| `docs/arch/slm-compilation.md` | Create | SLM integration architecture (ProviderAdapter decorator, DSL parsing, escalation) |
| `docs/rfcs/002-small-language-models.md` | Update | Implementation Status with experiment results |
| `CLAUDE.md` | No change | Experiment directory is outside main architecture |

## Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | What base model — SmolLM2-135M or 360M? | Experiment | Phase 3 start (try 135M first) |
| OQ-2 | ONNX Runtime vs HTTP bridge? | Experiment | Phase 0 smoke test |
| OQ-3 | How rich should LLM Monitor v2's analysis be? | PO + Experiment | Phase 1 prompt design |
| OQ-4 | Validation vs calibration split strategy? | Experiment | Phase 3 training |

## Implementation Status

Phase 0 (Infrastructure): Not started
Phase 1 (LLM Monitor v2): Not started
Phase 2 (DSL + Corpus): Not started
Phase 3 (SLM Training): Not started
Phase 4 (Integration): Not started
