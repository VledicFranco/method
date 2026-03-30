---
title: Experiments
scope: domain
package: bridge
prd: 041
phase: 2
contents:
  - index.ts
  - types.ts
  - config.ts
  - core.ts
  - persistence.ts
  - routes.ts
  - experiments.test.ts
---

# Experiments

Cognitive Experiment Lab — backend domain for the programmatic agent experimentation infrastructure (PRD 041, Phase 2). This domain owns experiment state management, run lifecycle, reproducibility enforcement, JSONL persistence, and REST API routes for the `/lab` dashboard.

## What This Domain Owns

- **Experiment CRUD** — create, read, list experiments persisted as `experiment.yaml` files
- **Run lifecycle** — create runs, track status (running/completed/failed), write metrics
- **Reproducibility enforcement** — `captureRunConfig` writes `config.yaml` before first cycle; `captureEnvironment` writes `environment.yaml` at run creation
- **JSONL event persistence** — `appendEvent` / `readEvents` / `readTraces` for per-run event logs
- **EventSink** — `createExperimentEventSink()` produces an EventSink that routes `domain='cognitive'` BridgeEvents to run JSONL files
- **REST routes** — `/lab/*` Fastify endpoints for the dashboard and MCP tool backing

## File Index

| File | Purpose |
|------|---------|
| `types.ts` | Domain types: `Experiment`, `Run`, `Condition`, `RunMetrics`, `TraceRecord`, `TraceFilter`, status enums |
| `config.ts` | Zod validation schemas: `CreateExperimentSchema`, `CreateRunSchema`, `ReadTracesSchema`, `ExperimentsConfigSchema` |
| `core.ts` | Experiment and run CRUD — create/get/list experiments, run lifecycle, config and environment capture |
| `persistence.ts` | JSONL event log — `appendEvent`, `readEvents`, `readTraces` with filtering, and `createExperimentEventSink` |
| `routes.ts` | Fastify REST routes for `GET/POST /lab`, `GET /lab/:id`, `POST /lab/:id/runs`, run detail, traces, events |
| `index.ts` | Barrel re-exports for all public types, functions, and the route registration hook |
| `experiments.test.ts` | Unit tests covering CRUD, run lifecycle, config capture, JSONL persistence, trace filtering, EventSink |

## Data Structure

```
data/experiments/
  {experimentId}/
    experiment.yaml        # Hypothesis, conditions, tasks, status, timestamps
    runs/
      {runId}/
        config.yaml        # Full resolved CreateCognitiveAgentOptions (written before first cycle)
        environment.yaml   # Git SHA, node version, package versions, platform
        events.jsonl       # Complete CognitiveEvent stream (one BridgeEvent per line)
        metrics.json       # Computed on run completion (cycles, tokens, interventions, cost, verdict)
        status.json        # running / completed / failed + timestamps
```

## Domain Invariants

1. **config.yaml is always written before the first cycle event.** `captureRunConfig` must be called before the first cycle starts. This enforces reproducibility (AC-02).

2. **Experiment must exist before a run can be created.** `createRun` throws `"Experiment not found. Create an experiment first."` if the experimentId does not resolve (AC-07).

3. **environment.yaml is captured at run creation.** `captureEnvironment` is called automatically inside `createRun`. It records git SHA, node version, and package versions.

4. **Condition must exist in the experiment.** `createRun` validates that `conditionName` references a condition in the parent experiment.

5. **JSONL files are append-only during a run.** Events are only appended — never overwritten or deleted while a run is active.

6. **Domain never imports from other bridge domains.** Per FCA, domains are isolated. `experiments/` does not import from `sessions/`, `strategies/`, etc.

## Persistence Guarantees

- Each `appendEvent` call writes exactly one JSON line terminated by `\n`
- `readEvents` returns events in write order (sequential file reads)
- `readTraces` is a filtered projection: only `domain='cognitive'` events, mapped to `TraceRecord` shape
- Malformed JSONL lines are silently skipped on read (defensive against partial writes)
- Missing files return empty arrays (not errors) — supports pre-run reads

## Event Subscription Contract

The domain exports `createExperimentEventSink(): EventSink`. The composition root (`server-entry.ts`) is responsible for:

1. Calling `setPersistencePorts(fs)` to inject the file-system port
2. Calling `bus.registerSink(createExperimentEventSink())` to subscribe to the event bus

The sink:
- **Filters to:** `domain === 'cognitive'` events only
- **Extracts from payload:** `experimentId` (string) and `runId` (string)
- **Drops silently:** events without a valid `experimentId` + `runId` pair (not experiment-scoped)
- **Appends to:** `data/experiments/{experimentId}/runs/{runId}/events.jsonl`
- **Error policy:** persistence failures are non-fatal; they are logged but never propagate to the event bus

The sink does not register itself. Registration is the composition root's responsibility (per PRD 026 / FCA boundary rule).

## REST Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/lab` | List all experiments (sorted newest first) |
| `POST` | `/lab` | Create a new experiment |
| `GET` | `/lab/:id` | Get experiment + runs list |
| `POST` | `/lab/:id/runs` | Create a new run (enforces AC-07) |
| `GET` | `/lab/:id/runs/:runId` | Get run details + metrics |
| `POST` | `/lab/:id/runs/:runId/config` | Write config.yaml (call before first cycle) |
| `POST` | `/lab/:id/runs/:runId/environment` | Refresh environment capture |
| `GET` | `/lab/:id/runs/:runId/traces` | Trace events (optional: cycleNumber, moduleId, phase) |
| `GET` | `/lab/:id/runs/:runId/events` | Raw BridgeEvent array |

## Port Injection

This domain uses the port pattern (DR-15) — no direct `node:fs` imports.

```typescript
// Composition root wires these before starting the server:
import { setExperimentRoutesPorts, setExperimentRoutesDataDir } from './domains/experiments/index.js';
import { createExperimentEventSink } from './domains/experiments/index.js';

setExperimentRoutesPorts(fs, yaml);
// setExperimentRoutesDataDir(dataDir);  // optional — defaults to 'data/experiments'

bus.registerSink(createExperimentEventSink());
registerExperimentRoutes(app);
```
