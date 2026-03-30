# SLM Serving Service

OpenAI-compatible API for custom small language models. Serves multiple fine-tuned SLMs from a model registry directory.

## Quick Start

```bash
# Install deps
pip install fastapi uvicorn transformers torch

# Download a test model (SmolLM2-135M)
python download-test-model.py

# Start server (port 11436, CPU)
python server.py

# Or with options
SLM_PORT=11436 SLM_DEVICE=cuda:0 SLM_REGISTRY=./models python server.py
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check + loaded/registry model lists |
| `GET /v1/models` | OpenAI-compatible model listing with SLM metadata |
| `GET /api/tags` | Ollama-compatible model listing (for bridge auto-discovery) |
| `POST /v1/chat/completions` | OpenAI-compatible inference |

## Model Registry

Drop HuggingFace checkpoints into `models/`:

```
models/
  monitor-v1/
    config.json
    model.safetensors
    tokenizer.json
    slm-meta.json        # optional — task, description, parameters, base_model
  evaluator-v1/
    ...
```

Models are loaded on-demand and cached (LRU eviction at `SLM_MAX_LOADED`).

## Using with Bridge

The SLM server is compatible with the Ollama provider — just change the base URL:

```
Spawn Modal → LLM Provider: Ollama → Base URL: http://localhost:11436
```

The bridge will auto-discover available models via `/api/tags`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SLM_PORT` | 11436 | Server port |
| `SLM_DEVICE` | cpu | PyTorch device (`cpu`, `cuda:0`, `cuda:1`) |
| `SLM_REGISTRY` | `./models` | Path to model registry directory |
| `SLM_MAX_LOADED` | 3 | Max models loaded simultaneously |
