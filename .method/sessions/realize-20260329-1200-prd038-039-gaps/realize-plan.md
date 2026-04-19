# Realization Plan: PRDs 038 + 039 — Gaps

## FCA Partition Map

Domains (independent — can be commissioned in parallel):
- `packages/cluster/`              → NEW L3 — membership, resources, routing, federation, ports
- `packages/bridge/src/domains/cluster/`  → NEW L4 domain — core, routes, adapters, federation-sink
- `packages/method-ctl/`           → NEW L4 app — CLI commands, config
- `scripts/` + `packages/bridge/bin/`    → PRD 038 Phase 3 packaging

Shared surfaces (orchestrator-owned):
- `packages/bridge/src/ports/event-bus.ts`   — BridgeEvent schema extension
- `packages/bridge/src/server-entry.ts`      — composition root wiring
- `packages/bridge/package.json`             — @methodts/cluster dep, bin field
- `packages/cluster/src/index.ts`            — barrel exports (updated between waves)
- `root package.json`                        — workspace entries, scripts, esbuild devDep
- `root tsconfig.json`                       — project references

## Commissions

| ID | Phase | Domain/Package | Title | Depends On | Status |
|----|-------|---------------|-------|------------|--------|
| C-1 | 039-P1 | @methodts/cluster | Cluster package — types, ports, membership, resources, test-doubles | — | pending |
| C-2 | 038-P3 | scripts/, bridge/bin/ | Portable packaging — esbuild bundle + CLI entry | — | pending |
| C-3 | 039-P2 | bridge/domains/cluster/ | Bridge cluster domain — core, routes, config, adapters | C-1 | blocked |
| C-4 | 039-P3 | @methodts/cluster (routing/, federation/) | Cluster routing + event federation L3 | C-1 | blocked |
| C-5 | 039-P3 | bridge/domains/cluster/ (additions) | Bridge federation sink + POST /cluster/route | C-3, C-4 | blocked |
| C-6 | 039-P4 | packages/method-ctl/ | method-ctl CLI — status, nodes, projects | C-3 | blocked |

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| pre-2 | root package.json | Add packages/cluster to workspaces | C-3 needs @methodts/cluster importable |
| pre-2 | root tsconfig.json | Add packages/cluster project reference | Build chain |
| pre-2 | packages/bridge/package.json | Add @methodts/cluster dependency | Bridge imports cluster types |
| pre-3 | packages/cluster/src/index.ts | Update barrel: re-export membership + resources + ports | C-3 adapters import from cluster |
| pre-4 | packages/bridge/src/ports/event-bus.ts | Add optional sourceNodeId, federated to BridgeEvent | C-5 federation sink needs these |
| pre-4 | packages/cluster/src/index.ts | Update barrel: re-export routing + federation | C-5 + C-6 import router/relay |
| pre-4 | root package.json | Add packages/method-ctl to workspaces | C-6 creates new package |
| post-4 | packages/bridge/src/server-entry.ts | Wire ClusterDomain + ClusterFederationSink | Integration |

## Execution Order

Wave 1 (parallel): C-1, C-2 — disjoint packages, zero shared files
  → orchestrator: shared surface changes for Wave 2
Wave 2: C-3 — bridge cluster domain
  → orchestrator: shared surface changes for Wave 3
Wave 3: C-4 — routing + federation in cluster package
  → orchestrator: shared surface changes for Wave 4
Wave 4 (parallel): C-5, C-6 — bridge federation + method-ctl (disjoint domains)
  → orchestrator: server-entry.ts wiring, integration review, docs

## Acceptance Gates

| # | Criterion | Verification | Commissions | Status |
|---|-----------|-------------|-------------|--------|
| G1 | 038 AC-8: Tarball packages correctly | npm run pack produces .tgz | C-2 | pending |
| G2 | 038 AC-9: Tarball installs and runs | method-bridge --help exits 0 | C-2 | pending |
| G3 | 039 AC-1: Two bridges discover each other | /cluster/state shows peer alive | C-3 | pending |
| G4 | 039 AC-2: Cluster disabled = zero impact | No probes, 404 on /cluster/* | C-3 | pending |
| G5 | 039 AC-3: Failure detection | Suspect status <15s | C-3 | pending |
| G6 | 039 AC-4: Routing selects optimal node | Score-based selection | C-4, C-5 | pending |
| G7 | 039 AC-5: Project locality bonus | Locality outweighs slight capacity gap | C-4, C-5 | pending |
| G8 | 039 AC-6: Events federate | federated: true on peer | C-5 | pending |
| G9 | 039 AC-7: No re-relay | Loop prevention | C-4 | pending |
| G10 | 039 AC-8: method-ctl status | Unified 2-bridge view | C-6 | pending |
| G11 | 039 AC-11: /health cluster info | cluster field present | C-3 | pending |
| G12 | 039 AC-13: BridgeEvent backward compat | Existing sinks unaffected | C-5 | pending |
| G13 | 039 AC-14: Tailscale fallback to seeds | Warning + seeds used | C-3 | pending |
| G14 | 039 AC-15: Port doubles <20 lines | Line count check | C-1 | pending |

## Status Tracker

Total: 6 commissions, 4 waves
Completed: 0 / 6
Current wave: 1
Blocked: C-3, C-4, C-5, C-6
Failed: —
