# Realization Plan — PRD 034: SLM Validation

## PRD Summary

**Objective:** 5-phase validation of RFC 002's SLM compilation thesis. Build an LLM-backed
Monitor v2, design a DSL for its output, train a small model, and measure cost reduction
in a real cognitive cycle.

**Phases:** 0 (Infra) → 1 (LLM Monitor v2) → 2 (DSL + Corpus) → 3 (SLM Training) → 4 (Integration)

**Acceptance criteria:** AC-01 through AC-12

**Key constraint:** Experiment is isolated in `experiments/exp-slm/`. Zero changes to existing
packages. Python (training) + TypeScript (integration) split.

## FCA Partition

| Commission | Domain | Phase | Title | Depends On | Wave |
|------------|--------|-------|-------|------------|------|
| C-1 | phase-0-infra | P0 | Infrastructure smoke tests | — | 1 |
| C-2 | phase-1-llm-monitor | P1 | LLM-backed Monitor v2 | C-1 | 2 |
| C-3 | phase-2-dsl | P2 | DSL grammar design + corpus generation | C-2 | 3 |
| C-4 | phase-3-training | P3 | SLM training + evaluation + ONNX export | C-3 | 4 |
| C-5 | shared/dsl-parser | P2 | DSL parser (TypeScript, peggy) | C-3 | 4 |
| C-6 | phase-4-integration | P4 | SLMProviderAdapter + cycle benchmark | C-4, C-5 | 5 |

## Waves

### Wave 0 — Shared Surface Preparation (Orchestrator)

Create the experiment root with all shared configuration:

```
experiments/exp-slm/
  pyproject.toml          Python deps: transformers, trl, peft, accelerate, torch
  package.json            TypeScript deps: peggy, onnxruntime-node
  tsconfig.json           Project references to ../../packages/pacta
  Makefile                Pipeline orchestration (make phase-0, make phase-1, etc.)
  .gitignore              Ignore: models/, *.onnx, *.gguf. Track: results/, grammars/, corpus/
  README.md               Experiment overview, setup, reproducibility
  shared/
    fixtures/             Empty — populated by C-2
    metrics/              Empty — populated by C-4
    dsl-parser/           Empty — populated by C-5
```

**Verification:** `npm install` in experiment dir succeeds. `tsc --noEmit` passes.
Python venv creates successfully (`python -m venv .venv && pip install -e .`).

---

### Wave 1 — Infrastructure Validation

#### C-1: Infrastructure Smoke Tests

Validates GPU, Python ML stack, and Node.js inference runtime before any experiment commitment.

---

### Wave 2 — LLM Monitor Baseline

#### C-2: LLM-Backed Monitor v2

Builds the compilation target — an LLM Monitor that actually calls ProviderAdapter.
Collects traces and measures baseline cost.

---

### Wave 3 — DSL Design

#### C-3: DSL Grammar + Corpus Generation

LLM-assisted DSL design grounded in actual MonitorReport types. Generates and validates
training corpus from real LLM Monitor traces.

---

### Wave 4 — Training + Parser (PARALLEL)

#### C-4: SLM Training + Evaluation (Python)
#### C-5: DSL Parser (TypeScript, peggy)

**These execute in parallel.** C-4 trains the SLM on the corpus (Python, GPU-bound). C-5
builds the TypeScript parser from the grammar (TypeScript, no GPU). Both depend on C-3's
grammar and corpus output. Neither touches the other's files.

---

### Wave 5 — Integration

#### C-6: SLMProviderAdapter + Cycle Benchmark

Wires the trained ONNX model + parser into a ProviderAdapter decorator. Runs the 10-task
benchmark against the LLM Monitor v2 baseline.

---

## Commission Cards

### C-1: Infrastructure Smoke Tests

```yaml
id: C-1
phase: P0
title: "Infrastructure smoke tests — GPU, SFTTrainer, ONNX Runtime"
domain: phase-0-infra
wave: 1
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-0-infra/**"
  forbidden_paths:
    - "experiments/exp-slm/pyproject.toml"
    - "experiments/exp-slm/package.json"
    - "experiments/exp-slm/tsconfig.json"
    - "experiments/exp-slm/Makefile"
    - "experiments/exp-slm/.gitignore"
    - "experiments/exp-slm/shared/**"
    - "packages/**"
depends_on: []
parallel_with: []
deliverables:
  - "phase-0-infra/scripts/smoke-test-gpu.py"
  - "phase-0-infra/scripts/smoke-test-sft.py"
  - "phase-0-infra/scripts/smoke-test-inference.ts"
  - "phase-0-infra/results/infra-report.json"
documentation_deliverables: []
acceptance_criteria:
  - "GPU detected with ≥10GB free VRAM → PRD AC-01"
  - "SFTTrainer runs 1 training step on SmolLM2-135M → PRD AC-01"
  - "ONNX Runtime loads model and produces output from Node.js → PRD AC-01"
estimated_tasks: 4
branch: "feat/prd033-c1-infra-smoke"
status: pending
```

### C-2: LLM-Backed Monitor v2

```yaml
id: C-2
phase: P1
title: "LLM-backed Monitor v2 — build compilation target + collect baseline"
domain: phase-1-llm-monitor
wave: 2
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-1-llm-monitor/**"
    - "experiments/exp-slm/shared/fixtures/**"
  forbidden_paths:
    - "experiments/exp-slm/pyproject.toml"
    - "experiments/exp-slm/package.json"
    - "experiments/exp-slm/tsconfig.json"
    - "experiments/exp-slm/Makefile"
    - "experiments/exp-slm/shared/metrics/**"
    - "experiments/exp-slm/shared/dsl-parser/**"
    - "packages/**"
depends_on: [C-1]
parallel_with: []
deliverables:
  - "phase-1-llm-monitor/src/llm-monitor.ts"
  - "phase-1-llm-monitor/src/llm-monitor-prompt.ts"
  - "phase-1-llm-monitor/__tests__/llm-monitor.test.ts"
  - "phase-1-llm-monitor/scripts/collect-traces.ts"
  - "phase-1-llm-monitor/scripts/measure-baseline.ts"
  - "phase-1-llm-monitor/results/baseline-cost.json"
  - "phase-1-llm-monitor/traces/*.jsonl"
  - "shared/fixtures/ (workspace snapshots, mock signals)"
documentation_deliverables: []
acceptance_criteria:
  - "LLM Monitor produces valid MonitorReport → PRD AC-02"
  - "Baseline cost ≥50 tokens/invocation → PRD AC-03"
  - "≥100 traces collected for DSL seeding"
estimated_tasks: 6
branch: "feat/prd033-c2-llm-monitor"
status: pending
```

### C-3: DSL Grammar + Corpus Generation

```yaml
id: C-3
phase: P2
title: "DSL grammar design + corpus generation (Python)"
domain: phase-2-dsl
wave: 3
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-2-dsl/**"
  forbidden_paths:
    - "experiments/exp-slm/pyproject.toml"
    - "experiments/exp-slm/package.json"
    - "experiments/exp-slm/shared/**"
    - "packages/**"
depends_on: [C-2]
parallel_with: []
deliverables:
  - "phase-2-dsl/grammars/monitor-v2.peggy"
  - "phase-2-dsl/scripts/design-dsl.py"
  - "phase-2-dsl/scripts/generate-corpus.py"
  - "phase-2-dsl/scripts/validate-corpus.py"
  - "phase-2-dsl/scripts/augment-corpus.py"
  - "phase-2-dsl/scripts/type-mapping.ts"
  - "phase-2-dsl/corpus/monitor-v2/ (500+ pairs, then 5K-10K augmented)"
  - "phase-2-dsl/results/dsl-eval.json"
documentation_deliverables: []
acceptance_criteria:
  - "100% parse validity on corpus → PRD AC-04"
  - "≥95% automated type check + ≥90% manual spot-check → PRD AC-05"
  - "Round-trip fidelity: encode → decode → re-encode identical"
  - "DSL grounded in actual MonitorReport type, not RFC sketches"
estimated_tasks: 5
branch: "feat/prd033-c3-dsl-corpus"
status: pending
```

### C-4: SLM Training + Evaluation + ONNX Export

```yaml
id: C-4
phase: P3
title: "SLM training, evaluation, calibration, ONNX export (Python)"
domain: phase-3-training
wave: 4
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-3-training/**"
    - "experiments/exp-slm/shared/metrics/**"
  forbidden_paths:
    - "experiments/exp-slm/pyproject.toml"
    - "experiments/exp-slm/package.json"
    - "experiments/exp-slm/shared/dsl-parser/**"
    - "experiments/exp-slm/shared/fixtures/**"
    - "packages/**"
depends_on: [C-3]
parallel_with: [C-5]
deliverables:
  - "phase-3-training/configs/monitor-smollm2-135m.yaml"
  - "phase-3-training/scripts/train.py"
  - "phase-3-training/scripts/evaluate.py"
  - "phase-3-training/scripts/calibrate.py"
  - "phase-3-training/scripts/export-onnx.py"
  - "phase-3-training/results/training-eval.json"
  - "shared/metrics/calibration.py"
  - "shared/metrics/accuracy.py"
documentation_deliverables: []
acceptance_criteria:
  - "Parse accuracy ≥95% on holdout → PRD AC-06"
  - "ECE ≤0.15 after temperature scaling → PRD AC-07"
  - "ONNX export within 2% of PyTorch accuracy → PRD AC-08"
  - "Inference latency ≤50ms post-warm-up"
  - "Confidence = length-normalized seq log-prob + temperature scaling"
estimated_tasks: 6
branch: "feat/prd033-c4-slm-training"
status: pending
```

### C-5: DSL Parser (TypeScript, peggy)

```yaml
id: C-5
phase: P2
title: "TypeScript DSL parser from peggy grammar"
domain: shared/dsl-parser
wave: 4
scope:
  allowed_paths:
    - "experiments/exp-slm/shared/dsl-parser/**"
  forbidden_paths:
    - "experiments/exp-slm/pyproject.toml"
    - "experiments/exp-slm/package.json"
    - "experiments/exp-slm/shared/metrics/**"
    - "experiments/exp-slm/shared/fixtures/**"
    - "packages/**"
depends_on: [C-3]
parallel_with: [C-4]
deliverables:
  - "shared/dsl-parser/monitor-v2-parser.ts"
  - "shared/dsl-parser/index.ts"
  - "shared/dsl-parser/__tests__/monitor-v2-parser.test.ts"
documentation_deliverables: []
acceptance_criteria:
  - "Parser generated from monitor-v2.peggy grammar"
  - "Parses all corpus entries from C-3 output"
  - "Round-trip: DSL string → parse → TypeScript MonitorReport → encode → identical DSL string"
estimated_tasks: 3
branch: "feat/prd033-c5-dsl-parser"
status: pending
```

### C-6: SLMProviderAdapter + Cycle Benchmark

```yaml
id: C-6
phase: P4
title: "SLMProviderAdapter decorator + cognitive cycle benchmark"
domain: phase-4-integration
wave: 5
scope:
  allowed_paths:
    - "experiments/exp-slm/phase-4-integration/**"
  forbidden_paths:
    - "experiments/exp-slm/pyproject.toml"
    - "experiments/exp-slm/package.json"
    - "experiments/exp-slm/tsconfig.json"
    - "experiments/exp-slm/shared/**"
    - "packages/**"
depends_on: [C-4, C-5]
parallel_with: []
deliverables:
  - "phase-4-integration/src/slm-provider-adapter.ts"
  - "phase-4-integration/src/slm-inference.ts"
  - "phase-4-integration/src/monitor-v2-dsl-parser.ts (imports shared)"
  - "phase-4-integration/__tests__/slm-provider-adapter.test.ts"
  - "phase-4-integration/scripts/run-benchmark.ts"
  - "phase-4-integration/scripts/compare-baseline.ts"
  - "phase-4-integration/results/integration-eval.json"
documentation_deliverables:
  - "docs/arch/slm-compilation.md — Create — SLM integration architecture"
  - "docs/rfcs/002-small-language-models.md — Update — Implementation Status"
acceptance_criteria:
  - "SLMProviderAdapter type-checks against ProviderAdapter → PRD AC-09"
  - "Task success ≥ LLM baseline - 5% → PRD AC-10"
  - "Cost reduction ≥30% on routine tasks → PRD AC-11"
  - "Escalation correlation ρ ≥0.6 (difficulty = 1 - baseline success) → PRD AC-12"
  - "Zero catastrophic failures"
estimated_tasks: 7
branch: "feat/prd033-c6-integration"
status: pending
```

## Shared Surface Changes

| Wave | File | Change | Verification |
|------|------|--------|-------------|
| 0→1 | `experiments/exp-slm/pyproject.toml` | Create — Python deps (transformers, trl, peft, accelerate, torch) | `pip install -e .` succeeds |
| 0→1 | `experiments/exp-slm/package.json` | Create — TS deps (peggy, onnxruntime-node) | `npm install` succeeds |
| 0→1 | `experiments/exp-slm/tsconfig.json` | Create — project refs to `../../packages/pacta` | `tsc --noEmit` passes |
| 0→1 | `experiments/exp-slm/Makefile` | Create — `make phase-{0..4}`, `make setup` | `make --dry-run` succeeds |
| 0→1 | `experiments/exp-slm/.gitignore` | Create — ignore models/, *.onnx, *.gguf | File exists |
| 0→1 | `experiments/exp-slm/README.md` | Create — setup + reproducibility | File exists |
| 0→1 | `experiments/exp-slm/shared/` | Create empty subdirs: fixtures/, metrics/, dsl-parser/ | Dirs exist |
| 3→4 | `phase-2-dsl/grammars/monitor-v2.peggy` | C-3 output → C-5 input (grammar file) | Orchestrator verifies file exists before Wave 4 |
| 3→4 | `phase-2-dsl/corpus/monitor-v2/` | C-3 output → C-4 input (training data) | Orchestrator verifies corpus size ≥5000 before Wave 4 |
| 4→5 | `phase-3-training/models/*.onnx` | C-4 output → C-6 input (trained model) | Orchestrator verifies ONNX file exists before Wave 5 |
| 4→5 | `shared/dsl-parser/` | C-5 output → C-6 input (parser) | Orchestrator verifies parser compiles before Wave 5 |

## Acceptance Gates

| PRD AC | Commission | Gate |
|--------|------------|------|
| AC-01 (Infra smoke tests) | C-1 | Pre-Gate 0 |
| AC-02 (LLM Monitor valid report) | C-2 | Gate 1 |
| AC-03 (Baseline cost ≥50 tokens) | C-2 | Gate 1 |
| AC-04 (DSL 100% parse) | C-3 | Gate 2 |
| AC-05 (DSL semantic validity) | C-3 | Gate 2 |
| AC-06 (SLM parse ≥95%) | C-4 | Gate 3 |
| AC-07 (ECE ≤0.15) | C-4 | Gate 3 |
| AC-08 (ONNX within 2%) | C-4 | Gate 3 |
| AC-09 (ProviderAdapter type-check) | C-6 | Gate 4 |
| AC-10 (Task success ≥ baseline-5%) | C-6 | Gate 4 |
| AC-11 (Cost ≥30% reduction) | C-6 | Gate 4 |
| AC-12 (Escalation ρ ≥0.6) | C-6 | Gate 4 |

## Verification Report

| Gate | Status | Details |
|------|--------|---------|
| Single-domain | PASS | Every commission touches exactly one experiment sub-domain |
| No wave conflicts | PASS | Wave 4 has C-4 (Python) + C-5 (TypeScript) — disjoint domains |
| DAG acyclic | PASS | Linear pipeline with one parallel fork at Wave 4 |
| Surfaces enumerated | PASS | 11 surface changes cataloged |
| Scope complete | PASS | Every commission has explicit allowed + forbidden paths |
| Criteria traceable | PASS | All 12 PRD ACs mapped to commissions |
| PRD coverage | PASS | Every PRD AC has at least one commission |
| Task bounds | PASS | All commissions in 3-8 range (3, 6, 5, 6, 3, 7) |

Overall: 8/8 gates pass

## Risk Profile

- **Critical path length:** 5 waves (linear experiment pipeline)
- **Parallel breadth:** Wave 4 only (C-4 ∥ C-5)
- **Surface changes:** 11 (all simple — config files + artifact handoffs)
- **New port count:** 0 (reuses existing ProviderAdapter)
- **Language boundary crossings:** 2 (Wave 3→4 grammar handoff, Wave 4→5 model handoff)
- **Primary risk:** GPU training time (C-4) is the bottleneck — 2-4 weeks depending on model size escalation

## Status Tracker

Total: 6 commissions, 5 waves (+ Wave 0 orchestrator prep)
Completed: 0 / 6
Parallel opportunity: Wave 4 (C-4 ∥ C-5)
