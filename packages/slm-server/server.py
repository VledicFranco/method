"""
SLM Serving Service — OpenAI-compatible API for custom small language models.

Serves multiple fine-tuned SLMs from a model registry directory. Each model
is a HuggingFace checkpoint (PyTorch) loaded on-demand and cached in memory.

Exposes:
  GET  /v1/models          — list available models + metadata
  POST /v1/chat/completions — OpenAI-compatible inference
  GET  /health              — health check

Compatible with the existing Ollama provider in the bridge — just change the base URL.
"""

import os
import sys
import json
import time
import logging
from pathlib import Path
from typing import Optional

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from transformers import AutoTokenizer, AutoModelForCausalLM

# ── Configuration ────────────────────────────────────────────────

MODEL_REGISTRY_DIR = os.environ.get("SLM_REGISTRY", str(Path(__file__).parent / "models"))
PORT = int(os.environ.get("SLM_PORT", "11435"))
DEVICE = os.environ.get("SLM_DEVICE", "cpu")  # "cpu", "cuda:0", "cuda:1"
MAX_LOADED_MODELS = int(os.environ.get("SLM_MAX_LOADED", "3"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("slm-server")

# ── App ──────────────────────────────────────────────────────────

app = FastAPI(title="SLM Serving Service", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Model Cache ──────────────────────────────────────────────────

loaded_models: dict[str, dict] = {}  # name -> { model, tokenizer, metadata, loaded_at }


def discover_models() -> list[dict]:
    """Scan the registry directory for model checkpoints."""
    registry = Path(MODEL_REGISTRY_DIR)
    if not registry.exists():
        return []

    models = []
    for entry in sorted(registry.iterdir()):
        if not entry.is_dir():
            continue
        # Check for HuggingFace checkpoint markers
        has_config = (entry / "config.json").exists()
        has_model = (entry / "model.safetensors").exists() or (entry / "pytorch_model.bin").exists()
        if has_config and has_model:
            # Read metadata if available
            meta_path = entry / "slm-meta.json"
            meta = {}
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text())
                except Exception:
                    pass
            models.append({
                "name": entry.name,
                "path": str(entry),
                "task": meta.get("task", "general"),
                "description": meta.get("description", ""),
                "parameters": meta.get("parameters", "unknown"),
                "base_model": meta.get("base_model", "unknown"),
            })

    return models


def load_model(name: str) -> dict:
    """Load a model into memory, evicting LRU if at capacity."""
    if name in loaded_models:
        loaded_models[name]["last_used"] = time.time()
        return loaded_models[name]

    registry = Path(MODEL_REGISTRY_DIR) / name
    if not registry.exists():
        raise HTTPException(404, f"Model '{name}' not found in registry")

    # Evict LRU if at capacity
    if len(loaded_models) >= MAX_LOADED_MODELS:
        oldest = min(loaded_models, key=lambda k: loaded_models[k]["last_used"])
        log.info(f"Evicting model '{oldest}' (LRU)")
        del loaded_models[oldest]
        torch.cuda.empty_cache() if DEVICE.startswith("cuda") else None

    log.info(f"Loading model '{name}' on {DEVICE}...")
    t0 = time.time()

    tokenizer = AutoTokenizer.from_pretrained(str(registry), trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        str(registry),
        torch_dtype=torch.float16 if DEVICE.startswith("cuda") else torch.float32,
        device_map=DEVICE if DEVICE.startswith("cuda") else None,
        trust_remote_code=True,
    )
    if not DEVICE.startswith("cuda"):
        model = model.to(DEVICE)
    model.eval()

    # Ensure pad token
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    dt = time.time() - t0
    log.info(f"Model '{name}' loaded in {dt:.1f}s ({sum(p.numel() for p in model.parameters()) / 1e6:.0f}M params)")

    entry = {
        "model": model,
        "tokenizer": tokenizer,
        "loaded_at": time.time(),
        "last_used": time.time(),
        "load_time_s": dt,
    }
    loaded_models[name] = entry
    return entry


# ── Request/Response Models ──────────────────────────────────────

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    max_tokens: Optional[int] = Field(default=512)
    temperature: Optional[float] = Field(default=0.1)
    stream: Optional[bool] = Field(default=False)

class Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int

class Choice(BaseModel):
    index: int = 0
    message: ChatMessage
    finish_reason: str = "stop"

class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[Choice]
    usage: Usage


# ── Endpoints ────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "loaded_models": list(loaded_models.keys()),
        "registry_models": [m["name"] for m in discover_models()],
    }


@app.get("/v1/models")
async def list_models():
    """OpenAI-compatible model listing + SLM metadata."""
    discovered = discover_models()
    return {
        "object": "list",
        "data": [
            {
                "id": m["name"],
                "object": "model",
                "created": 0,
                "owned_by": "slm-server",
                # SLM-specific metadata
                "task": m.get("task", "general"),
                "description": m.get("description", ""),
                "parameters": m.get("parameters", "unknown"),
                "base_model": m.get("base_model", "unknown"),
                "loaded": m["name"] in loaded_models,
            }
            for m in discovered
        ],
    }


# Ollama-compatible /api/tags endpoint (so our bridge auto-discovery works)
@app.get("/api/tags")
async def ollama_tags():
    """Ollama-compatible model listing for bridge auto-discovery."""
    discovered = discover_models()
    return {
        "models": [
            {
                "name": m["name"],
                "model": m["name"],
                "modified_at": "",
                "size": 0,
                "details": {
                    "parameter_size": m.get("parameters", "unknown"),
                    "family": "slm",
                    "format": "pytorch",
                },
            }
            for m in discovered
        ]
    }


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest):
    """OpenAI-compatible chat completion endpoint."""
    if req.stream:
        raise HTTPException(400, "Streaming not supported yet")

    # Load model (cached after first load)
    try:
        entry = load_model(req.model)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to load model '{req.model}': {e}")

    model = entry["model"]
    tokenizer = entry["tokenizer"]

    # Build prompt from messages
    prompt_parts = []
    for msg in req.messages:
        if msg.role == "system":
            prompt_parts.append(f"System: {msg.content}")
        elif msg.role == "user":
            prompt_parts.append(f"User: {msg.content}")
        elif msg.role == "assistant":
            prompt_parts.append(f"Assistant: {msg.content}")
    prompt_parts.append("Assistant:")
    prompt = "\n".join(prompt_parts)

    # Tokenize
    inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
    inputs = {k: v.to(model.device) for k, v in inputs.items()}
    input_len = inputs["input_ids"].shape[1]

    # Generate
    t0 = time.time()
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=req.max_tokens or 512,
            temperature=max(req.temperature or 0.1, 0.01),  # avoid div-by-zero
            do_sample=req.temperature and req.temperature > 0,
            pad_token_id=tokenizer.pad_token_id,
        )
    dt = time.time() - t0

    # Decode only new tokens
    new_tokens = outputs[0][input_len:]
    output_text = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()
    output_len = len(new_tokens)

    log.info(f"[{req.model}] {input_len} in, {output_len} out, {dt:.2f}s")

    return ChatCompletionResponse(
        id=f"slm-{int(time.time()*1000)}",
        created=int(time.time()),
        model=req.model,
        choices=[Choice(message=ChatMessage(role="assistant", content=output_text))],
        usage=Usage(
            prompt_tokens=input_len,
            completion_tokens=output_len,
            total_tokens=input_len + output_len,
        ),
    )


# ── Main ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info(f"SLM Server starting on port {PORT}")
    log.info(f"Device: {DEVICE}")
    log.info(f"Registry: {MODEL_REGISTRY_DIR}")
    log.info(f"Max loaded models: {MAX_LOADED_MODELS}")

    discovered = discover_models()
    if discovered:
        log.info(f"Found {len(discovered)} model(s):")
        for m in discovered:
            log.info(f"  - {m['name']} ({m['parameters']}) — {m['task']}: {m['description']}")
    else:
        log.info("No models found in registry. Add checkpoints to: " + MODEL_REGISTRY_DIR)

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
