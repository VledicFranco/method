# cluster/adapters/ — Cluster Port Implementations

L4 adapter implementations for the cluster's L3 port interfaces. These are the concrete I/O bindings that connect the transport-agnostic cluster protocol to real infrastructure.

## Adapters

| Adapter | Port | Description |
|---------|------|-------------|
| `HttpNetworkAdapter` | `NetworkProvider` | Sends/receives cluster messages over HTTP — peer-to-peer REST calls |
| `NodeResourceAdapter` | `ResourceProvider` | Reports local machine resources via Node.js `os` module (CPU, memory, process load) |
| `TailscaleDiscoveryAdapter` | `DiscoveryProvider` | Discovers cluster peers via Tailscale network API — reads the Tailscale peer list |

## FCA Notes

These adapters are the only files in the bridge that import platform APIs (`node:os`, `http`, Tailscale SDK). All other bridge code accesses these capabilities exclusively through the injected port interfaces defined in `@method/cluster/src/ports/`.

Adapters are instantiated in `server-entry.ts` and injected into `MembershipManager` at startup.
