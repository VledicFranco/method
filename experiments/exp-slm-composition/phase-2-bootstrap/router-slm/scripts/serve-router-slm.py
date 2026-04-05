"""
Router SLM HTTP Server

Serves the Router SLM (PRD 052) via FastAPI. Loads the merged LoRA model
directly with transformers (no ONNX conversion needed).

Usage:
    python experiments/exp-slm-composition/phase-2-bootstrap/router-slm/scripts/serve-router-slm.py

    Override port:
    PORT=8101 python serve-router-slm.py

Server runs on http://0.0.0.0:8101 with two endpoints:
    POST /generate  — classify task description (input: task string → output: "flat" | "unified-memory")
    GET  /health    — liveness check

Request format:
    POST /generate
    { "input": "<task>Fix the discount calculation bug in src/pricing.ts</task>", "max_length": 32 }

Response:
    { "output": "flat", "confidence": 0.95, "input_tokens": 15, "output_tokens": 1, "latency_ms": 23.5 }
"""

from __future__ import annotations

import os
import time
import logging
from pathlib import Path
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# ── Config ──────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
MODEL_DIR = Path(os.environ.get("ROUTER_MODEL_DIR", str(
    SCRIPT_DIR.parent / "models" / "router-slm-qwen25-05b-lora"
)))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8101"))

logger = logging.getLogger("router-slm")

# ── Global Model + Tokenizer ──────────────────────────────────

model = None
tokenizer = None
device = None


def load_model():
    """Load the merged HuggingFace model with transformers."""
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not MODEL_DIR.exists():
        raise FileNotFoundError(
            f"Router SLM model not found at {MODEL_DIR}. "
            f"Train the model first: python phase-3-training/scripts/train.py --config "
            f"experiments/exp-slm-composition/phase-2-bootstrap/router-slm/configs/router-slm-qwen25-05b-lora.yaml"
        )

    logger.info("Loading Router SLM from %s", MODEL_DIR)

    tok = AutoTokenizer.from_pretrained(str(MODEL_DIR))
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info("Device: %s", dev)

    mdl = AutoModelForCausalLM.from_pretrained(
        str(MODEL_DIR),
        dtype=torch.float16 if dev.type == "cuda" else torch.float32,
    ).to(dev)
    mdl.eval()

    param_count = sum(p.numel() for p in mdl.parameters())
    logger.info("Model loaded — %.1fM params", param_count / 1e6)

    return mdl, tok, dev


# ── Request / Response Models ───────────────────────────────────

class GenerateRequest(BaseModel):
    input: str
    max_length: int = 32  # router output is short — "flat" or "unified-memory"


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
    device: str


# ── App ─────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model, tokenizer, device
    try:
        model, tokenizer, device = load_model()
        logger.info("Router SLM server ready on http://%s:%d", HOST, PORT)
    except Exception as exc:
        logger.error("Model load failed: %s", exc)
        logger.warning("Server will start but /generate will return 503")
    yield
    model = None
    tokenizer = None
    logger.info("Router SLM server shut down.")


app = FastAPI(
    title="Router SLM Server",
    description="HTTP server for PRD 052 Router SLM (task → architecture classifier)",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok" if model is not None else "no_model",
        model_loaded=model is not None,
        model_path=str(MODEL_DIR),
        device=str(device) if device is not None else "none",
    )


@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    if model is None or tokenizer is None:
        raise HTTPException(
            status_code=503,
            detail="Router SLM not loaded. Check server logs.",
        )

    start = time.perf_counter()

    try:
        # Apply chat template (model was trained with chat format)
        messages = [{"role": "user", "content": req.input}]
        input_ids = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, return_tensors="pt"
        ).to(device)
        input_token_count = int(input_ids.shape[1])

        with torch.no_grad():
            output_ids = model.generate(
                input_ids,
                max_new_tokens=req.max_length,
                do_sample=False,
                temperature=1.0,
                pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
                output_scores=True,
                return_dict_in_generate=True,
            )

        # Extract only new tokens
        new_ids = output_ids.sequences[0, input_token_count:]
        output_text = tokenizer.decode(new_ids, skip_special_tokens=True).strip()
        output_token_count = len(new_ids)

        # Compute confidence from generation scores (mean max softmax probability)
        if output_ids.scores:
            confidences = []
            for score in output_ids.scores:
                probs = torch.softmax(score[0], dim=-1)
                confidences.append(probs.max().item())
            confidence = float(sum(confidences) / len(confidences)) if confidences else 0.0
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
        app,
        host=HOST,
        port=PORT,
        log_level="info",
    )
