/**
 * Experiments domain — barrel exports (PRD 041 Phase 2).
 *
 * Exports the public surface area of the experiments domain:
 * types, core operations, persistence operations, route registration,
 * and the EventSink factory.
 *
 * The composition root (server-entry.ts) is responsible for:
 * 1. Calling setExperimentRoutesPorts(fs, yaml) with injected ports
 * 2. Calling registerExperimentRoutes(app) to mount HTTP routes
 * 3. Calling createExperimentEventSink() and registering it with the event bus
 */

// Types
export type {
  Experiment,
  Run,
  RunMetrics,
  Condition,
  TraceRecord,
  TraceFilter,
  ExperimentStatus,
  RunStatus,
} from './types.js';

// Config schemas
export {
  CreateExperimentSchema,
  CreateRunSchema,
  ReadTracesSchema,
  ExperimentsConfigSchema,
  loadExperimentsConfig,
} from './config.js';
export type {
  CreateExperimentInput,
  CreateRunInput,
  ReadTracesInput,
  ExperimentsConfig,
} from './config.js';

// Core operations
export {
  createExperiment,
  getExperiment,
  listExperiments,
  updateExperimentStatus,
  createRun,
  getRun,
  listRuns,
  captureRunConfig,
  captureEnvironment,
  completeRun,
  failRun,
  setCorePorts,
  setDataDir,
} from './core.js';

// Persistence operations
export {
  appendEvent,
  readEvents,
  readTraces,
  createExperimentEventSink,
  setPersistencePorts,
  setPersistenceDataDir,
} from './persistence.js';

// Routes
export {
  registerExperimentRoutes,
  setExperimentRoutesPorts,
  setExperimentRoutesDataDir,
} from './routes.js';
