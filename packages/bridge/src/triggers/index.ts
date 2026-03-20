/**
 * PRD 018: Event Triggers — Module Exports (Phase 2a-1)
 */

export { TriggerRouter } from './trigger-router.js';
export type { TriggerRouterOptions } from './trigger-router.js';

export { FileWatchTrigger } from './file-watch-trigger.js';
export { GitCommitTrigger } from './git-commit-trigger.js';

export { DebounceEngine } from './debounce.js';
export { minimatch } from './glob-match.js';

export { parseStrategyTriggers, hasEventTriggers } from './trigger-parser.js';
export type { ParsedStrategyTriggers } from './trigger-parser.js';

export { scanAndRegisterTriggers } from './startup-scan.js';
export type { ScanResult } from './startup-scan.js';

export type {
  TriggerType,
  TriggerConfig,
  TriggerWatcher,
  TriggerEvent,
  TriggerRegistration,
  TriggerStats,
  DebounceConfig,
  DebouncedEvent,
  DebouncedTriggerFire,
  TimerInterface,
  FileWatchTriggerConfig,
  GitCommitTriggerConfig,
} from './types.js';

export { realTimers } from './types.js';
