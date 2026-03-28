"""
Phase 4 — SLM Inference HTTP Bridge.

Loads the trained ONNX model from phase-3-training and serves it via FastAPI.
This replaces the failed onnxruntime-node path — TypeScript calls this server
via HTTP to run ONNX inference.

Usage:
    python experiments/exp-slm/phase-4-integration/scripts/serve-model.py

Server runs on http://localhost:8100 with two endpoints:
    POST /generate  — run inference
    GET  /health    — liveness check
"""

from __future__ import annotations

import time
import logging
from pathlib import Path
from contextlib import asynccontextmanager

import numpy as np
import onnxruntime as ort
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# ── Config ──────────────────────────────────────────────────────

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / "phase-3-training" / "models" / "monitor-smollm2-135m"
MODEL_PATH = MODEL_DIR / "model.onnx"
HOST = "0.0.0.0"
PORT = 8100

logger = logging.getLogger("slm-bridge")

# ── Global Session ──────────────────────────────────────────────

ort_session: ort.InferenceSession | None = None


def load_model() -> ort.InferenceSession:
    """Load the ONNX model into an ORT inference session."""
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"ONNX model not found at {MODEL_PATH}. "
            f"Run 'make phase-3' to train and export the model first."
        )
    logger.info("Loading ONNX model from %s", MODEL_PATH)
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.intra_op_num_threads = 4
    session = ort.InferenceSession(str(MODEL_PATH), opts, providers=["CPUExecutionProvider"])
    logger.info("Model loaded. Inputs: %s, Outputs: %s",
                [i.name for i in session.get_inputs()],
                [o.name for o in session.get_outputs()])
    return session


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
    global ort_session
    try:
        ort_session = load_model()
        logger.info("SLM bridge ready on http://%s:%d", HOST, PORT)
    except FileNotFoundError as exc:
        logger.warning("Model not found — server will start but /generate will return 503. %s", exc)
    yield
    # Cleanup
    ort_session = None
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
        status="ok" if ort_session is not None else "no_model",
        model_loaded=ort_session is not None,
        model_path=str(MODEL_PATH),
    )


@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    """Run SLM inference on the input text."""
    if ort_session is None:
        raise HTTPException(
            status_code=503,
            detail="ONNX model not loaded. Run 'make phase-3' to train and export first.",
        )

    start = time.perf_counter()

    try:
        # Tokenize input (simplified — real impl would use the model's tokenizer)
        # For the ONNX model exported from HuggingFace, input is token IDs.
        # This is a placeholder that works with the exported model's expected inputs.
        input_ids = tokenize(req.input, req.max_length)
        attention_mask = np.ones_like(input_ids)

        # Run inference
        outputs = ort_session.run(
            None,
            {
                "input_ids": input_ids,
                "attention_mask": attention_mask,
            },
        )

        # Decode output logits to text
        output_text, confidence = decode_output(outputs, input_ids)
        input_token_count = int(input_ids.shape[1])
        output_token_count = len(output_text.split())  # Rough estimate

    except Exception as exc:
        logger.error("Inference error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    elapsed_ms = (time.perf_counter() - start) * 1000

    return GenerateResponse(
        output=output_text,
        confidence=confidence,
        input_tokens=input_token_count,
        output_tokens=output_token_count,
        latency_ms=round(elapsed_ms, 2),
    )


# ── Tokenization Helpers ────────────────────────────────────────

def tokenize(text: str, max_length: int) -> np.ndarray:
    """
    Simple character-level tokenization as a fallback.

    In production, this would use the model's actual tokenizer
    (e.g., AutoTokenizer from transformers). For the ONNX bridge,
    the tokenizer should match what was used during training.
    """
    try:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
        encoded = tokenizer(text, return_tensors="np", max_length=max_length, truncation=True, padding="max_length")
        return encoded["input_ids"]
    except ImportError:
        # Fallback: simple byte encoding (will produce garbage output,
        # but allows the server to start for integration testing)
        logger.warning("transformers not installed — using fallback byte tokenization")
        token_ids = [ord(c) % 32000 for c in text[:max_length]]
        # Pad to max_length
        while len(token_ids) < max_length:
            token_ids.append(0)
        return np.array([token_ids], dtype=np.int64)


def decode_output(outputs: list, input_ids: np.ndarray) -> tuple[str, float]:
    """
    Decode model outputs (logits) to text and compute confidence.

    The ONNX model outputs logits of shape [batch, seq_len, vocab_size].
    We take argmax to get predicted token IDs, then decode.
    """
    logits = outputs[0]  # shape: [batch, seq_len, vocab_size]

    # Get predicted tokens via argmax
    predicted_ids = np.argmax(logits, axis=-1)  # [batch, seq_len]

    # Compute confidence as mean of max softmax probs
    # (length-normalized sequence log-probability approximation)
    exp_logits = np.exp(logits - np.max(logits, axis=-1, keepdims=True))
    softmax = exp_logits / np.sum(exp_logits, axis=-1, keepdims=True)
    max_probs = np.max(softmax, axis=-1)  # [batch, seq_len]
    # Average confidence across non-padding positions
    input_len = int(np.sum(input_ids[0] != 0))
    if input_len > 0:
        confidence = float(np.mean(max_probs[0, :input_len]))
    else:
        confidence = 0.0

    # Decode predicted IDs back to text
    try:
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
        text = tokenizer.decode(predicted_ids[0], skip_special_tokens=True)
    except ImportError:
        # Fallback: just convert token IDs to chars
        text = "".join(chr(max(32, t % 128)) for t in predicted_ids[0] if t != 0)

    return text.strip(), round(confidence, 4)


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
