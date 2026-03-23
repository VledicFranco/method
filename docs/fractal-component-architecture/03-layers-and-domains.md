---
title: Layers and Domains
scope: section
---

# Layers and Domains

FCA uses two complementary axes to decompose a system. Both produce boundaries, but they answer different questions.

### Layers: where the boundaries are

A **layer** is a boundary that separates what a component knows about from what it doesn't. You discover layers by asking: **"What should this component NOT know about?"**

Each answer creates a boundary:
- "Domain logic should not know about HTTP" → separate the domain component from the transport component
- "The methodology runtime should not know about the filesystem" → introduce a port between the runtime and the filesystem
- "The frontend should not know about server-side types" → the frontend defines its own types from the interface contract

Layers produce the **dependency graph** between components at the same level. At L3 (packages), layers determine which packages depend on which. At L2 (domains), layers determine which directories may import from which.

```
Layer 0 (types)       @method/types         Pure definitions, no behavior
      ↑
Layer 1 (domain)      @method/core          Domain logic, no I/O, no transport
      ↑
Layer 2 (SDK)         @method/methodts      Typed domain extensions, port interfaces
      ↑
Layer 3 (protocol)    @method/mcp           Protocol adapter, thin interface wrappers
      ↑
Layer 4 (application) @method/bridge        Wires everything, owns the process
```

The rule: a component may depend on components in lower layers. Never on components in higher layers.

### Domains: how the architecture organizes

A **domain** is a cluster of concepts that describe the same part of the world and change together. You discover domains by asking: **"What concepts belong together because they describe the same thing?"**

Each cluster becomes a sub-component:
- Nodes, gates, artifacts, execution state → the **strategy** domain
- Debounce, watchers, fire history, trigger config → the **trigger** domain
- Channels, messages, cursors, subscriptions → the **channel** domain

Domains produce the **architecture** within a component — the directory structure, the module groupings, the internal organization. Within an L3 package, each domain gets its own L2 domain directory.

### How they interact

A well-formed component is **one domain at one layer**:

| Component | Domain | Layer | Well-formed? |
|-----------|--------|-------|-------------|
| `@method/core` | Methodology | Domain (no I/O) | Yes — one domain, one layer |
| `@method/types` | All | Types (no behavior) | Yes — one layer, cross-domain |
| `@method/bridge` | Sessions + Strategies + Triggers + Events | Application | No — multiple domains |

When a component accumulates multiple domains, examine whether they should be separate components. The heuristic: **layers create components at the current level, domains create sub-components at the level below.**

