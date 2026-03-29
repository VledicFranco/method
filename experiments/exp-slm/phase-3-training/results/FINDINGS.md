# EXP-SLM Phase 3 Findings

## Run 1 — SmolLM2-135M, 1000 steps, 4000 corpus

**Date:** 2026-03-28
**Model:** HuggingFaceTB/SmolLM2-135M-Instruct (134.5M params)
**Corpus:** 4000 train + 1000 holdout, Monitor v2 DSL format
**Training:** FP32 model + FP16 AMP, batch 8, LR 2e-5, 1000 steps, 2 epochs
**Hardware:** RTX 2080 Ti (11GB), CUDA 12.6, 2.95GB peak VRAM

### Training Metrics

| Metric | Value |
|--------|-------|
| Final loss | 0.434 |
| Eval loss | 0.253 |
| Eval token accuracy | 91.0% |
| Training time | 3.8 min (228s) |
| Steps/second | 4.38 |
| Peak VRAM | 2,950 MB |

### Evaluation Results (1000 holdout)

| Metric | Target | Result | Status |
|--------|--------|--------|--------|
| Parse accuracy | >= 95% | **100.0%** | PASS |
| Semantic accuracy | >= 85% | 39.2% | FAIL |
| Adversarial accuracy | >= 70% | 11.0% | FAIL |
| Confidence mean | -- | 96.0% | Overconfident |
| Confidence median | -- | 96.4% | |
| Confidence p95 | -- | 99.97% | |
| Latency mean | -- | 1.461s | PyTorch autoregressive |
| Latency p95 | -- | 2.947s | |

### Analysis

**Parse accuracy (100%):** The most important result. Every single output from the SLM
parses as valid Monitor DSL. The model has completely internalized the grammar:
- Section order (ANOMALIES -> ESCALATE -> RESTRICT -> REPLAN) is always correct
- Keywords (`none`, `yes`, `no`) are always spelled correctly
- Quoted strings are always properly delimited
- Module ID `@` prefix is always present
- Anomaly types are always from the valid set

This validates RFC 002 Part II's claim: "The DSL constraint collapses the prediction
problem from open-vocabulary to bounded grammar."

**Semantic accuracy (39.2%):** The model produces valid reports with wrong content.
Failure modes observed:
- Produces `ANOMALIES: none` when anomalies should be present (misses signals)
- Produces wrong anomaly type (e.g., `low-confidence` when should be `unexpected-result`)
- Produces wrong module ID (e.g., `@observer` when anomaly is from `@reasoner`)
- Detail strings are generic rather than signal-specific

The 91% token accuracy during training vs 39.2% semantic accuracy suggests the model
memorized common patterns but didn't learn the signal→anomaly mapping function. The
training data may lack sufficient input diversity for the model to generalize.

**Overconfidence (96% mean):** The model is confidently wrong — the worst case for the
escalation mechanism. This confirms RFC 002's identification of calibration as "the
single highest-risk engineering challenge." Temperature scaling is mandatory; confidence
scores are useless pre-calibration.

**Latency (1.46s):** This is PyTorch autoregressive generation, not ONNX-optimized.
Not meaningful for the 100ms target — ONNX with KV cache would be 10-50x faster.

### Diagnosis

The semantic gap is likely caused by:

1. **Insufficient input diversity.** The corpus was generated from 101 base traces +
   synthetic augmentation. The augmentation varies output fields but may not vary
   the *relationship* between input signals and output anomalies enough.

2. **Only 2 epochs.** 1000 steps with batch 8 = 8000 samples = 2 passes over 4000
   entries. The model saw each example twice. Complex mapping functions typically
   need 5-10 epochs to learn.

3. **Input encoding may be too opaque.** The `SIGNALS:` format packs monitoring
   signals into a compact text that may not give the model enough structure to
   reason about which signals map to which anomalies.

### Recommended Next Steps

1. **Run 2: Increase steps to 5000 (10 epochs).** Keep everything else constant.
   Expected: semantic accuracy should improve to 60-75% as the model sees each
   example 10 times.

2. **Run 3: Augment corpus to 10K-20K with explicit signal→anomaly pairing.**
   Each training example should make the causal relationship between input signals
   and output anomalies obvious.

3. **Run 4: If still <85%, try SmolLM2-360M with LoRA.** Larger model may capture
   the mapping function that 135M cannot.

## Run 2 — SmolLM2-135M, 5000 steps (10 epochs), 4000 corpus

**Date:** 2026-03-28
**Config:** Same as Run 1 but 5000 steps, 100 warmup steps

### Training Metrics

| Metric | Run 1 | Run 2 | Delta |
|--------|-------|-------|-------|
| Steps | 1000 | 5000 | +4000 |
| Final loss | 0.434 | 0.286 | -0.148 |
| Training time | 3.8 min | 16.8 min | +13 min |
| Peak VRAM | 2,950 MB | 2,950 MB | same |

### Evaluation Results (1000 holdout)

| Metric | Run 1 | Run 2 | Delta |
|--------|-------|-------|-------|
| Parse accuracy | 100.0% | **100.0%** | same |
| Semantic accuracy | 39.2% | **39.3%** | +0.1% |
| Adversarial accuracy | 11.0% | **11.6%** | +0.6% |
| Confidence mean | 96.0% | **96.2%** | +0.2% |

### Analysis

**The model plateaued.** 5x more training steps (2 → 10 epochs) reduced loss from 0.434
to 0.286 but semantic accuracy barely moved (39.2% → 39.3%). This rules out
"insufficient training" as the cause. The model has converged on the current data
distribution — it learned the format perfectly but cannot learn the input→output mapping
from this corpus.

**Root cause hypothesis:** The training data lacks explicit causal signal. The input
format (`SIGNALS:\n[mod:type] field=value`) is too compact — the model can't infer
*which* signal patterns map to *which* anomaly types because the mapping was generated
by a deterministic mock, not a reasoning process. The synthetic augmentation varied
output fields randomly rather than maintaining consistent signal→anomaly relationships.

**Implication:** The corpus generation strategy needs revision. Instead of randomly
varying output fields, the augmenter must maintain causal consistency: specific signal
patterns should always produce specific anomaly types. The model needs to learn
"low confidence from reasoner → low-confidence anomaly for reasoner", not just
"here's what a low-confidence anomaly looks like."

### Next Steps

1. **Revise corpus generation** — ensure causal consistency between input signals and
   output anomalies. Each training example must have a clear, learnable mapping.
2. **Re-augment** with causally consistent examples (10K-20K entries)
3. **Run 3** with revised corpus on same model (SmolLM2-135M)
4. If still <85%: try SmolLM2-360M with LoRA (larger model capacity)

---

### What's Validated

- RFC 002 core thesis: SLMs CAN learn typed DSLs (100% parse accuracy)
- Training infrastructure works (3.8min on single 2080 Ti)
- VRAM headroom is massive (2.95GB / 11GB — room for 3-4x larger model)
- The DSL grammar design (peggy PEG) is learnable by small models
- Overconfidence risk is real and calibration is essential
