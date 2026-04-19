# test-doubles/ — Cluster Port Test Doubles

Minimal fake implementations of the cluster's three port interfaces. Used exclusively in unit tests for `membership/`, `federation/`, and `routing/` — no real network or system calls.

## Test Doubles

| File | Port | Description |
|------|------|-------------|
| `fake-discovery.ts` | `DiscoveryProvider` | Returns a pre-configured list of peer addresses |
| `fake-network.ts` | `NetworkProvider` | Records sent messages; delivers pre-configured incoming messages |
| `fake-resources.ts` | `ResourceProvider` | Returns static resource snapshot (configurable CPU %, memory, sessions) |

## Design

All fakes are intentionally minimal — under 20 lines each. They implement the port interface with the bare minimum needed to exercise the domain logic. No mocking frameworks, no spy wrappers — just simple in-memory state.

Per FCA P3: test doubles belong next to the interfaces they fake, not in a central `__tests__/` directory. They are co-located with the cluster package so any package that depends on `@methodts/cluster` can import them for testing.
