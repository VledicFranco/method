/**
 * strategy/ — DAG-based strategy execution system.
 *
 * StrategyController: routes strategy decisions to the right executor.
 * DagStrategyExecutor: DAG executor — topological ordering, parallel nodes.
 * DagParser: parses strategy YAML → StrategyDAG.
 * DagGates, DagArtifactStore, DagRetro: gate eval, artifact store, retros.
 * StrategySource port + StdlibStrategySource implementation.
 * AgentSteered: agent-controlled navigation mode.
 * Prebuilt, compat: pre-built strategies and legacy format shims.
 */

export * from './controller.js';
export * from './run-strategy.js';
export * from './prebuilt.js';
export * from './compat.js';
export * from './dag-executor.js';
export * from './dag-parser.js';
export * from './dag-gates.js';
export * from './dag-artifact-store.js';
export * from './dag-retro.js';
// dag-types exports StrategyDAG (non-generic) which conflicts with compat's StrategyDAG<S>.
// Selective re-export to avoid ambiguity — consumers import directly from dag-types when needed.
export type { StrategyNode, StrategyDAG as PipelineDAG, StrategyNodeConfig } from './dag-types.js';
export * from './strategy-source.js';
export * from './stdlib-strategy-source.js';
export * from './agent-steered.js';
