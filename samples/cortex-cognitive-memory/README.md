# sample-cortex-cognitive-memory

PRD-068 Wave 1 Skeleton — the Memory cognitive module as a Cortex tenant app
(`category: agent`, Tier 2).

## What this sample demonstrates

- Composition via `createMethodAgent` with a **`persistent` pact** (MemoryPact).
  Memory is different from Monitor / Planner: it is a long-lived service
  (PRD-068 §5.1), not a resumable per-event pact.
- Joining the cortical workspace via `withCorticalWorkspaceMembership`
  (S11 handshake — `module_online` on compose, heartbeat every 30s,
  `module_offline` on dispose).
- **Two scheduled pacts**: a 30s heartbeat and a 5min consolidation tick
  (wired via `ctx.schedule` when available).
- A **bounded in-memory dual store** (episodic + semantic) with
  `MAX_ENTRIES_PER_KIND = 64` FIFO eviction. Skeleton only — the full
  `MemoryModuleV3` ACT-R activation-based retrieval is research-gated on
  R-26c (PRD-068 §10 D4 / D5).
- **Lazy shadow hydration** from `ctx.storage` on the first query for a
  given `(traceId, queryKind)` pair. Implements PRD-068 R5 mitigation —
  a restart of the persistent pact does not replay; it rebuilds state
  from storage on demand.
- Emitting `method.cortex.workspace.memory_recalled` on query and
  `method.cortex.workspace.memory_consolidated` on consolidation, keyed
  on `traceId` so peers correlate on the same reasoning episode (S10).
- Reacting to `method.cortex.workspace.state` via `reactToWorkspaceState`
  — promotes high-activation episodic entries to semantic entries and
  emits `memory_consolidated`.

## What this sample does NOT demonstrate (research gate)

The actual cognitive behavior of `MemoryModuleV3` — ACT-R base-level
activation, associative bump, partition-aware retrieval — is NOT wired.
The in-memory store is a scaffold so the Cortex-hosting wiring
(handshake, workspace emits, scheduled consolidation) can be tested
independent of the research-gated depth question. Full integration is
gated on the R-26c rerun in `experiments/exp-cognitive-baseline/`
(PRD-068 §10 D4).

This scaffold is correct-by-construction for the Cortex hosting side —
persistent pact lifecycle, storage-backed shadow rebuild, budget
isolation, workspace emissions — so that when R-26c completes, the
cognitive integration can land with only a narrow change to the pact
and the in-memory store swap.

## Run the tests

```bash
npm --workspace=sample-cortex-cognitive-memory test
```

Tests use a local `MockCortexCtx` that always wires `ctx.storage`
(persistent pacts rely on it) and optionally `ctx.events` + `ctx.schedule`.
They do not touch a real Cortex deployment.

## Files

- `src/pact.ts` — persistent pact declaring budget + `SchemaDefinition`
  output contract for `MemoryRecallOutput`.
- `src/agent.ts` — composition root (`composeMemoryTenantApp`) with the
  bounded in-memory dual store and lazy shadow hydration.
- `test/mock-ctx.ts` — in-process mock Cortex ctx with a Map-backed
  `ctx.storage`.
- `test/e2e.test.ts` — handshake, scheduled heartbeat + consolidation,
  query / recalled / consolidated flows, FIFO cap.
