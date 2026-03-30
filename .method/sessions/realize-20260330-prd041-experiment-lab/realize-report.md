# Realization Report — PRD 041: Cognitive Experiment Lab

**Date:** 2026-03-30
**Methodology:** /realize (PRD orchestration)
**Verdict:** COMPLETE (with post-wave critical fix)

---

## Summary

PRD 041 was realized in two parallel waves (C-1 + C-2, then C-3 + C-4) followed by an integration review that identified one CRITICAL issue, which was resolved in a fifth commission.

**Final gate results:** 1334 tests — 1332 pass, 2 fail (both pre-existing, unrelated to PRD 041).

---

## Commissions Executed

| ID | Domain | Files Created/Modified | Verdict |
|----|--------|------------------------|---------|
| C-1 | `sessions/` — CognitiveSink | `cognitive-sink.ts` (new), `cognitive-sink.test.ts` (new), `cognitive-provider.ts` (modified), `pool.ts` (modified) | PASS |
| C-2 | `experiments/` — domain | `types.ts`, `config.ts`, `core.ts`, `persistence.ts`, `routes.ts`, `index.ts`, `README.md`, `experiments.test.ts` (all new) | PASS (Zod v4 fixes applied) |
| C-3 | `mcp/` — experiment tools | `experiment-tools.ts` (new), `schemas.ts` (modified), `index.ts` (modified) | PASS |
| C-4 | `frontend/experiments/` | `types.ts`, `useExperiments.ts`, `ExperimentList.tsx`, `ExperimentDetail.tsx`, `RunDetail.tsx` (all new) | PASS |
| C-5 | **Critical fix** — setContext wiring | `pool.ts`, `routes.ts`, `schemas.ts`, `bridge-tools.ts` (all modified) | PASS |

### Shared surface changes applied by orchestrator

- `server-entry.ts` — wired `CognitiveSink`, `ExperimentEventSink`, `setExperimentRoutesPorts`, `registerExperimentRoutes`
- `App.tsx` — added lazy imports + routes for `/lab`, `/lab/:id`, `/lab/:id/run/:runId`
- `mcp/index.ts` — added `EXPERIMENT_TOOLS` to ListTools and 8 switch-case handlers for experiment tools

---

## Critical Issue Found and Fixed (C-5)

**Root cause:** `CognitiveSink.setContext({ experimentId, runId })` was never called in production. The `ExperimentEventSink.onEvent()` guard `if (typeof experimentId !== 'string' || !experimentId) return;` silently dropped all cognitive events, so `lab_read_traces` always returned `[]`.

**Fix design:** Per-session `CognitiveSink` with experiment context injected at spawn time.

The chain: `bridge_spawn(experiment_id, run_id)` → `POST /sessions` → `pool.create(experiment_id, run_id)` → creates `new CognitiveSink(eventBus, { sessionId, experimentId, runId })` for that session → cognitive events emit with `payload.experimentId` set → `ExperimentEventSink` routes to `data/experiments/{id}/runs/{runId}/events.jsonl`.

**Key design decision:** Per-session sinks (not global `setContext()`) avoid a race condition where concurrent experiment runs would overwrite each other's context on a shared sink instance.

---

## Deferred Items

| Item | Decision |
|------|----------|
| H-1: Frontend `/run/` vs API `/runs/`  | Accepted as-is — frontend is internally consistent (App.tsx and ExperimentDetail.tsx both use singular); API uses plural which is standard REST. No cross-contamination. |
| H-2: cycleNumber injection in module_step events | Deferred — cognitive-provider.ts loop can inject `c+1` but this is a minor enhancement, not a blocker. |
| Frontend test infra | `ExperimentList.test.tsx` created but Vitest frontend config not yet set up — tests run file-exists check only. Future work. |
| lab_read_workspace stub | Returns "not yet available" — workspace state read requires deeper pacta integration. Deferred to PRD 042+. |

---

## Acceptance Criteria Status

| AC | Description | Status |
|----|-------------|--------|
| AC-01 | CognitiveSink maps all 9 algebra types | ✓ PASS (39 unit tests) |
| AC-02 | Experiments domain: CRUD + JSONL persistence | ✓ PASS |
| AC-03 | 8 MCP tools registered and callable | ✓ PASS |
| AC-04 | Frontend routes `/lab`, `/lab/:id`, `/lab/:id/run/:runId` | ✓ PASS |
| AC-05 | `experiment_create` returns experiment with ID | ✓ PASS |
| AC-06 | `experiment_run` creates run record | ✓ PASS |
| AC-07 | Run creation fails if experiment doesn't exist | ✓ PASS |
| AC-08 | Cognitive events persist to JSONL for experiment runs | ✓ PASS (after C-5 fix) |
| AC-09 | `lab_read_traces` returns filtered trace records | ✓ PASS (after C-5 fix) |

---

## Architecture Observations

1. **FCA partitioning worked cleanly.** Four commissions across disjoint domains ran in parallel with zero merge conflicts. The shared surface protocol (orchestrator owns ports/*, shared/*, server-entry.ts, App.tsx) held.

2. **Worktree isolation artifact.** Sub-agents running with `isolation: worktree` leave files as untracked in the main working tree after merge. Requires manual `git add` of the untracked domain files before committing. Not a code issue — a tooling behavior to account for in future orchestrated realizations.

3. **Zod v4 compatibility.** C-2 required `.error.issues` (not `.error.errors`) and `z.record(z.string(), z.unknown())` (not `z.record(z.unknown())`). Documented in CLAUDE.md context for future work.

4. **Global sink vs. per-session sink tradeoff.** The original `CognitiveSink` design used a single global instance with `setContext()` mutation — this works for sequential experiment runs but races under concurrency. The fix uses per-session instances created at spawn time, which is safe under any parallelism.
