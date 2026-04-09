# cognitive/engine/ — Cognitive Execution Engine (PRD 030)

Executes composed cognitive structures against an LLM provider. The engine interprets algebra operators, manages workspace state across cycles, and handles the cognitive loop (observe → plan → act → reflect).

## Components

| Component | Description |
|-----------|-------------|
| `createCognitiveAgent()` | Factory — wires modules, algebra, and provider into a runnable cognitive agent |
| `cycle.ts` | Single cognitive cycle: activates modules in algebra order, updates workspace |
| `consolidation.ts` | Post-cycle consolidation — prunes workspace, promotes stable insights |
| `EvcPolicy` | Epistemic Value of Computation policy — decides when to stop cycling |
| `PartitionWriteAdapter` | Adapts workspace partition writes for module output routing |
| `as-flat-agent.ts` | Compatibility adapter — exposes a cognitive agent as a flat `AgentProvider` |

## Execution Model

```
CognitiveAgent.run(input)
  └─ for each cycle (until EvcPolicy.shouldStop()):
      └─ cycle(): activate modules in algebra order
          └─ each module reads workspace, produces output
          └─ output routed to partition(s) via PartitionWriteAdapter
      └─ consolidation(): prune stale workspace entries
  └─ emit terminal workspace state
```

The EVC policy prevents unnecessary cycles by measuring the epistemic value added by each additional cycle. When marginal value drops below a threshold, the engine terminates.
