---
title: "PRD 041: Cognitive Experiment Lab — Programmatic Agent Experimentation Infrastructure"
status: proposed
date: "2026-03-30"
tier: heavyweight
depends_on: [33, 35, 40]
enables: []
blocked_by: []
complexity: high
domains_affected: [bridge/sessions, bridge/experiments (new), mcp, pacta/cognitive, bridge/frontend]
---

# PRD 041: Cognitive Experiment Lab — Programmatic Agent Experimentation Infrastructure

**Status:** Proposed
**Author:** PO + Lysica (informed by council debate — Warden, Spark, Dr. Meridian, Prism, Atlas, Cipher)
**Date:** 2026-03-30
**Packages:** `@method/bridge` (L4), `@method/mcp` (L3), `@method/pacta` (L3)
**Depends on:** PRD 033 (Cognitive Session UX), PRD 035 (Monitoring & Control v2), PRD 040 (Cognitive Agent Maturity)
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Problem Statement

The cognitive agent architecture (PRD 030-040) has produced validated modules (MonitorV2, ReasonerActorV2, PrecisionAdapter, EVC policy), working bridge integration, and preliminary experiment results (exp-slm Gate 3 passed, exp-cognitive-baseline N=3 pilot). But the experiment infrastructure is manual and disconnected:

1. **No programmatic experiment control.** The MCP tools can spawn cognitive sessions (`bridge_spawn` with `provider_type`) and send prompts (`bridge_prompt`), but cannot define experiments, configure module compositions, or compare runs. An orchestrating agent (Claude Code) cannot close the experiment loop autonomously — it must use raw HTTP calls, parse JSONL manually, and write YAML by hand.

2. **Cognitive events are lost at the bridge boundary.** The `CognitiveModule` algebra emits 9 typed events (`module_step`, `monitoring_signal`, `control_directive`, etc.) and produces `TraceRecord`s — but `cognitive-provider.ts` runs an inline v1 loop that emits ad-hoc `StreamEvent` types instead. The rich algebra-level signals never reach the bridge event bus, making module-level observability impossible.

3. **No experiment visibility for humans.** Experiment results live in `experiments/log/*.yaml` files — invisible in the bridge dashboard. The human cannot see experiment status, compare runs visually, or browse cycle-level traces without reading raw files. The bridge dashboard has Sessions, Strategies, and Projects pages but no experiment domain.

4. **Reproducibility is manual.** The experiment protocol (`PROTOCOL.md`) requires configuration capture, but nothing enforces it. Runs can start without recording their config, making them unreproducible. The AGENDA claim protocol is manual file editing.

5. **No A/B comparison tooling.** The research agenda (R-02 through R-08) requires comparing cognitive agent configurations — v1 vs v2 modules, different models, different thresholds — on identical tasks. No tooling exists to define conditions, run them, and compare results programmatically.

## Objective

Build a **Cognitive Experiment Lab** — an integrated experiment infrastructure that enables rapid, reproducible iteration over cognitive agent configurations through MCP tools and a visual dashboard. The lab serves two consumers:

1. **Orchestrating agent (Claude Code via MCP):** Programmatically define experiments, compose module configurations, run experiments, query results, and compare runs — closing the autonomous experimentation loop.
2. **Human researcher (via bridge dashboard):** View experiment agenda, monitor live runs, browse cycle-level traces, and compare results visually.

Specifically:

1. **8 MCP experiment tools** — create experiments, run them, query traces and signals, compare results, list presets and modules
2. **CognitiveSink adapter** — bridges `CognitiveEvent` from the algebra to `BridgeEvent` on the bus, making module-level events observable
3. **Experiment persistence** — scoped JSONL per run with enforced config snapshots
4. **Lab dashboard** — new `/lab` page with experiment list, detail, and run drill-down views
5. **Reproducibility enforcement** — "no config, no run" policy via MCP tools

## Architecture & Design

### Event Flow Architecture

```
CognitiveModule.step()
    |
    v
CognitiveEvent (algebra-level, typed — 9 event types)
    |
    v
CognitiveSink (NEW — EventSink adapter)
    |
    v
BridgeEvent bus (domain: 'cognitive', type: 'cognitive.module_step' etc.)
    |
    +--→ PersistenceSink → data/experiments/{expId}/runs/{runId}/events.jsonl
    +--→ WebSocketSink → Dashboard (live cycle traces)
    +--→ MCP tools → lab_read_traces, lab_read_workspace
```

The CognitiveSink is the critical new component. It maps each `CognitiveEvent` variant to a `BridgeEvent` with:
- `domain: 'cognitive'`
- `type: 'cognitive.{variant}'` (e.g., `cognitive.module_step`, `cognitive.monitoring_signal`)
- `payload`: the full typed event data plus `experimentId`, `runId`, `cycleNumber`
- `severity`: derived from event type (`info` for steps, `warning` for interventions/evictions, `error` for aborts)

### MCP Tool Surface

8 new tools in 3 groups:

**Experiment Lifecycle:**

| Tool | Purpose | Returns |
|------|---------|---------|
| `experiment_create` | Define experiment: name, hypothesis, conditions (module configs), tasks | `experimentId` |
| `experiment_run` | Execute one condition × task combination. Enforces config capture. | `runId` |
| `experiment_results` | Retrieve aggregated results for an experiment or run | Metrics matrix JSON |
| `experiment_compare` | Compare two+ runs with structured diffs | Config diff + metric deltas |

**Cognitive Introspection:**

| Tool | Purpose | Returns |
|------|---------|---------|
| `lab_list_presets` | Enumerate available presets and their module slot compositions | Preset catalog |
| `lab_describe_module` | Get a module's config schema, state shape, monitoring type | Module descriptor |

**Runtime Observation:**

| Tool | Purpose | Returns |
|------|---------|---------|
| `lab_read_traces` | Read TraceRecord[] for a run, filterable by module/phase/cycle | Trace array |
| `lab_read_workspace` | Snapshot active cognitive session's workspace (entries + salience) | Workspace state |

### Experiment Data Model

```
data/experiments/
  {experimentId}/
    experiment.yaml        # Hypothesis, conditions, tasks, status
    runs/
      {runId}/
        config.yaml        # Full resolved config (modules, provider, workspace, cycle)
        environment.yaml   # Git SHA, node version, package versions, GPU config
        events.jsonl       # Complete CognitiveEvent stream
        metrics.json       # Computed on run completion
        status.json        # running/completed/failed
```

Every `experiment_run` call:
1. Captures the full `CreateCognitiveAgentOptions` (resolved after applying preset + overrides)
2. Captures environment (git SHA, versions, GPU)
3. Writes `config.yaml` and `environment.yaml` before starting the first cycle
4. Streams events to `events.jsonl` during execution
5. Computes `metrics.json` on completion (cycles, tokens, interventions, cost, verdict)

### Condition Configuration

A condition is a named cognitive agent configuration:

```yaml
condition:
  name: "v2-enriched-ollama"
  preset: enriched
  overrides:
    monitor:
      baseConfidenceThreshold: 0.3
      grattonDelta: 0.05
    reasonerActor:
      stallEntropyThreshold: 0.3
      noChangeThreshold: 2
  provider:
    type: ollama
    model: qwen3:8b
    baseUrl: http://localhost:11434
  workspace:
    capacity: 12
  cycle:
    maxCycles: 20
    maxToolsPerCycle: 5
```

The `experiment_create` tool accepts an array of conditions. Each `experiment_run` specifies which condition to use.

### Dashboard — `/lab` Page

**Experiment List (`/lab`):**
- Table: name, hypothesis (truncated), status, condition count, run count, last activity
- Status badges: `drafting | running | analyzing | concluded`
- Quick actions: create new, view details

**Experiment Detail (`/lab/:id`):**
- Header: hypothesis, status, conditions summary
- Runs table: run ID, condition, task, key metrics (cycles, tokens, interventions, verdict), date
- Click run to drill into detail

**Run Detail (`/lab/:id/run/:runId`):**
- Full-page CycleTrace (reuse existing component)
- Per-cycle breakdown: workspace state, monitoring signals, control directives, tool calls
- Token usage per cycle (bar chart)
- Config snapshot (read-only, collapsible)

### What We Are NOT Building (v1)

- **Prometheus/Grafana** — wrong data model for structured events. The event bus + JSONL is sufficient.
- **SQLite query layer** — JSONL is sufficient at current scale (dozens of runs). Add if aggregation becomes a bottleneck.
- **Cross-run comparison overlay** — valuable v2 feature, not v1
- **Statistical comparison tools** — the orchestrating agent can compute statistics from raw data
- **Grafana MCP** — no Grafana, no need
- **Live module hot-swap** — violates reproducibility invariant. New module = new run.
- **Agenda claim protocol as MCP tool** — nice-to-have, not blocking

## Scope

### In-Scope

- CognitiveSink adapter: CognitiveEvent → BridgeEvent mapping
- 8 MCP experiment tools (lifecycle, introspection, observation)
- Experiment data model with scoped JSONL persistence
- Reproducibility enforcement (config + environment capture before first cycle)
- Lab dashboard: experiment list + experiment detail + run detail (reusing CycleTrace/CognitivePanel)
- Wire `cognitive-provider.ts` to emit CognitiveEvents through the adapter (prerequisite)

### Out-of-Scope

- Prometheus/Grafana integration
- SQLite/DuckDB query layer
- Cross-run comparison overlays in dashboard
- Statistical hypothesis testing in MCP tools
- Agenda claim protocol automation
- traceId/spanId composition tracing (v2 — when RFC 001 composition experiments start)
- workspace_snapshot events (v2 — add when workspace analysis is an active research question)

### Non-Goals

- Replacing the existing experiment protocol — the lab extends it, doesn't replace it
- Full deterministic replay — LLMs are stochastic; statistical reproducibility is the bar
- Multi-machine experiment distribution — single bridge instance is sufficient

## Implementation Phases

### Phase 1: CognitiveSink + Event Plumbing

The foundation — make cognitive module events visible on the bridge event bus.

Files:
- `packages/bridge/src/domains/sessions/cognitive-sink.ts` — NEW — EventSink implementation mapping CognitiveEvent → BridgeEvent
- `packages/bridge/src/domains/sessions/cognitive-provider.ts` — modify — emit CognitiveEvents through the sink instead of ad-hoc StreamEvents
- `packages/bridge/src/server-entry.ts` — modify — register CognitiveSink in composition root

Tests:
- CognitiveSink correctly maps all 9 CognitiveEvent types to BridgeEvent
- Events carry experimentId and cycleNumber in payload
- Existing session SSE streaming still works (backward compatible)

Checkpoint: cognitive module events visible on the event bus and persisted to JSONL.

### Phase 2: Experiment Domain + Persistence

New bridge domain for experiment state management and persistence.

Files:
- `packages/bridge/src/domains/experiments/core.ts` — NEW — experiment CRUD, run lifecycle, config capture
- `packages/bridge/src/domains/experiments/persistence.ts` — NEW — JSONL per-run event persistence, config/environment YAML
- `packages/bridge/src/domains/experiments/routes.ts` — NEW — REST endpoints for dashboard
- `packages/bridge/src/domains/experiments/types.ts` — NEW — Experiment, Run, Condition types
- `packages/bridge/src/domains/experiments/config.ts` — NEW — Zod schemas
- `packages/bridge/src/domains/experiments/README.md` — NEW — domain documentation (FCA P10)

Tests:
- Experiment CRUD operations
- Run config capture enforcement
- JSONL persistence writes + reads
- Environment snapshot capture

Checkpoint: experiments can be created, runs tracked, config persisted.

### Phase 3: MCP Tools

Expose experiment functionality through MCP for agent-driven experimentation.

Files:
- `packages/mcp/src/experiment-tools.ts` — NEW — 8 MCP tool handlers
- `packages/mcp/src/schemas.ts` — modify — experiment tool schemas
- `packages/mcp/src/index.ts` — modify — register experiment tools

Tests:
- Each tool validates inputs and returns expected JSON structure
- experiment_run enforces config capture (rejects run without config)
- lab_read_traces returns filtered TraceRecords
- experiment_compare returns structured diffs

Checkpoint: orchestrating agent can run experiments autonomously via MCP.

### Phase 4: Lab Dashboard

Visual experiment interface for human researchers.

Files:
- `packages/bridge/frontend/src/domains/experiments/ExperimentList.tsx` — NEW
- `packages/bridge/frontend/src/domains/experiments/ExperimentDetail.tsx` — NEW
- `packages/bridge/frontend/src/domains/experiments/RunDetail.tsx` — NEW (reuses CycleTrace/CognitivePanel)
- `packages/bridge/frontend/src/domains/experiments/types.ts` — NEW
- `packages/bridge/frontend/src/domains/experiments/useExperiments.ts` — NEW — React Query hooks
- `packages/bridge/frontend/src/App.tsx` — modify — add `/lab` route + nav item

Tests:
- Experiment list renders from API data
- Run detail displays CycleTrace with trace data

Checkpoint: human can browse experiments, view runs, drill into cycle traces.

## Acceptance Criteria

### AC-01: CognitiveSink maps all event types to BridgeEvent

**Given** a cognitive session running with the CognitiveSink registered
**When** the cognitive cycle emits a `CognitiveModuleStep` event
**Then** a BridgeEvent appears on the bus with `domain: 'cognitive'`, `type: 'cognitive.module_step'`, and the full event data in payload
**Automatable:** yes

### AC-02: Experiment creation via MCP captures full config

**Given** an orchestrating agent calling `experiment_create` then `experiment_run`
**When** the run starts
**Then** `config.yaml` contains the resolved module composition, provider config, workspace config, and cycle config; `environment.yaml` contains git SHA and package versions
**Automatable:** yes

### AC-03: lab_read_traces returns filterable TraceRecords

**Given** a completed experiment run with 5 cycles
**When** the agent calls `lab_read_traces` with `cycleNumber: 3`
**Then** only TraceRecords from cycle 3 are returned, with module IDs, durations, and token usage
**Automatable:** yes

### AC-04: experiment_compare shows config and metric diffs

**Given** two completed runs with different monitor thresholds
**When** the agent calls `experiment_compare` with both run IDs
**Then** the response shows the config diff (threshold values) and metric deltas (cycles, tokens, interventions)
**Automatable:** yes

### AC-05: Lab dashboard shows experiment list

**Given** 3 experiments exist with varying statuses
**When** the user navigates to `/lab`
**Then** all 3 experiments appear with name, hypothesis, status badge, run count
**Automatable:** yes (Playwright)

### AC-06: Run detail shows cycle trace

**Given** a completed run with 5 cycles including a monitor intervention
**When** the user drills into the run detail at `/lab/:id/run/:runId`
**Then** the CycleTrace shows all 5 cycles with the intervention highlighted, and the token usage is visible per cycle
**Automatable:** yes (Playwright)

### AC-07: Config capture is enforced

**Given** an agent calling `experiment_run` without prior `experiment_create`
**When** the tool executes
**Then** it returns an error: "Experiment not found. Create an experiment first."
**Automatable:** yes

### AC-08: Events persist to experiment-scoped JSONL

**Given** a running experiment with experimentId "exp-001"
**When** cognitive events are emitted during the run
**Then** events appear in `data/experiments/exp-001/runs/{runId}/events.jsonl` with timestamps and full payloads
**Automatable:** yes

## Success Metrics

| Metric | Target | Method |
|--------|--------|--------|
| Experiment setup time via MCP | <30 seconds | Time from experiment_create to first run start |
| Config capture rate | 100% | Every run has config.yaml written before first cycle |
| Event coverage | 9/9 CognitiveEvent types mapped | Count distinct event types in JSONL after a full run |
| Dashboard load time | <2s | Measure `/lab` page load with 10 experiments |
| Agent experiment loop | Fully autonomous | Agent can create, run, compare, and iterate without human intervention |

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| CognitiveEvent volume overwhelms JSONL persistence | Medium | Severity-based filtering at sink level. Workspace writes are `info`, only persist `warning+` by default. Full trace opt-in per experiment. |
| cognitive-provider.ts v2 wiring is complex | High | Keep inline cycle loop as fallback. CognitiveSink can also adapt the existing StreamEvents as a transitional path. |
| Dashboard experiment domain adds significant frontend code | Medium | Reuse CycleTrace, CognitivePanel, existing design system. MVP is 3 components (list, detail, run). |
| JSONL files grow large for long experiments | Low | Per-run file partitioning. Runs are typically 15 cycles × 8 phases = ~120 events. |

## Dependencies

- **PRD 040 (Cognitive Agent Maturity):** Multi-tool cycles, workspace persistence, Edit tool — prerequisite for meaningful experiments
- **PRD 035 (Monitoring & Control v2):** v2 modules that emit rich CognitiveEvents — prerequisite for the CognitiveSink
- **PRD 033 (Cognitive Session UX):** CycleTrace, CognitivePanel components — reused in lab dashboard

## Documentation Impact

| Document | Action |
|----------|--------|
| `docs/arch/experiment-lab.md` | Create — event flow, data model, MCP tool reference |
| `docs/guides/experiment-lab.md` | Create — how to run experiments via MCP and dashboard |
| `experiments/PROTOCOL.md` | Update — reference MCP tools for automated runs |

## Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | Should `experiment_compare` compute statistics (p-values) or return raw data? Start with raw data, add stats if agents need them. | Implementation | Phase 3 |
| OQ-2 | Should the CognitiveSink persist workspace snapshots? Expensive but valuable for debugging. Default: off, opt-in per experiment. | PO | Phase 1 |
| OQ-3 | Should the lab dashboard show the AGENDA.md as a parsed table? Valuable for the human but requires a parser. | PO | Phase 4 |
