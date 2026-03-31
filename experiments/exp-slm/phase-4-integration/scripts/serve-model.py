"""
Phase 4 — SLM Inference HTTP Bridge.

Loads the trained ONNX model from phase-3-training and serves it via FastAPI.
Uses optimum's ORTModelForCausalLM which handles KV cache and autoregressive
generation automatically — no manual past_key_values management needed.

Usage:
    python experiments/exp-slm/phase-4-integration/scripts/serve-model.py

    Override model directory:
    SLM_MODEL_DIR=path/to/model python serve-model.py

Server runs on http://localhost:8100 with two endpoints:
    POST /generate  — run inference
    GET  /health    — liveness check
"""

from __future__ import annotations

import os
import time
import logging
from pathlib import Path
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# ── Config ──────────────────────────────────────────────────────

MODEL_DIR = Path(os.environ.get("SLM_MODEL_DIR", str(
    Path(__file__).resolve().parent.parent.parent
    / "phase-3-training" / "models" / "monitor-smollm2-135m-run3" / "onnx"
)))
HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8100"))

logger = logging.getLogger("slm-bridge")

# ── Global Model + Tokenizer ──────────────────────────────────

model = None
tokenizer = None


def load_model():
    """Load the ONNX model using optimum's ORTModelForCausalLM."""
    from optimum.onnxruntime import ORTModelForCausalLM
    from transformers import AutoTokenizer

    model_path = str(MODEL_DIR)
    onnx_file = MODEL_DIR / "model.onnx"
    if not onnx_file.exists():
        raise FileNotFoundError(
            f"ONNX model not found at {onnx_file}. "
            f"Run 'make phase-3' to train and export the model first."
        )

    # GPU inference requires re-exporting ONNX on the target GPU architecture.
    # Models exported on RTX 4090 (Ada/sm_89) fail on RTX 2080 Ti (Turing/sm_75).
    # Use SLM_PROVIDER env var to override, default CPU.
    import onnxruntime
    provider = os.environ.get("SLM_PROVIDER", "CPUExecutionProvider")
    if provider not in onnxruntime.get_available_providers():
        provider = "CPUExecutionProvider"
    logger.info("Loading ONNX model from %s (provider: %s)", model_path, provider)
    ort_model = ORTModelForCausalLM.from_pretrained(
        model_path,
        provider=provider,
    )
    tok = AutoTokenizer.from_pretrained(model_path)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    logger.info("Model loaded successfully.")
    return ort_model, tok


# ── Request / Response Models ───────────────────────────────────

class GenerateRequest(BaseModel):
    input: str
    max_length: int = 256


class GenerateResponse(BaseModel):
    output: str
    confidence: float
    input_tokens: int
    output_tokens: int
    latency_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_path: str


# ── App ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup, clean up on shutdown."""
    global model, tokenizer
    try:
        model, tokenizer = load_model()
        logger.info("SLM bridge ready on http://%s:%d", HOST, PORT)
    except (FileNotFoundError, Exception) as exc:
        logger.warning("Model load failed — server will start but /generate will return 503. %s", exc)
    yield
    model = None
    tokenizer = None
    logger.info("SLM bridge shut down.")


app = FastAPI(
    title="SLM Inference Bridge",
    description="HTTP bridge for ONNX SLM inference, called by TypeScript integration layer.",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health():
    """Liveness check."""
    return HealthResponse(
        status="ok" if model is not None else "no_model",
        model_loaded=model is not None,
        model_path=str(MODEL_DIR / "model.onnx"),
    )


@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    """Run SLM inference on the input text."""
    if model is None or tokenizer is None:
        raise HTTPException(
            status_code=503,
            detail="ONNX model not loaded. Check server logs.",
        )

    start = time.perf_counter()

    try:
        # Apply chat template (model was SFT'd with chat format)
        messages = [{"role": "user", "content": req.input}]
        templated = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )

        # Tokenize the templated text
        encoded = tokenizer(
            templated,
            return_tensors="np",
            truncation=True,
            max_length=req.max_length,
        )
        input_ids = encoded["input_ids"]
        input_token_count = int(input_ids.shape[1])

        # Generate with optimum (handles KV cache automatically)
        import torch
        with torch.no_grad():
            gen_ids = model.generate(
                **{k: torch.from_numpy(v) for k, v in encoded.items()},
                max_new_tokens=req.max_length,
                do_sample=False,
                temperature=1.0,
            )

        # Extract only the new tokens (skip the input prefix)
        new_ids = gen_ids[0, input_token_count:]
        output_text = tokenizer.decode(new_ids, skip_special_tokens=True).strip()
        output_token_count = len(new_ids)

        # Compute confidence from generation logits
        # Use a forward pass on the generated sequence to get logits
        full_ids = gen_ids[:, :input_token_count + output_token_count]
        forward_out = model(
            input_ids=full_ids,
            attention_mask=torch.ones_like(full_ids),
        )
        logits = forward_out.logits[0].detach().numpy()  # [seq_len, vocab_size]

        # Confidence = mean max softmax prob over generated tokens
        gen_logits = logits[input_token_count - 1:-1]  # logits predicting generated tokens
        if len(gen_logits) > 0:
            exp_l = np.exp(gen_logits - np.max(gen_logits, axis=-1, keepdims=True))
            softmax = exp_l / np.sum(exp_l, axis=-1, keepdims=True)
            max_probs = np.max(softmax, axis=-1)
            confidence = float(np.mean(max_probs))
        else:
            confidence = 0.0

    except Exception as exc:
        logger.error("Inference error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    elapsed_ms = (time.perf_counter() - start) * 1000

    return GenerateResponse(
        output=output_text,
        confidence=round(confidence, 4),
        input_tokens=input_token_count,
        output_tokens=output_token_count,
        latency_ms=round(elapsed_ms, 2),
    )


# ── Entrypoint ──────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    uvicorn.run(
        "serve-model:app",
        host=HOST,
        port=PORT,
        log_level="info",
        reload=False,
    )
