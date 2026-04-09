# cognitive/ — Cognitive Composition Engine (PRD 030)

Composable cognitive architecture for LLM agents. Implements a partition-based model where agent cognition is divided into typed partitions (operational, task, constraint) that are independently configured and composed via an algebra.

## Partitions

| Partition | Module | Purpose |
|-----------|--------|---------|
| `operational` | `partitions/operational/` | Execution state — what the agent is doing right now |
| `task` | `partitions/task/` | Goal tracking — what the agent needs to accomplish |
| `constraint` | `partitions/constraint/` | Hard limits — what the agent must never do |

## Components

| Component | Description |
|-----------|-------------|
| `algebra/` | Composition operators: sequence, parallel, choice, loop |
| `modules/` | Cognitive modules — composable units of reasoning capability |
| `engine/` | Execution engine — runs composed cognitive structures |
| `presets/` | Pre-built cognitive configurations for common agent profiles |
| `partitions/` | Typed partition implementations |

## Design

The cognitive engine separates what-to-think (modules) from how-to-compose (algebra). Modules are stateless functions; the algebra describes their composition. The engine executes the composed structure against a provider. This enables testing modules and compositions independently.

Reference: `docs/rfcs/001-cognitive-composition.md`, `docs/rfcs/003-cortical-workspace-composition.md`
