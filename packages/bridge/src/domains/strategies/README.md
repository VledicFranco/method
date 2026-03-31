---
title: Strategies
scope: domain
package: bridge
contents:
  - index.ts
  - types.ts
  - config.ts
  - strategy-parser.ts
  - strategy-executor.ts
  - strategy-executor.test.ts
  - gates.ts
  - gates.test.ts
  - artifact-store.ts
  - artifact-store.test.ts
  - pacta-strategy.ts
  - pacta-strategy.test.ts
  - retro-generator.ts
  - retro-writer.ts
  - strategy-routes.ts
  - strategy-routes.test.ts
---

# Strategies

Strategy pipeline execution engine (PRD 017). Strategies are DAG-structured multi-step workflows defined in YAML, where each node is an LLM invocation with gate-checked outputs. This domain handles parsing strategy YAML into validated DAGs, executing nodes in topological order with parallelism, evaluating sandboxed gate expressions for pass/fail decisions with retry-and-feedback, managing versioned artifact stores between pipeline steps, generating mandatory retrospective YAML after execution, and abstracting the underlying LLM provider.

| Module | Purpose |
|--------|---------|
| [index.ts](index.ts) | Barrel exports for all strategy types and implementations |
| [types.ts](types.ts) | Type-only re-exports from @method/methodts |
| [config.ts](config.ts) | Zod-validated configuration schema and env var loader |
| [strategy-parser.ts](strategy-parser.ts) | Parses strategy YAML into StrategyDAG and validates acyclicity, reference integrity, and unique IDs |
| [strategy-executor.ts](strategy-executor.ts) | DAG executor adapter — wraps @method/methodts DagStrategyExecutor with Pacta AgentProvider |
| [gates.ts](gates.ts) | Gate framework — sandboxed expression evaluation for algorithmic, observation, and human approval gates |
| [artifact-store.ts](artifact-store.ts) | Immutable versioned store for pipeline artifacts with snapshot bundles passed between nodes |
| [pacta-strategy.ts](pacta-strategy.ts) | Pact constraint builder for strategy steps — budget, scope, reasoning config |
| [retro-generator.ts](retro-generator.ts) | Generates retrospective YAML capturing timing, cost, gate results, and oversight events |
| [retro-writer.ts](retro-writer.ts) | Filesystem operations for saving strategy retrospectives to disk |
| [strategy-routes.ts](strategy-routes.ts) | Fastify HTTP routes for strategy execution, CRUD, and status checking |
