# sample-cortex-cognitive-monitor

PRD-068 Wave 1 Skeleton — the Monitor cognitive module as a Cortex tenant app
(`category: agent`, Tier 2).

## What this sample demonstrates

- Composition via `createMethodAgent` with a `resumable` pact (MonitorPact).
- Joining the cortical workspace via `withCorticalWorkspaceMembership`
  (S11 handshake protocol — `module_online` on compose, heartbeat every 30s,
  `module_offline` on dispose).
- Emitting `method.cortex.workspace.anomaly` + `.confidence` on the shared
  cortical-workspace topic family (S10), keyed on `traceId` so peers can
  correlate on the same reasoning episode.
- Per-module fixed budget (0.05 USD ceiling, `fresh-per-continuation`) —
  no cross-module rebalancing (PRD-068 §6.1).

## What this sample does NOT demonstrate (research gate)

The actual cognitive behavior of MonitorV2 — prediction-error tracking,
precision weighting, metacognitive taxonomy (EOL/JOL/FOK/RC) — is NOT
wired in this Wave 1 scaffold. Full cognitive integration is gated on the
R-26c rerun in `experiments/exp-cognitive-baseline/` (see PRD-068 §10 D4
and `docs/rfcs/003-cortical-workspace-composition.md`).

This scaffold is correct-by-construction for the Cortex hosting side —
workspace emits, handshake, budget isolation, resumable continuation — so
that when R-26c completes, the cognitive integration can land with only a
narrow change to the pact and `observeWorkspaceState` internals.

## Run the tests

```bash
npm --workspace=sample-cortex-cognitive-monitor test
```

Tests use a local `MockCortexCtx` bearing `events` + `schedule` facades;
they do not touch a real Cortex deployment.

## Files

- `src/pact.ts` — resumable pact declaring budget + output contract.
- `src/agent.ts` — composition root (`composeMonitorTenantApp`).
- `test/mock-ctx.ts` — in-process mock Cortex ctx for the E2E suite.
- `test/e2e.test.ts` — handshake, scheduled heartbeat, workspace emits.
