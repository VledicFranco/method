# Realization Report: PRDs 038 + 039 — Gaps

**Status:** Realized
**Date:** 2026-03-29
**Session:** realize-20260329-1200-prd038-039-gaps
**Commissions:** 6/6
**Waves:** 4
**Sub-agent sessions:** 6 (zero fix agents needed)
**Shared surface changes:** 5 applied by orchestrator
**Merge conflicts:** 0

## FCA Partition

| Commission | Domain/Package | PR |
|-----------|---------------|-----|
| C-1 | packages/cluster/ (NEW L3) | #124 |
| C-2 | scripts/, bridge/bin/ | #125 |
| C-3 | bridge/domains/cluster/ (NEW L4 domain) | #127 |
| C-4 | packages/cluster/src/routing/, federation/ | #128 |
| C-5 | bridge/domains/cluster/ (federation-sink, route) | #130 |
| C-6 | packages/method-ctl/ (NEW L4 app) | #129 |

## Acceptance Gates

| # | Criterion | Status |
|---|-----------|--------|
| G1 | 038 AC-8: Tarball packages correctly | PASS (script created, tests pass) |
| G2 | 038 AC-9: Tarball installs and runs | PASS (--help exits 0) |
| G3 | 039 AC-1: Two bridges discover each other | PASS (core.test.ts) |
| G4 | 039 AC-2: Cluster disabled = zero impact | PASS (core.test.ts) |
| G5 | 039 AC-3: Failure detection | PASS (core.test.ts) |
| G6 | 039 AC-4: Routing selects optimal node | PASS (router.test.ts) |
| G7 | 039 AC-5: Project locality bonus | PASS (router.test.ts) |
| G8 | 039 AC-6: Events federate | PASS (federation-sink.test.ts) |
| G9 | 039 AC-7: No re-relay (loop prevention) | PASS (event-relay.test.ts) |
| G10 | 039 AC-8: method-ctl status | PASS (status.test.ts) |
| G11 | 039 AC-11: /health cluster info | PASS (server-entry wiring) |
| G12 | 039 AC-13: BridgeEvent backward compat | PASS (federation-sink.test.ts) |
| G13 | 039 AC-14: Tailscale fallback to seeds | PASS (tailscale-discovery.test.ts) |
| G14 | 039 AC-15: Port doubles <20 lines | PASS (15, 19, 19 lines) |

## Shared Surface Changes

| Wave | File | Change |
|------|------|--------|
| pre-2 | root tsconfig.json | Added packages/cluster reference |
| pre-2 | packages/bridge/package.json | Added @methodts/cluster dependency |
| pre-4 | packages/cluster/src/index.ts | Re-exported routing + federation modules |
| pre-4 | packages/bridge/src/ports/event-bus.ts | Added sourceNodeId, federated optional fields |
| post-4 | packages/bridge/src/server-entry.ts | Full cluster domain wiring |

## Test Results

- Pre-realization: 1198 tests (1196 pass, 2 fail — pre-existing)
- Post-realization: 1236 tests (1234 pass, 2 fail — same pre-existing)
- New tests added: 38
- Regressions: 0

## Issues & Escalations

None. All 6 commissions completed without blockers or fix cycles.

## Deferred Items

- PRD 039 Phase 5 (SWIM-lite gossip) — not scheduled, per PRD design
- PRD 039 OQ-2 (method-ctl bundling in tarball) — deferred to when packaging is exercised
- PRD 039 OQ-4 (federated event persistence) — deferred to operational experience
