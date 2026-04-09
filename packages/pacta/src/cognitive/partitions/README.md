# cognitive/partitions/ — Typed Partition System

Implements the three cognitive partitions that structure the agent's working memory. Each partition has typed content, an eviction policy, and a priority queue for active slots.

## Partitions

| Partition | Purpose | Eviction |
|-----------|---------|----------|
| `operational` | Execution state — what the agent is doing right now | LRU (least recently used) |
| `task` | Goal tracking — current and pending tasks | Priority-based (highest priority stays) |
| `constraint` | Hard limits — what the agent must never do | Never evicted (permanent) |

## Components

| Component | Description |
|-----------|-------------|
| `PartitionSystem` | Manages all three partitions — reads, writes, eviction, capacity |
| `PartitionWorkspace` | View of a single partition's current contents |
| `EntryRouter` | Routes module output to the correct partition based on output type |
| `TypeResolver` | Maps output types to partition assignments |
| `EvictionPolicies` | LRU, priority-weighted, and constraint (never-evict) policies |

## Design

Partitions are the memory substrate. Modules write to partitions (via `EntryRouter`) and read from them (via `PartitionWorkspace`). The separation of operational / task / constraint mirrors human cognitive load theory: constraints are always present, tasks are queued by priority, and operational details are transient.
