PYTHON ?= python
VENV := .venv
PIP := $(VENV)/Scripts/pip
PYTHON_VENV := $(VENV)/Scripts/python
TSX := npx tsx
CUDA_DEVICE ?= 1

.PHONY: setup phase-0 phase-1 phase-2 phase-3 phase-4 clean

# ── Setup ──────────────────────────────────────────────────────────

setup: setup-python setup-node

setup-python:
	$(PYTHON) -m venv $(VENV)
	$(PIP) install -e ".[dev]"

setup-node:
	npm install

# ── Phases ─────────────────────────────────────────────────────────

phase-0: phase-0-gpu phase-0-sft phase-0-inference

phase-0-gpu:
	CUDA_VISIBLE_DEVICES=$(CUDA_DEVICE) $(PYTHON_VENV) phase-0-infra/scripts/smoke-test-gpu.py

phase-0-sft:
	CUDA_VISIBLE_DEVICES=$(CUDA_DEVICE) $(PYTHON_VENV) phase-0-infra/scripts/smoke-test-sft.py

phase-0-inference:
	$(TSX) phase-0-infra/scripts/smoke-test-inference.ts

phase-1:
	$(TSX) phase-1-llm-monitor/scripts/collect-traces.ts
	$(TSX) phase-1-llm-monitor/scripts/measure-baseline.ts

phase-2: phase-2-dsl phase-2-corpus phase-2-validate phase-2-augment

phase-2-dsl:
	$(PYTHON_VENV) phase-2-dsl/scripts/design-dsl.py

phase-2-corpus:
	$(PYTHON_VENV) phase-2-dsl/scripts/generate-corpus.py

phase-2-validate:
	$(PYTHON_VENV) phase-2-dsl/scripts/validate-corpus.py

phase-2-augment:
	$(PYTHON_VENV) phase-2-dsl/scripts/augment-corpus.py

phase-3: phase-3-train phase-3-evaluate phase-3-calibrate phase-3-export

phase-3-train:
	CUDA_VISIBLE_DEVICES=$(CUDA_DEVICE) $(PYTHON_VENV) phase-3-training/scripts/train.py

phase-3-evaluate:
	CUDA_VISIBLE_DEVICES=$(CUDA_DEVICE) $(PYTHON_VENV) phase-3-training/scripts/evaluate.py

phase-3-calibrate:
	$(PYTHON_VENV) phase-3-training/scripts/calibrate.py

phase-3-export:
	$(PYTHON_VENV) phase-3-training/scripts/export-onnx.py

phase-4:
	$(TSX) phase-4-integration/scripts/run-benchmark.ts
	$(TSX) phase-4-integration/scripts/compare-baseline.ts

# ── Cleanup ────────────────────────────────────────────────────────

clean:
	rm -rf $(VENV) dist node_modules phase-3-training/models/*.onnx phase-3-training/models/*.gguf
