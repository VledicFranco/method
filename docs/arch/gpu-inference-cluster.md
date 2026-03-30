# GPU Inference Cluster — Local Model Serving

Heterogeneous inference setup for running open-source models alongside Claude API, supporting the RFC 002 SLM compilation strategy and cognitive module architecture.

## Machines

| Hostname | Tailscale IP | OS | GPU | VRAM | Role |
|----------|-------------|-----|-----|------|------|
| `mission-control` | 100.114.69.42 | Windows 11 | 2× RTX 2080 Ti | 11 GB each | Development, bridge host, SLM ONNX inference |
| `chobits` | 100.105.248.35 | Windows 11 | RTX 4090 | 23 GB | Primary inference server (Ollama) |
| `silky` | 100.104.1.107 | Linux (DO) | — | — | PostgreSQL, auxiliary services |

All machines are on the `emu-cosmological.ts.net` Tailscale mesh. Traffic is WireGuard-encrypted, no public internet exposure.

## Ollama on Chobits

**Version:** 0.18.3
**API:** `http://chobits:11434` (OpenAI-compatible at `/v1/chat/completions`)
**Models:** `qwen3-coder:30b` (Q4_K_M, 18.5 GB)

### Access

```bash
# SSH (key-based auth, personal ed25519 key)
ssh atfm0@chobits

# GPU status
ssh atfm0@chobits "nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free,temperature.gpu --format=csv"

# Model list
curl http://chobits:11434/api/tags

# Running models
curl http://chobits:11434/api/ps

# Pull a new model
ssh atfm0@chobits "ollama pull <model>"
# or via API: curl http://chobits:11434/api/pull -d '{"name":"<model>"}'
```

### Ollama Persistence

Ollama is configured as a Windows scheduled task (`OllamaServe`) that runs as SYSTEM on boot:

```
Task: OllamaServe
Binary: C:\Users\atfm0\AppData\Local\Programs\Ollama\ollama.exe serve
Run as: SYSTEM
Trigger: On system startup
Time limit: Unlimited
OLLAMA_HOST: 0.0.0.0:11434 (system env var — binds all interfaces for Tailscale)
OLLAMA_MODELS: C:\Users\atfm0\.ollama\models\ (system env var — shares user's downloaded models with SYSTEM)
```

This means Ollama **survives user sign-out** and starts automatically on reboot. The desktop tray app may also run when a user is logged in — both coexist (the tray app connects to the serve process).

```bash
# Check if Ollama is responding
curl -s http://chobits:11434/api/version

# Manage the scheduled task
ssh atfm0@chobits "schtasks /Query /TN OllamaServe /V /FO LIST"
ssh atfm0@chobits "schtasks /Run /TN OllamaServe"    # start manually
ssh atfm0@chobits "schtasks /End /TN OllamaServe"    # stop
```

## Provider Package

`@method/pacta-provider-ollama` — AgentProvider implementation using the OpenAI-compatible API.

```typescript
import { ollamaProvider } from '@method/pacta-provider-ollama';

const provider = ollamaProvider({ baseUrl: 'http://chobits:11434' });
await provider.init();  // discovers available models
```

**Location:** `packages/pacta-provider-ollama/`
**Tests:** `npm run test` (unit), integration tests require live Ollama (`SKIP_INTEGRATION=1` to skip)

### Performance Profile (Qwen3-Coder 30B on RTX 4090)

| Scenario | Latency | Notes |
|----------|---------|-------|
| Cold start (model load) | ~5s | First call loads model into VRAM |
| Monitor module prompt | ~600ms | Structured JSON anomaly detection |
| Observer module prompt | ~880ms | Environment processing + fact extraction |
| Simple structured output | ~940ms | After model is warm |

### Integration with Cognitive Modules

The provider implements `AgentProvider` and plugs into `createProviderAdapter()`:

```typescript
import { ollamaProvider } from '@method/pacta-provider-ollama';
import { createProviderAdapter } from '@method/pacta';

const ollama = ollamaProvider({ baseUrl: 'http://chobits:11434' });
const adapter = createProviderAdapter(ollama, {
  pactTemplate: { mode: { type: 'oneshot' } },
  systemPrompt: 'You are a cognitive monitor module...',
});
```

For the SLM escalation pattern (RFC 002), wrap with `SLMProviderAdapter` from `experiments/exp-slm/phase-4-integration/`.

## Inference Strategy (RFC 002)

```
Cognitive Cycle
  ├─ Monitor, Observer, Evaluator → Ollama (chobits) or ONNX SLM (local) → $0
  ├─ Reasoner, Planner            → Claude API (Anthropic)               → $$
  └─ Fallback (low confidence)    → Claude API (Anthropic)
```

- **Routine modules** (Monitor, Observer, Evaluator): local inference via Ollama or compiled SLMs
- **Reasoning modules** (Reasoner, Planner): frontier LLM (Claude) — poor SLM compilation candidates
- **Escalation**: SLMProviderAdapter routes to Claude when confidence is below threshold

## SLM Training on Chobits

Chobits is also the primary SLM **training** host for the `exp-slm` experiment (RFC 002, PRD 034). Training runs on the RTX 4090 via SSH — no physical access required.

### Environment

```
Python:   C:\Users\atfm0\miniconda3\envs\slm\python.exe  (3.11, PyTorch 2.5.1+cu121)
Repo:     C:\Users\atfm0\pv-method\  (git clone of VledicFranco/method)
CUDA dev: 0  (RTX 4090 is the only GPU — CUDA_VISIBLE_DEVICES=0)
```

### Running Training via SSH

```bash
# Single training run (specify config with --config, or use default)
ssh chobits "cd C:\Users\atfm0\pv-method\experiments\exp-slm; set CUDA_VISIBLE_DEVICES=0; C:\Users\atfm0\miniconda3\envs\slm\python.exe phase-3-training\scripts\train.py --config phase-3-training\configs\<config>.yaml 2>&1"

# Evaluation
ssh chobits "cd C:\Users\atfm0\pv-method\experiments\exp-slm; set CUDA_VISIBLE_DEVICES=0; C:\Users\atfm0\miniconda3\envs\slm\python.exe phase-3-training\scripts\evaluate.py --model phase-3-training\models\<model> 2>&1"

# ONNX export
ssh chobits "cd C:\Users\atfm0\pv-method\experiments\exp-slm; C:\Users\atfm0\miniconda3\envs\slm\python.exe phase-3-training\scripts\export-onnx.py --model phase-3-training\models\<model> 2>&1"
```

### Sync Results Back

After training, sync checkpoints and results back to mission-control:

```bash
# Pull results (JSONL metrics, configs) — not model weights (too large)
scp -r "chobits:C:\Users\atfm0\pv-method\experiments\exp-slm\phase-3-training\results\*" \
  experiments/exp-slm/phase-3-training/results/

# Pull a specific model checkpoint for ONNX inference on mission-control
scp -r "chobits:C:\Users\atfm0\pv-method\experiments\exp-slm\phase-3-training\models\<model>" \
  experiments/exp-slm/phase-3-training/models/
```

> Model checkpoints are in `.gitignore` (`experiments/artifacts/`) — transfer manually, never commit.

### Keep Repo in Sync

```bash
# Pull latest configs/scripts on chobits before a training run
ssh chobits "cd C:\Users\atfm0\pv-method; git pull"
```

### Training Performance (RTX 4090 vs RTX 2080 Ti)

| Config | 2080 Ti (11 GB) | 4090 (24 GB) |
|--------|-----------------|--------------|
| Qwen2.5-Coder-0.5B LoRA r=16, 3K steps | ~1200s | ~450–600s (est.) |
| Max batch size | 2 | 4–8 |
| Larger model headroom | Limited | Qwen2.5-Coder-1.5B feasible |

## Future: Bridge Cluster Mode (PRD 039)

PRD 039 designs peer-to-peer bridge clustering over Tailscale. Not yet implemented — current setup is inference-only (bridge stays on mission-control, only model calls cross the network). See `docs/prds/039-bridge-cluster.md` for the full architecture.
