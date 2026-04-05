# Experiment: Build Orchestrator Validation

## Hypothesis

H1: `/build` covers all 8 lifecycle phases end-to-end without manual skill invocations.
H2: `/build` reduces human interventions from ≥ 10 to ≤ 4 for a 3-commission feature.
H3: `/build` autonomously recovers from ≥ 60% of commission gate failures.
H4: Orchestrator overhead is ≤ 15% of total pipeline token cost.
H5: Every `/build` run produces a validation report with machine-evaluated success criteria.

## Protocol

Matched-pair A/B. 3 features of similar complexity. Each run under both conditions.

- **Condition A (baseline):** Human drives skills manually
- **Condition B (treatment):** `/build` drives via dashboard/Claude Code

## Feature 1: Dashboard WebSocket Live Updates

Wire real-time WebSocket events into the build dashboard so it updates live
instead of polling every 5s. 3 commissions, 2 domains (bridge/build backend
event emission + bridge/build-ui frontend subscription).

### Success Criteria (machine-evaluable)
1. `tsc --noEmit` produces zero errors in both bridge and frontend packages
2. All existing 87 build domain tests pass
3. `useBuilds.ts` imports and calls `useWebSocket` (grep verification)
4. `ConversationPanel.tsx` subscribes to `build.agent_message` events (grep verification)
5. Frontend `vite build` succeeds with zero errors

## Status

- [ ] Feature 1 Condition B (treatment): `/build` driven
- [ ] Feature 1 Condition A (baseline): manual skill driven
- [ ] Feature 2: TBD (after Feature 1 results)
- [ ] Feature 3: TBD (after Feature 2 results)
