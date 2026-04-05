/**
 * Build Orchestrator domain — PRD 047.
 *
 * Stub index for Wave 0. Domain registration and route wiring
 * are implemented in Wave 2 (C-3).
 */

// Re-export types for domain consumers
export type {
  BuildState,
  BuildStatus,
  AutonomyLevel,
  ExplorationReport,
  ValidationReport,
  EvidenceReport,
  Refinement,
  PhaseResult,
  CriterionResult,
} from './types.js';

export { BuildConfigSchema, type BuildConfig } from './config.js';
export { buildOrchestratorPact } from './pact.js';
