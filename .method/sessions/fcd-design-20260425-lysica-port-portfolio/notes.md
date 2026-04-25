---
type: design-session-notes
date: "2026-04-25"
session: "fcd-design — lysica-port portfolio"
input: "PRDs for everything we can port from lysica-1"
status: complete
---

# Lysica → method TS port portfolio

## Context

`../lysica-1` is a Python sister repo that ports `@methodts/pacta` cognitive
framework into Python (with embodied/persistent extensions). Over several
weeks the Python branch has grown beyond TS in three independent areas. This
session designs the port-back PRDs.

## Verification of TS state

A prior research pass (Explore agent) verified, item by item, what TS already
has vs what is genuinely missing. Conclusions:

| Lysica module | TS state | Action |
|---|---|---|
| `pacta/slm/cascade.py` | absent — TS has only task-specific HTTP SLM clients (`kpi-checker-slm`, `router-slm`) wired to bespoke ports, no generic `LLMProvider`-shaped cascade | **Port → PRD 057** |
| `pacta/slm/http_bridge.py` | partial — `createHttpRouterSLM`/`createHttpKPIChecker` POST to `/generate` already; no health-pinged generic runtime | **Extend → PRD 057** |
| `pacta/slm/types.py`, `exceptions.py` | absent | **Port → PRD 057** |
| PRD-005 (lysica) N-tier cascade + TierRouter + Spillover | absent — frozen Python contracts only | **Port shape directly → PRD 057** |
| `pacta/core/trace/types.py` (hierarchical) | absent — TS has flat `TraceRecord` only | **Port → PRD 058** |
| `lysica/observability/{assembler,ring_buffer,sqlite_store}.py` | absent — TS has only `InMemoryTraceSink` and `ConsoleTraceSink` | **Port → PRD 058** |
| `pacta/providers/tracing.py` (`TracingLLMProvider`) | absent — middleware stack exists for budget/validation/throttle, no trace emission | **Port → PRD 058** |
| `pacta/testkit/diagnostics.py` | absent — `pacta-testkit` has assertions + builders + recording-* | **Port → PRD 059** |
| `pacta/testkit/runners.py` (cycle runner with trace collection) | partial — `RecordingModule` covers per-component capture, no cycle-level wrapper | **Extend → PRD 059** |
| `pacta/core/cycle/runner.py` (8-phase generic) | TS `cycle.ts` already richer (846 LoC, RFC-006 aware, partition-aware) | **Skip** |
| `pacta/experiments/runner.py` | TS bridge `domains/experiments/` is the orchestration shell; programmatic L2 runner low priority right now | **Skip / re-evaluate later** |
| `pacta/modules/action_gate/`, `arousal/` | partial — `affect-module.ts` covers arousal+valence, control validation lives inline in `cycle.ts`. Coupled to lysica-only `CycleMode` / `TrustLevel` | **Defer** — unbundle when cycle/affect refactor makes the abstractions natural in TS |
| `lysica/identity/*`, `lysica/memory/*` (LanceDB pipeline) | Python-first by lysica DR-09; TS already richer in some areas (consolidation engine) | **Skip** — lysica-app concern, not framework |

## Why three PRDs, not one

These three clusters are independently valuable, independently sized, and
touch disjoint domains. Bundling would violate Phase-1.4 scope discipline
("a PRD without scope boundaries grows until it collapses"). Each PRD owns
its surfaces and can ship without waiting on the others.

## Scope boundaries (each PRD names its own)

PRD 057 explicitly excludes: middleware-style cascade (the cascade is its
own provider), Anthropic-extended-thinking confidence, frontend UI for tier
selection, training new SLMs.

PRD 058 explicitly excludes: replacing the existing flat `TraceRecord`
(additive port introduction; flat is kept for back-compat), distributed
tracing (no OpenTelemetry yet), bridge-frontend dashboard work.

PRD 059 explicitly excludes: `RecordingModule`/`RecordingProvider`
deprecation (they stay), generic experiment runner (deferred), cognitive
benchmark task fixtures (deferred).

## Sequencing

PRD 058 (trace types) is the loosely-coupled foundation: hierarchical events
+ assembler are consumed by PRD 057 (cascade emits OPERATION events) and
PRD 059 (cycle runner collects them). But 057 and 059 don't strictly require
058 to compile — they can land in any order against the existing flat
`TraceRecord`, and adopt the new hierarchy as it lands.

Recommended order: **058 → 057 → 059**. If urgency shifts (e.g., cost
pressure makes the cascade load-bearing), 057 can ship first against flat
`TraceRecord` and adopt 058 events later.

## Outputs

- `docs/prds/057-slm-cascade-infrastructure.md`
- `docs/prds/058-hierarchical-trace-observability.md`
- `docs/prds/059-pacta-testkit-diagnostics.md`
- This session note.
