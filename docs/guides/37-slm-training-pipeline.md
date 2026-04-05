# Guide 37: SLM Training Pipeline

How to create, train, and deploy a compiled SLM using the bootstrap flywheel.

## Why SLMs

Frontier LLMs (Claude, GPT-4) are powerful but expensive, slow, and
unreliable for structured output. When a cognitive task is:

- **Repetitive** — the same pattern occurs across many cycles
- **Constrained** — output is a small formal language (DSL)
- **Pattern-based** — input→output mapping has consistent rules
- **Low-latency required** — must not add perceptible delay

...it should be **compiled** from slow frontier deliberation into a fast
specialized model. This is the System 1/2 transition from RFC 002.

**Evidence:** Monitor, Observer, and Evaluator SLMs achieve 93-100% accuracy
on their respective DSLs at 0.5B parameters with 0.15% fallback rate.
The KPI Checker SLM (PRD 049) was bootstrapped from PRD to validated
corpus in 45 minutes using this pipeline.

## Architecture

```
Seed pairs (5-20 real examples)
  → Corpus generator (synthetic expansion to 2-5K pairs)
  → Grammar validation gate (Peggy compile + parse, 100% automated)
  → B-2 Causal Validator (automated quality check)
  → LoRA fine-tuning (Qwen2.5-0.5B, ~1 hour on RTX 4090)
  → Evaluation gates (parse accuracy, semantic accuracy, adversarial)
  → ONNX export (optional, for CPU inference)
  → Integration via InferencePort
```

## Training Infrastructure

### Hardware

| Machine | GPU | VRAM | Role |
|---------|-----|------|------|
| chobits (Tailscale) | RTX 4090 | 24 GB | **Training + inference** (primary) |
| mission-control (local) | 2× RTX 2080 Ti | 11 GB each | Development, ONNX inference |

**Always train on chobits** — ~2x faster than 2080 Ti, doesn't slow
the local dev machine. See `docs/arch/gpu-inference-cluster.md` for
SSH commands and setup.

### Software

```
Python:     C:\Users\atfm0\miniconda3\envs\slm\python.exe (3.11)
PyTorch:    2.5.1+cu121
Transformers: latest (HuggingFace)
PEFT:       latest (LoRA implementation)
Repo:       C:\Users\atfm0\pv-method\ (git clone on chobits)
```

### Quick Reference: Run Training

```bash
# 1. Sync repo on chobits
ssh chobits "cmd /c 'cd C:\Users\atfm0\pv-method && git pull'"

# 2. Train
ssh chobits "cmd /c 'cd C:\Users\atfm0\pv-method\experiments\exp-slm && set CUDA_VISIBLE_DEVICES=0 && C:\Users\atfm0\miniconda3\envs\slm\python.exe -u phase-3-training\scripts\train.py --config <config-path>.yaml 2>&1'"

# 3. Generate predictions
ssh chobits "cmd /c 'cd C:\Users\atfm0\pv-method\experiments\exp-slm-composition && set CUDA_VISIBLE_DEVICES=0 && C:\Users\atfm0\miniconda3\envs\slm\python.exe -u <predict-script>.py --model-dir <model> --holdout <input.jsonl> --output <output.jsonl> 2>&1'"

# 4. Copy results back
scp "chobits:C:/Users/atfm0/pv-method/experiments/<path>/results/<file>" ./
```

## Model Architecture

### Why Qwen2.5-0.5B-Instruct

| Factor | Decision | Rationale |
|--------|----------|-----------|
| Size | 0.5B (494M params) | RFC 002 Phase 3 proved sufficient for DSL tasks. Scaling law: architecture change >> data quality >> model size for structured output |
| Variant | Instruct | Already knows chat templates, follows prompts without additional alignment |
| Family | Qwen2.5-Coder | Code-pretrained, better tokenization of programming constructs |

**The Phase 3 scaling law:** For structured DSL tasks, accuracy scales as:
```
architecture_change: +21.65pp per family jump
data_2x:            +2.78pp
rank_2x:            +0.95pp
code_pretrain:       = rank_2x
```

Translation: a clean corpus matters ~3x more than doubling model size.
This is why the flywheel focuses on corpus quality, not larger models.

### Why LoRA (not full fine-tuning)

| Parameter | Value | Why |
|-----------|-------|-----|
| Method | LoRA | 200x fewer trainable params than full FT. Same accuracy for DSL tasks |
| Rank (r) | 16 | Sweet spot from Phase 3 ablation. r=8 is ~1pp worse, r=32 adds cost with no gain |
| Alpha | 32 | Standard 2×rank |
| Target modules | q, k, v, o projections | Attention is where DSL patterns are learned. MLP adapters don't help |
| Dropout | 0.05 | Light regularization. 0.1 hurts on small corpora |
| Trainable params | ~2.16M / 494M | 0.44% of model — fast training, tiny checkpoint |

### Training Hyperparameters

| Parameter | Value | Why |
|-----------|-------|-----|
| Learning rate | 2e-4 | Standard for LoRA. 1e-4 converges too slowly, 5e-4 overshoots |
| Warmup | 100-200 steps | Prevents early gradient explosion on small corpora |
| Weight decay | 0.01 | Light L2 regularization |
| Precision | FP16 | 2x speedup, no accuracy loss at 0.5B scale |
| Batch size | 2 | VRAM-limited by max_length. Effective batch via gradient accumulation if needed |
| Max length | 512-896 tokens | Depends on DSL complexity. 512 for simple classifiers, 896 for grammar generators |
| Steps | 3000-5000 | ~3-4 epochs over the corpus. Token accuracy typically plateaus by epoch 2 |

### What We Don't Do (and Why)

| Technique | Why Not |
|-----------|---------|
| Full fine-tuning | LoRA achieves same accuracy at 0.44% of params. No benefit for DSL tasks |
| RLHF/DPO | Corpus quality is high enough that SFT works. No preference data needed |
| Quantization (training) | FP16 is the sweet spot. INT8 training hurts accuracy at 0.5B |
| Data augmentation | Peggy gate validates quality — synthetic generator + grammar gate is sufficient |
| Curriculum learning | Shuffled random order works. DSL patterns are learned early regardless of order |
| Larger models | 0.5B saturates DSL accuracy. 1.5B adds cost with diminishing returns (Phase 3 data) |

## Creating a New SLM (Step by Step)

### Step 1: Define the DSL

Write a Peggy grammar that describes valid SLM output. This grammar
becomes the validation gate — every training pair's output must parse.

```
experiments/exp-slm-composition/phase-2-bootstrap/<slm-name>/
  <dsl-name>.peggy     ← the grammar
```

**Tip:** Keep grammars simple. 4-6 primitives with composition operators
is the sweet spot. Complex grammars need more training data.

Test the grammar:
```bash
node -e "const peggy=require('peggy'); const g=peggy.generate(require('fs').readFileSync('<grammar>.peggy','utf-8')); console.log(g.parse('<test-input>'))"
```

### Step 2: Collect Seed Pairs

Find 5-20 real (input, output) examples from the codebase or task suite.
These are the ground truth that the synthetic generator expands from.

Format: JSONL with `input` and `output` fields.
```json
{"input": "<natural language or structured input>", "output": "<DSL expression>"}
```

### Step 3: Build Corpus Generator

Write a generator that produces synthetic training pairs. Follow the
established pattern from `phase-1-schema-grammar/scripts/generate-corpus.mjs`.

Key principles:
- **Every output must parse** through the Peggy grammar (automated validation)
- **Vary the input** vocabulary, structure, and complexity
- **Target 2-5K pairs** (2K minimum for 0.5B, 5K for complex DSLs)
- **80/20 train/holdout split**
- **Include edge cases** (empty inputs, boundary values, unusual combinations)

### Step 4: Validate Corpus

```bash
# Grammar validation (must be 100%)
node <evaluate-script>.mjs --corpus-check

# Causal validation (B-2, when available)
# Run B-2 on the corpus to check input→output consistency
```

### Step 5: Create Training Config

```yaml
model:
  name: "Qwen/Qwen2.5-0.5B-Instruct"
  dtype: "float32"

lora:
  r: 16
  lora_alpha: 32
  target_modules: ["q_proj", "v_proj", "k_proj", "o_proj"]
  lora_dropout: 0.05
  bias: "none"
  task_type: "CAUSAL_LM"

training:
  max_steps: 3000          # ~3 epochs for 2K corpus
  per_device_train_batch_size: 2
  learning_rate: 2.0e-4
  warmup_steps: 100
  weight_decay: 0.01
  fp16: true
  max_length: 512          # adjust for DSL complexity
  eval_strategy: "steps"
  eval_steps: 500
  seed: 42

data:
  train_path: "<path>/corpus/train.jsonl"
  holdout_path: "<path>/corpus/holdout.jsonl"

output:
  dir: "<path>/models/<model-name>"
```

### Step 6: Train

```bash
ssh chobits "cmd /c 'cd C:\Users\atfm0\pv-method && git pull'"
ssh chobits "cmd /c 'cd C:\Users\atfm0\pv-method\experiments\exp-slm && set CUDA_VISIBLE_DEVICES=0 && C:\Users\atfm0\miniconda3\envs\slm\python.exe -u phase-3-training\scripts\train.py --config <config>.yaml 2>&1'"
```

**Expected timeline:**
| Corpus size | Steps | Time (RTX 4090) | Peak VRAM |
|-------------|-------|-----------------|-----------|
| 2K | 3000 | ~55 min | ~9 GB |
| 3K | 4500 | ~80 min | ~9 GB |
| 5K | 5000 | ~100 min | ~12 GB |
| 8K+ | 5000 | ~100 min | ~16 GB |

**What to watch:** Eval loss should drop fast (first 500 steps) then
plateau. Token accuracy typically reaches 95-96% by step 1000 for
DSL tasks. If it doesn't, the corpus likely has quality issues.

### Step 7: Evaluate

Generate predictions on holdout, then run through evaluation gate:

```bash
# Generate predictions
ssh chobits "cmd /c '... python generate-predictions.py --model-dir <model> --holdout <holdout.jsonl> --output <predictions.jsonl> 2>&1'"

# Copy back
scp "chobits:.../<predictions.jsonl>" ./

# Evaluate (parse accuracy + semantic accuracy)
node <evaluate-script>.mjs <predictions.jsonl>
```

**Gate targets:**
| Gate | Metric | Target |
|------|--------|--------|
| Gate 1 | DSL parse accuracy | >= 95% (98% for production) |
| Gate 2 | Semantic accuracy | >= 85% (90% for production) |
| Gate 3 | Adversarial accuracy | >= 70% |

### Step 8: Integrate

Wire the SLM into the cognitive architecture via `InferencePort`:

```typescript
import { createJsonlInference, createOllamaInference } from './inference-adapters.js';

// For evaluation (pre-generated predictions)
const inference = createJsonlInference('my-slm', predictions);

// For production (live inference via Ollama or HTTP bridge)
const inference = createOllamaInference({
  baseUrl: 'http://chobits:11434',
  model: 'my-slm-model',
});

// Wire into CLM pipeline with grammar gate
const pipeline = {
  id: 'my-pipeline',
  stages: [
    { type: 'stage', stage: createSLMStage('my-slm', inference) },
    { type: 'gate', gate: createPeggyCompileGate(), onFail: { maxRetries: 2, escalation: 'frontier' } },
  ],
};
```

## SLM Inventory

| SLM | Domain | Corpus | Accuracy | Status |
|-----|--------|--------|----------|--------|
| B-1 v2 (Schema→Grammar) | Type→PEG grammar | 3K (TS + JSON Schema) | 96.7% novel TS, 100% JSON Schema | **Production** |
| B-2 (Causal Validator) | Corpus quality | 8.5K (3 domains) | ~93% (training) | **Training** |
| Downstream WorktreeInfo | Session→DSL | 1.25K | 100% parse + semantic | **Production** |
| KPI Checker (PRD 049) | KPI→Check DSL | 3K | Pending | **Corpus ready** |
| Monitor v2 | Signals→Anomaly DSL | 33K | 98.6% | **Production** (exp-slm) |
| Observer | Signals→Observer DSL | ~5K | 93.4% | **Production** (exp-slm) |
| Evaluator | Signals→Evaluator DSL | ~5K | 93.4% | **Production** (exp-slm) |

## Composition Runtime

SLMs compose into CLM (Composed Language Model) pipelines via the
composition runtime at `experiments/exp-slm-composition/composition-runtime/`.

**Key interfaces:**
- `StagePort` — what a pipeline stage does (SLM or deterministic)
- `GatePort` — what a validation gate does (compile, parse, schema, classifier)
- `InferencePort` — how stages call SLMs (mock, JSONL, Ollama, ONNX)
- `PipelineDefinition` — ordered list of stages + gates with failure policies

**Validated at:**
- N=2 stages: 100% (50/50)
- N=3 stages: 100% (50/50, 2 real SLMs)
- Gate effectiveness: 100% (all corrupted outputs caught)

See `composition-runtime/FINDINGS.md` for detailed results.

## Troubleshooting

**Training loss doesn't drop:**
- Check corpus quality — run `--corpus-check` to verify 100% parse rate
- Check for duplicates — shuffled corpus with many identical entries trains poorly
- Try lower learning rate (1e-4) if loss oscillates

**Low accuracy despite low loss:**
- Likely overfitting on formatting, not learning the mapping
- Increase corpus diversity (more field names, more type combinations)
- Check if `max_length` is truncating inputs/outputs

**Inference produces garbage:**
- Verify the chat template matches training format
- Check that `do_sample=False` for deterministic output
- Ensure `max_new_tokens` is sufficient for the DSL

**Chobits SSH issues:**
- PowerShell is default — use `cmd /c '...'` for `&&` chaining
- Profile script warning is cosmetic (ignore the `PSSecurityException`)
- Check GPU: `ssh chobits "nvidia-smi --query-gpu=memory.used --format=csv"`
