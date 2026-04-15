/**
 * @method/runtime/executors — PRD-062 / S5.
 *
 * Wave 1 ships `CortexJobBackedExecutor` (fresh-per-continuation only).
 * Wave 2 will add `InProcessExecutor` wrapping the existing StrategyExecutor.
 */

export {
  CortexJobBackedExecutor,
} from './cortex-job-backed-executor.js';
export type {
  CortexJobBackedExecutorOptions,
  TurnOutcome,
  TurnRunner,
} from './cortex-job-backed-executor.js';
