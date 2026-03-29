# Cluster Ports

Port interfaces for the `@method/cluster` package. These define the boundaries
between the transport-agnostic cluster protocol (L3) and the concrete I/O
implementations injected at the application layer (L4).

## Ports

| Port | File | Purpose |
|------|------|---------|
| `DiscoveryProvider` | `discovery-provider.ts` | How to find other bridges (Tailscale, static seeds, gossip) |
| `NetworkProvider` | `network-provider.ts` | How to send/receive messages between peers (HTTP, WS, TCP) |
| `ResourceProvider` | `resource-provider.ts` | How to report local machine resources (CPU, memory, sessions) |

## FCA Principles

- **P3 (Port Pattern):** All external dependencies enter through port interfaces.
  The cluster package never imports `node:http`, `node:net`, Tailscale SDK, or any
  concrete transport library.
- **P5 (Thin Wrappers):** Port implementations at L4 are thin adapters over
  platform APIs. Domain logic stays in the cluster package.
- Ports are injected at the composition root (`server-entry.ts` in the bridge,
  or a test harness) via constructor injection on `MembershipManager`.

## Test Doubles

See `../test-doubles/` for fake implementations used in unit tests.
These are intentionally minimal (under 20 lines each per FCA P3).
