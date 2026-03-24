---
title: Strategies
scope: domain
package: bridge
contents:
  - index.ts
  - llm-provider.ts
  - claude-code-provider.ts
  - claude-code-provider.test.ts
  - strategy-parser.ts
  - strategy-executor.ts
  - strategy-executor.test.ts
  - gates.ts
  - gates.test.ts
  - artifact-store.ts
  - artifact-store.test.ts
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
| [llm-provider.ts](llm-provider.ts) | Abstract LLM provider interface decoupling session management from invocation mechanism |
| [claude-code-provider.ts](claude-code-provider.ts) | Claude Code CLI provider — delegates to @method/methodts for arg building and output parsing |
| [strategy-parser.ts](strategy-parser.ts) | Parses strategy YAML into StrategyDAG and validates acyclicity, reference integrity, and unique IDs |
| [strategy-executor.ts](strategy-executor.ts) | DAG executor — runs nodes in topological order, parallelizes independent nodes, enforces cost budgets |
| [gates.ts](gates.ts) | Gate framework — sandboxed expression evaluation for algorithmic, observation, and human approval gates |
| [artifact-store.ts](artifact-store.ts) | Immutable versioned store for pipeline artifacts with snapshot bundles passed between nodes |
| [retro-generator.ts](retro-generator.ts) | Generates retrospective YAML capturing timing, cost, gate results, and oversight events |
| [retro-writer.ts](retro-writer.ts) | Filesystem operations for saving strategy retrospectives to disk |
| [strategy-routes.ts](strategy-routes.ts) | Fastify HTTP routes for strategy execution and status checking |
