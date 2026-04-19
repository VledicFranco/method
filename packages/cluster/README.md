# @methodts/cluster

Transport-agnostic cluster protocol package for the Method bridge. Defines the
membership state machine, resource schema, and port interfaces — all without
importing any transport library.

## Layer

**L3** in the FCA layer stack. Depended on by `@methodts/bridge` (L4) and
`method-ctl` (L4). Has zero dependencies on other `@methodts/*` packages.

## Structure

```
src/
  index.ts                    Public API barrel
  types.ts                    Shared types (ClusterState, ClusterNode, ClusterMessage, etc.)
  ports/
    discovery-provider.ts     Port: peer discovery (Tailscale, static seeds, gossip)
    network-provider.ts       Port: peer-to-peer messaging (HTTP, WS, TCP)
    resource-provider.ts      Port: local machine resource reporting
    README.md
  membership/
    membership.ts             MembershipManager — state machine (join, leave, suspect, dead)
    membership.config.ts      Zod-validated configuration with defaults
    membership.test.ts        8 test scenarios using test doubles
    README.md
  resources/
    resource-schema.ts        ResourceSnapshot Zod schema + validation utilities
    resource-schema.test.ts   Schema validation tests
    README.md
  test-doubles/
    fake-discovery.ts         FakeDiscovery implements DiscoveryProvider
    fake-network.ts           FakeNetwork implements NetworkProvider
    fake-resources.ts         FakeResources implements ResourceProvider
    index.ts                  Test doubles barrel
```

## Key Design Decisions

1. **Zero transport dependencies (DR-03).** No `node:http`, `node:net`, or HTTP
   libraries. All I/O enters through port interfaces injected at the composition root.

2. **Port pattern (FCA P3).** Three ports: `DiscoveryProvider`, `NetworkProvider`,
   `ResourceProvider`. Production implementations live in the bridge's
   `domains/cluster/adapters/` directory.

3. **Clock injection for testing.** `MembershipManager.now` can be replaced with
   a deterministic clock, enabling fast timeout tests without real delays.

4. **Discriminated union messages.** `ClusterMessage` is a union on the `type`
   field: `ping`, `ack`, `join`, `leave`, `state-sync`, `event-relay`.

5. **Zod for config validation.** Consistent with bridge domain patterns.

## Commands

```bash
npm run build    # TypeScript build (tsc -b)
npm run test     # Run all tests (node --test via tsx)
```

## Dependencies

- `zod` — config and resource schema validation

No other runtime dependencies.
