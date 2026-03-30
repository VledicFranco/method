#!/usr/bin/env bash
# =============================================================================
# Overnight experiment runner — R-09 + R-11
#
# Sequence:
#   Step 1  Augment corpus with stagnation patterns             (5 min, CPU)
#   Step 2  Export existing Qwen2.5-Coder-0.5B to ONNX (R-11) (20 min, GPU 0)
#   Step 3  Retrain Qwen on stagnation corpus (R-09)           (2-3h,  GPU 1)
#           [Steps 2 and 3 run in parallel on different GPUs]
#   Step 4  Benchmark R-11: existing Qwen ONNX vs baseline     (30 min)
#   Step 5  Export retrained stagnation model to ONNX          (20 min, GPU 0)
#   Step 6  Benchmark R-09+R-11: stagnation Qwen ONNX          (30 min)
#
# Prerequisites (do before sleeping):
#   1. Ollama running locally:  ollama serve  (or already running as a service)
#   2. Python venv:             experiments/exp-slm/.venv exists with deps
#   3. This script executable:  chmod +x run-overnight.sh
#
# Run from repo root:
#   bash experiments/exp-slm/run-overnight.sh 2>&1 | tee experiments/exp-slm/overnight.log
#
# Monitor progress tomorrow:
#   tail -50 experiments/exp-slm/overnight.log
#   cat experiments/exp-slm/overnight-logs/progress.log
# =============================================================================

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
EXP_DIR="$SCRIPT_DIR"
VENV="$EXP_DIR/.venv/Scripts/python.exe"
PHASE2="$EXP_DIR/phase-2-dsl"
PHASE3="$EXP_DIR/phase-3-training"
PHASE4="$EXP_DIR/phase-4-integration"
LOG_DIR="$EXP_DIR/overnight-logs"
RESULTS_DIR="$PHASE4/results"

mkdir -p "$LOG_DIR" "$RESULTS_DIR"

# ── Config ────────────────────────────────────────────────────
export OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:8b}"
export SLM_URL="${SLM_URL:-http://localhost:8100}"

QWEN_MODEL_DIR="$PHASE3/models/monitor-qwen25-coder-05b-lora"
QWEN_ONNX_DIR="$QWEN_MODEL_DIR/onnx"
STAGNATION_CONFIG="$PHASE3/configs/monitor-qwen25-coder-05b-lora-stagnation.yaml"
STAGNATION_MODEL_DIR="$PHASE3/models/monitor-qwen25-coder-05b-lora-stagnation"
STAGNATION_ONNX_DIR="$STAGNATION_MODEL_DIR/onnx"

# ── Helpers ───────────────────────────────────────────────────
log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_DIR/progress.log"; }
die() { log "FATAL: $*"; exit 1; }

wait_for_slm() {
    local max_wait=60
    local elapsed=0
    log "  Waiting for SLM server at $SLM_URL..."
    while true; do
        if curl -sf "$SLM_URL/health" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('model_loaded') else 1)" 2>/dev/null; then
            log "  SLM server ready."
            return 0
        fi
        sleep 2
        elapsed=$((elapsed + 2))
        if [ $elapsed -ge $max_wait ]; then
            die "SLM server did not become ready within ${max_wait}s"
        fi
    done
}

run_benchmark() {
    local run_name="$1"
    local slm_model_dir="$2"
    local output_suffix="$3"

    log "  Starting SLM server: $slm_model_dir/onnx"
    SLM_MODEL_DIR="$slm_model_dir/onnx" "$VENV" \
        "$PHASE4/scripts/serve-model.py" \
        >> "$LOG_DIR/serve-${run_name}.log" 2>&1 &
    local slm_pid=$!

    wait_for_slm

    log "  Running benchmark: $run_name"
    (
        cd "$REPO_ROOT"
        OLLAMA_URL="$OLLAMA_URL" \
        OLLAMA_MODEL="$OLLAMA_MODEL" \
        SLM_URL="$SLM_URL" \
        npx tsx "experiments/exp-slm/phase-4-integration/scripts/run-benchmark-live.ts" \
            2>&1 | tee "$LOG_DIR/benchmark-${run_name}.log"
    )

    # Copy results with suffix
    if [ -f "$RESULTS_DIR/integration-eval-live.json" ]; then
        cp "$RESULTS_DIR/integration-eval-live.json" "$RESULTS_DIR/integration-eval-live-${output_suffix}.json"
        log "  Results saved: integration-eval-live-${output_suffix}.json"
    fi
    if [ -f "$RESULTS_DIR/live-traces.jsonl" ]; then
        cp "$RESULTS_DIR/live-traces.jsonl" "$RESULTS_DIR/live-traces-${output_suffix}.jsonl"
    fi

    log "  Stopping SLM server (pid $slm_pid)"
    kill "$slm_pid" 2>/dev/null || true
    sleep 2
}

# =============================================================================
log "============================================================"
log " Overnight experiments — R-09 + R-11"
log " OLLAMA: $OLLAMA_URL  MODEL: $OLLAMA_MODEL"
log "============================================================"

# ── Preflight checks ──────────────────────────────────────────
log "Preflight checks..."
[ -f "$VENV" ] || die "Python venv not found at $VENV"
[ -d "$QWEN_MODEL_DIR" ] || die "Qwen model not found at $QWEN_MODEL_DIR"
[ -f "$STAGNATION_CONFIG" ] || die "Stagnation config not found at $STAGNATION_CONFIG"

if ! curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
    die "Ollama not reachable at $OLLAMA_URL — start it with: ollama serve"
fi
log "  Ollama OK"
log "  Venv OK"
log "  Model OK"

# ── Step 1: Augment corpus ────────────────────────────────────
log ""
log "=== STEP 1: Augment corpus with stagnation patterns ==="
"$VENV" "$PHASE2/scripts/augment-corpus-stagnation.py" \
    2>&1 | tee "$LOG_DIR/01-augment.log"
log "Step 1 complete."

# ── Steps 2 + 3: Parallel GPU work ───────────────────────────
log ""
log "=== STEP 2+3: Export Qwen ONNX (GPU 0) + Retrain (GPU 1) — PARALLEL ==="

# Step 2: Export existing Qwen to ONNX on GPU 0
log "  Starting: export existing Qwen ONNX on GPU 0..."
(
    CUDA_VISIBLE_DEVICES=0 "$VENV" \
        "$PHASE3/scripts/export-onnx.py" \
        --model-dir "$QWEN_MODEL_DIR" \
        2>&1 | tee "$LOG_DIR/02-export-r11.log"
    echo "EXPORT_DONE" >> "$LOG_DIR/progress.log"
) &
EXPORT_PID=$!

# Step 3: Retrain on stagnation corpus on GPU 1
log "  Starting: retrain on stagnation corpus on GPU 1..."
(
    cd "$EXP_DIR"
    CUDA_VISIBLE_DEVICES=1 "$VENV" \
        "$PHASE3/scripts/train.py" \
        --config "$STAGNATION_CONFIG" \
        2>&1 | tee "$LOG_DIR/03-train-r09.log"
    echo "TRAIN_DONE" >> "$LOG_DIR/progress.log"
) &
TRAIN_PID=$!

log "  Export PID: $EXPORT_PID  |  Train PID: $TRAIN_PID"
log "  Waiting for export to complete (training continues in background)..."

# ── Step 4: Benchmark R-11 (once export is done) ─────────────
wait "$EXPORT_PID"
EXPORT_EXIT=$?
if [ $EXPORT_EXIT -ne 0 ]; then
    log "WARNING: ONNX export failed (exit $EXPORT_EXIT). Skipping R-11 benchmark."
    log "         Check $LOG_DIR/02-export-r11.log for details."
else
    log ""
    log "=== STEP 4: Benchmark R-11 (existing Qwen ONNX vs baseline) ==="
    run_benchmark "r11-qwen-base" "$QWEN_MODEL_DIR" "r11-qwen-base"
    log "Step 4 complete."
fi

# ── Step 5: Wait for retrain, then export ────────────────────
log ""
log "=== STEP 5: Waiting for retrain to complete (GPU 1)... ==="
wait "$TRAIN_PID"
TRAIN_EXIT=$?
if [ $TRAIN_EXIT -ne 0 ]; then
    die "Retrain failed (exit $TRAIN_EXIT). Check $LOG_DIR/03-train-r09.log"
fi
log "Retrain complete."

log ""
log "=== STEP 5b: Export retrained stagnation model to ONNX ==="
CUDA_VISIBLE_DEVICES=0 "$VENV" \
    "$PHASE3/scripts/export-onnx.py" \
    --model-dir "$STAGNATION_MODEL_DIR" \
    2>&1 | tee "$LOG_DIR/05-export-r09.log"
log "Stagnation ONNX export complete."

# ── Step 6: Benchmark R-09+R-11 ──────────────────────────────
log ""
log "=== STEP 6: Benchmark R-09 (stagnation-trained Qwen ONNX) ==="
run_benchmark "r09-qwen-stagnation" "$STAGNATION_MODEL_DIR" "r09-qwen-stagnation"
log "Step 6 complete."

# ── Done ─────────────────────────────────────────────────────
log ""
log "============================================================"
log " ALL STEPS COMPLETE"
log " Results:"
log "   R-11 (base Qwen ONNX):       $RESULTS_DIR/integration-eval-live-r11-qwen-base.json"
log "   R-09 (stagnation Qwen ONNX): $RESULTS_DIR/integration-eval-live-r09-qwen-stagnation.json"
log "   Training log:                $LOG_DIR/03-train-r09.log"
log "   Full progress:               $LOG_DIR/progress.log"
log "============================================================"
