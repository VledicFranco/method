# Machine Specification — Experiment Environment

Reference specification for the machine experiments are designed and validated on.
Agents should run `scripts/verify-machine.py` before starting GPU-intensive work
to confirm compatibility.

## Hardware

| Component | Specification |
|-----------|--------------|
| CPU | Intel Core i9-13900KF (24 cores / 32 threads) |
| RAM | 64 GB DDR5 |
| GPU 0 | NVIDIA GeForce RTX 2080 Ti — 11,264 MiB VRAM (display GPU) |
| GPU 1 | NVIDIA GeForce RTX 2080 Ti — 11,264 MiB VRAM (training GPU) |
| GPU Compute | SM 7.5 (Turing) — supports FP16, does NOT support BF16 natively |
| System | ASUS motherboard, Windows 11 Pro |

## Software

| Component | Version | Notes |
|-----------|---------|-------|
| OS | Windows 11 Pro 10.0.26200 | |
| CUDA Driver | 595.71 | |
| CUDA Toolkit | 12.6 (per nvidia-smi) | |
| Python | 3.14 | System install at `C:\Users\atfm0\AppData\Local\Python\` |
| Node.js | 22+ | |
| PyTorch | 2.11.0+cu126 | Must use cu126 wheel, NOT the default CPU-only pip install |
| Transformers | 4.57.6 | |
| trl | 0.29.1 | Uses `max_length` not `max_seq_length`; `dtype` not `torch_dtype` |

## GPU Usage Convention

- **GPU 0 (index 0):** Display GPU. Desktop, browsers, IDE. Do NOT use for training.
- **GPU 1 (index 1):** Training GPU. Use `CUDA_VISIBLE_DEVICES=1` for all experiment work.
- When `CUDA_VISIBLE_DEVICES=1` is set, the training GPU appears as `cuda:0` in PyTorch.

## Known Compatibility Issues

1. **BF16 not supported.** RTX 2080 Ti (SM 7.5) does not have native BF16. Always use
   `fp16=True, bf16=False` in training configs. Load models in FP32 for FP16 AMP.

2. **onnxruntime-node native bindings fail.** The Node.js ONNX Runtime package loads but
   the native C++ backend doesn't initialize on this Windows + Node16 + ESM setup.
   **Workaround:** Use Python HTTP bridge (`serve-model.py`) for inference. Python
   onnxruntime works (CPU provider confirmed).

3. **PyTorch default pip install is CPU-only.** Must install from the cu126 index:
   `pip install torch --index-url https://download.pytorch.org/whl/cu126`

4. **trl API changes.** Recent trl versions renamed `max_seq_length` → `max_length` and
   deprecated `torch_dtype` in favor of `dtype`. Smoke tests catch these.

## Anthropic API Key

The API key for experiment scripts (cognitive baseline, etc.) is in `.env` at the repo root.
**Do NOT set `ANTHROPIC_API_KEY` as a global Windows environment variable** — it conflicts
with Claude Code's subscription-based authentication.

Experiment scripts load the key from `.env` via dotenv or explicit file read:
```python
from pathlib import Path
env = dict(line.split('=', 1) for line in Path('.env').read_text().strip().splitlines()
           if '=' in line and not line.startswith('#'))
api_key = env['ANTHROPIC_API_KEY']
```

## Verification

Run before starting GPU-intensive experiments:

```bash
cd experiments/exp-slm
CUDA_VISIBLE_DEVICES=1 python ../verify-machine.py
```

Or from any experiment directory:
```bash
python experiments/verify-machine.py
```
