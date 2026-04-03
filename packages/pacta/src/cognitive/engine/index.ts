/**
 * Cognitive Engine — barrel export.
 *
 * Cycle orchestrator, composition function, and flat agent adapter.
 * Zero awareness of specific module implementations (G-BOUNDARY).
 */

// ── Cycle orchestrator ──────────────────────────────────────────

export { createCognitiveCycle } from './cycle.js';
export type {
  CycleConfig,
  CycleErrorPolicy,
  CycleBudget,
  ThresholdPolicy,
  CycleModules,
  CycleResult,
  CognitiveCycleRunner,
  CyclePhaseName,
} from './cycle.js';

// ── Composition function ────────────────────────────────────────

export { createCognitiveAgent } from './create-cognitive-agent.js';
export type {
  CreateCognitiveAgentOptions,
  CognitiveAgent,
} from './create-cognitive-agent.js';

// ── Partition write adapter (PRD 045) ───────────────────────────

export { createPartitionWriteAdapter } from './partition-write-adapter.js';

// ── Flat agent adapter ──────────────────────────────────────────

export { asFlatAgent } from './as-flat-agent.js';
export type { AsFlatAgentOptions } from './as-flat-agent.js';
