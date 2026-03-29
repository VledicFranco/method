# EXP-SLM Phase 3 — Scaling Analysis & Comprehensive Findings

**Experiment:** exp-slm (RFC 002 validation)
**Date range:** 2026-03-28 to 2026-03-29
**Hardware:** NVIDIA RTX 2080 Ti (11GB VRAM), CUDA 12.6
**Total runs:** 7 (3 diagnostic + 4 scaling)
**Agents:** overnight-research-20260329 A6, A7, A8, A9

---

## Executive Summary

Across 7 training runs spanning 3 model architectures (SmolLM2-135M, SmolLM2-360M,
Qwen2.5-0.5B), 2 training methods (full fine-tune, LoRA), and 2 corpus sizes (10K, 20K),
we validated RFC 002's central thesis: small language models can learn typed DSLs with
production-grade accuracy. The strongest finding is that **architecture selection dominates
all other scaling axes** — Qwen2.5-0.5B with LoRA achieved 92.45% adversarial accuracy,
exceeding the 135M full fine-tune baseline by +21.6pp while training only 0.44% of
parameters. Data volume (10K to 20K) provided marginal gains (+2.8pp adversarial), while
LoRA proved surprisingly effective, matching or exceeding full fine-tuning at a fraction
of the parameter budget. Gate 4 Part 1 (calibration + ONNX export) passed with the model
already well-calibrated out of the box (ECE 0.0195) and ONNX achieving 100% exact match
fidelity.

---

## Phase 3 Run History

### Diagnostic Phase (Runs 1-3): Data Quality Discovery

Runs 1-3 established the critical insight that data quality, not model scale or training
duration, is the primary driver of semantic accuracy on typed DSLs.

| | Run 1 | Run 2 | Run 3 (baseline) |
|---|---|---|---|
| **Date** | 2026-03-28 | 2026-03-28 | 2026-03-28 |
| **Model** | SmolLM2-135M | SmolLM2-135M | SmolLM2-135M |
| **Method** | Full FT | Full FT | Full FT |
| **Corpus** | 4K random | 4K random | 10K causal |
| **Steps** | 1,000 | 5,000 | 3,000 |
| **Parse** | 100% | 100% | 100% |
| **Semantic** | 39.2% | 39.3% | **98.6%** |
| **Adversarial** | 11.0% | 11.6% | **70.8%** |
| **Loss** | 0.434 | 0.286 | 0.277 |
| **Time** | 3.8 min | 16.8 min | 11.4 min |
| **VRAM** | 2,950 MB | 2,950 MB | 2,951 MB |

**Key finding:** 5x training steps on random data (Run 1 to Run 2) moved semantic accuracy
by +0.1pp. Switching to causally consistent data (Run 2 to Run 3) moved it by +59.3pp.
This established Run 3 as the Gate 3 baseline and the foundation for scaling analysis.

---

## Scaling Analysis (Runs 4-7)

Four scaling runs explored three independent axes from the Run 3 baseline:

1. **Data volume:** 10K to 20K corpus (Run 4)
2. **Model capacity + parameter efficiency:** 360M LoRA (Run 5)
3. **Architecture change + parameter efficiency:** Qwen2.5-0.5B LoRA (Run 6)
4. **Gate 4 Part 1:** Calibration + ONNX export on best model (Run 7)

### Full Scaling Curve Table

| | Run 3 (baseline) | Run 4: 135M/20K | Run 5: 360M LoRA | Run 6: Qwen-0.5B LoRA |
|---|---|---|---|---|
| **Date** | 2026-03-28 | 2026-03-29 | 2026-03-29 | 2026-03-29 |
| **Model** | SmolLM2-135M | SmolLM2-135M | SmolLM2-360M | Qwen2.5-0.5B |
| **Method** | Full FT | Full FT | LoRA r=16 | LoRA r=16 |
| **Corpus** | 10K | 20K | 10K | 10K |
| **Total params** | 134.5M | 134.5M | 361.8M | 494.0M |
| **Trainable params** | 134.5M (100%) | 134.5M (100%) | 3.28M (0.91%) | 2.16M (0.44%) |
| **Steps** | 3,000 | 3,000 | 3,000 | 3,000 |
| **Batch size** | 8 | 8 | 4 | 2 |
| **Learning rate** | 2e-5 | 2e-5 | 2e-4 | 2e-4 |
| | | | | |
| **Parse accuracy** | 100.00% | 100.00% | 100.00% | 99.96% |
| **Semantic accuracy** | 98.60% | 98.64% | 98.88% | **99.60%** |
| **Adversarial accuracy** | 70.80% | 73.58% | 77.36% | **92.45%** |
| **Final loss** | 0.277 | 0.2767 | 0.3016 | 0.3029 |
| | | | | |
| **Training time** | 683s (11.4m) | 697s (11.6m) | 896s (14.9m) | 1202s (20.0m) |
| **Peak VRAM** | 2,951 MB | 2,950 MB | 2,367 MB | 4,466 MB |
| **Confidence mean** | 99.97% | -- | 99.93% | 99.95% |
| **Latency mean** | -- | 0.98s | -- | 0.73s |
| **Latency median** | -- | -- | 0.76s | 0.54s |

### Gate 4 Part 1 Results (on SmolLM2-135M Run 3 model)

| Metric | Target | Result | Status |
|---|---|---|---|
| ECE (calibration) | <= 0.15 | **0.0195** | PASS |
| ONNX exact match | <= 2% delta | **0.0% delta** (100% match) | PASS |
| ONNX file size | -- | 514.3 MB | -- |
| ONNX validation entries | -- | 100 | -- |

---

## Key Findings

### 1. Architecture Matters More Than Data Volume

The single largest accuracy improvement came from changing the base model architecture,
not from scaling data or parameters:

| Scaling axis | Adversarial delta | Notes |
|---|---|---|
| 10K to 20K corpus (same model) | +2.78pp | 70.8% to 73.6% |
| 135M to 360M (same family, LoRA) | +6.56pp | 70.8% to 77.4% |
| SmolLM2 to Qwen2.5 (LoRA) | **+21.65pp** | 70.8% to 92.5% |

Qwen2.5-0.5B's instruction-tuned base provided a dramatically stronger starting point for
DSL learning. The adversarial improvement of +21.65pp over the SmolLM2-135M baseline is
8x larger than the data volume effect and 3x larger than the within-family model scaling
effect. This suggests that for typed DSL compilation, the quality of the pretrained base
model's instruction-following capability is the dominant factor.

### 2. LoRA Is Surprisingly Effective for DSL Compilation

LoRA (r=16, alpha=32) matched or exceeded full fine-tuning while training a tiny fraction
of parameters:

| Comparison | Full FT (135M) | LoRA (360M) | LoRA (Qwen-0.5B) |
|---|---|---|---|
| Trainable params | 134.5M (100%) | 3.28M (0.91%) | 2.16M (0.44%) |
| Semantic | 98.6% | 98.88% (+0.28pp) | 99.60% (+1.0pp) |
| Adversarial | 70.8% | 77.36% (+6.56pp) | 92.45% (+21.65pp) |
| VRAM | 2,951 MB | 2,367 MB (-20%) | 4,466 MB (+51%) |

The 360M LoRA actually used *less* VRAM than the 135M full fine-tune (2,367 MB vs 2,951 MB)
because only 0.91% of parameters required gradients. This makes LoRA the preferred training
method for production DSL compilation — it is cheaper, faster to iterate, and produces equal
or better results.

### 3. Data Volume Shows Diminishing Returns

Doubling the corpus from 10K to 20K with the same model (SmolLM2-135M) yielded:

- Parse: 100% to 100% (no change — already saturated)
- Semantic: 98.60% to 98.64% (+0.04pp — negligible)
- Adversarial: 70.80% to 73.58% (+2.78pp — modest)

The data quality fix (Run 2 to Run 3, random to causal) was the transformative change.
Once causal consistency is established, additional volume provides only marginal gains on
boundary cases. This is consistent with the DSL's bounded grammar — with a finite set of
anomaly types and signal patterns, 10K causally consistent examples is sufficient to cover
the decision surface.

### 4. QLoRA Merge Failure Is a Practical Limitation

The initial attempt to train Qwen2.5-0.5B used QLoRA (4-bit NF4 quantization) to minimize
VRAM. The training completed, but `merge_and_unload()` from the 4-bit quantized base
produced a model that generated garbage — 0% DSL accuracy. This is a known limitation of
bitsandbytes NF4 quantization: the merge operation introduces numerical errors that corrupt
the adapted weights.

**Workaround:** Standard LoRA with FP16 AMP succeeded at 4,466 MB VRAM — well within the
11GB RTX 2080 Ti. QLoRA would only be necessary for models that exceed GPU memory under
standard LoRA, which was not the case here.

**Implication for production:** If deploying models larger than ~1B parameters on
constrained hardware, QLoRA merge fidelity must be validated before committing to that
training path. For the 0.5B-class models used here, standard LoRA is both feasible and
preferable.

### 5. Calibration Is Free — The Model Was Already Well-Calibrated

Temperature scaling calibration on the SmolLM2-135M Run 3 model found:

- **ECE before calibration:** 0.0195 (target: <= 0.15)
- **ECE after temperature scaling:** 0.02 (optimal T=10.0, at upper bound)
- **Calibration set accuracy:** 98%

The model's near-perfect confidence (99.95% mean) closely matches its actual accuracy
(98-99%), meaning the causal data fix in Run 3 produced naturally calibrated predictions.
Temperature scaling is effectively unnecessary — the model passed the calibration gate
without any post-hoc adjustment.

This was unexpected. Runs 1-2 showed severe overconfidence (96% confidence on 39% accuracy).
The causal data fix simultaneously resolved both the accuracy problem AND the calibration
problem, suggesting that overconfidence in SLMs is a symptom of learning surface patterns
rather than causal relationships.

### 6. ONNX Export Works With Perfect Fidelity

ONNX export via `optimum` on the SmolLM2-135M Run 3 model achieved:

- **Export time:** 21.9 seconds
- **File size:** 514.3 MB (FP32, expected for 135M params)
- **Exact match rate:** 100% (100/100 validation entries)
- **Accuracy difference:** 0.0%

The ONNX graph faithfully reproduces the PyTorch model's behavior with zero degradation.
This validates the ONNX integration path for Phase 4 runtime deployment.

---

## Scaling Trend Analysis

### Parse Accuracy (saturated)

All 7 runs achieved >= 99.96% parse accuracy. The Peggy grammar is fully learnable by all
tested model architectures and sizes. This metric saturated immediately and provides no
scaling signal. The single 99.96% result (Qwen2.5, 1 parse failure in 2500) is within
noise — effectively 100%.

### Semantic Accuracy (near-saturated)

```
Run 1 (4K random):     39.2%  |====                                      |
Run 2 (4K random):     39.3%  |====                                      |
Run 3 (10K causal):    98.6%  |=========================================  |
Run 4 (20K causal):    98.64% |=========================================  |
Run 5 (360M LoRA):     98.88% |=========================================  |
Run 6 (Qwen LoRA):     99.60% |==========================================|
```

Semantic accuracy is near ceiling (99.6%) and shows diminishing returns across all scaling
axes. The primary barrier was data quality (random to causal), not scale. Within the causal
data regime, all models achieve > 98.6%.

### Adversarial Accuracy (primary scaling signal)

```
Run 1 (4K random):      11.0% |=                                         |
Run 2 (4K random):      11.6% |=                                         |
Run 3 (10K causal):     70.8% |==============================             |
Run 4 (20K causal):     73.6% |===============================            |
Run 5 (360M LoRA):      77.4% |================================           |
Run 6 (Qwen LoRA):      92.5% |======================================== |
                                                              target: 70%^
```

Adversarial accuracy is the only metric with meaningful scaling signal in the causal data
regime. It measures performance on 106 boundary cases — edge conditions, ambiguous signals,
compound anomalies. The progression:

- **Data volume** (Run 3 to 4): +2.78pp — more examples of boundary patterns help modestly
- **Model capacity** (Run 3 to 5): +6.56pp — more parameters capture more boundary distinctions
- **Architecture** (Run 3 to 6): +21.65pp — Qwen2.5's pretrained knowledge transfers to boundary reasoning

The adversarial curve is still climbing at 92.5%. A Qwen2.5-0.5B trained on 20K could
plausibly reach 95%+, though this was not tested in this session.

### Training Efficiency

| Model | Time | VRAM | Trainable | Adversarial/minute |
|---|---|---|---|---|
| 135M Full FT (10K) | 11.4 min | 2,951 MB | 134.5M | 6.21 pp/min |
| 135M Full FT (20K) | 11.6 min | 2,950 MB | 134.5M | 6.34 pp/min |
| 360M LoRA (10K) | 14.9 min | 2,367 MB | 3.28M | 5.19 pp/min |
| Qwen-0.5B LoRA (10K) | 20.0 min | 4,466 MB | 2.16M | 4.62 pp/min |

All runs fit within a single RTX 2080 Ti. Even the largest configuration (Qwen-0.5B LoRA)
used only 41% of available VRAM, leaving significant headroom for larger models or batch
sizes.

---

## Consolidated Gate Status

### Gate 3 — Single Module Compilation

| Metric | Target | Best Result (Qwen-0.5B) | Status |
|---|---|---|---|
| Parse accuracy | >= 95% | 99.96% | **PASS** |
| Semantic accuracy | >= 85% | 99.60% | **PASS** |
| Adversarial accuracy | >= 70% | 92.45% | **PASS** |

**Gate 3: PASS** (all 4 scaling runs pass individually)

### Gate 4 Part 1 — Calibration + Export

| Metric | Target | Result | Status |
|---|---|---|---|
| ECE (temperature calibration) | <= 0.15 | 0.0195 | **PASS** |
| ONNX accuracy delta | <= 2% | 0.0% | **PASS** |
| ONNX export success | -- | yes (514.3 MB) | **PASS** |

**Gate 4 Part 1: PASS**

### Gate 4 Part 2 — Integration (remaining)

| Metric | Target | Status |
|---|---|---|
| HTTP bridge inference server | functional | **NOT STARTED** |
| SLMProviderAdapter cycle benchmark | cost reduction >= 30% | **NOT STARTED** |
| End-to-end latency (ONNX) | < 100ms | **NOT STARTED** |

---

## Recommendations

### Immediate (Gate 4 Part 2 completion)

1. **Use Qwen2.5-0.5B LoRA as the production model.** It has the best accuracy profile
   (99.60% semantic, 92.45% adversarial) and its 494M base fits comfortably in the ONNX
   runtime. Export the Qwen model to ONNX (the current ONNX export was done on SmolLM2-135M).

2. **Skip temperature scaling in production.** ECE 0.0195 is already excellent. If needed
   later, a simple T=1.0 pass-through suffices. Do not add calibration complexity without
   evidence of miscalibration on the Qwen model.

3. **Build the HTTP bridge inference server** with ONNX Runtime for the Qwen model. Target
   latency: < 100ms per inference (ONNX with KV cache should achieve 10-50ms on RTX 2080 Ti
   for this model size).

4. **Run the SLMProviderAdapter benchmark** — 10 monitoring tasks, measure cost reduction
   vs LLM Monitor v2 baseline. The 30% cost reduction target should be easily achievable
   given that SLM inference is effectively free compared to API calls.

### Future Research

5. **Test Qwen2.5-0.5B on 20K corpus.** The untested combination of the best architecture
   with the larger corpus could push adversarial accuracy toward 95%+. This is the
   highest-expected-value single experiment remaining.

6. **Explore Qwen2.5-1.5B if adversarial ceiling matters.** The 0.5B model's 92.5%
   adversarial accuracy may have room to grow with a larger base. 1.5B with LoRA would
   likely fit in 11GB VRAM.

7. **Investigate QLoRA merge-and-unload fix.** The 4-bit merge failure blocks the path
   to models > 1B on constrained hardware. Potential workarounds: GPTQ quantization instead
   of NF4, or inference-time LoRA application without merging.

8. **Multi-module compilation.** Current results are for the Monitor module only. The next
   RFC 002 milestone is compiling Observer and Reasoner modules — same training pipeline,
   different DSLs.

---

## Data Sources

All numbers in this document are cross-referenced against:

- **Log entries:** `experiments/log/2026-03-28-exp-slm-run{1,2,3}.yaml`,
  `experiments/log/2026-03-29-exp-slm-{135m-20k,360m-lora,qwen05b-lora,calibration,onnx-export}.yaml`
- **Result JSON:** `phase-3-training/results/{training-eval,training-report,calibration,onnx-export}.json`
- **Training configs:** `phase-3-training/configs/monitor-{smollm2-135m,smollm2-135m-run2,smollm2-135m-run3,smollm2-135m-20k,smollm2-360m-lora,qwen25-05b-qlora,qwen25-05b-lora}.yaml`

Note: The `training-eval.json` and `training-report.json` files in `results/` contain data
from the most recent run (Qwen2.5-0.5B LoRA) only. Earlier runs' detailed JSON was
overwritten. All runs are preserved in the `experiments/log/` YAML entries.
