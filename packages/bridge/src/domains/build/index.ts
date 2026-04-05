/**
 * Build Orchestrator domain — PRD 047.
 *
 * Core orchestrator (C-1): 8-phase build lifecycle, checkpoint persistence,
 * and testable assertion validator. Route wiring is in Wave 2 (C-3).
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

// C-1: Core orchestrator, checkpoint adapter, validator
export { BuildOrchestrator } from './orchestrator.js';
export type { StrategyExecutionResult } from './orchestrator.js';
export { FileCheckpointAdapter } from './checkpoint-adapter.js';
export { Validator } from './validator.js';
export type { CommandExecutor, CommandExecutorResult } from './validator.js';
